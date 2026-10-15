// 比较效果的站点效应量（Q16.16 整数 IRLS）—— 与 Wasm 模块逐字段同式。
//
// 为什么是定点：平台算子必须是 wasm，而 AssemblyScript 的 exp/log 与 V8 不保证逐位一致
// （见 fl-logistic-model.ts）。sigmoid 用宿主传入的整数查表，模块内零浮点。
// 回归只看暴露×结局的四格（与既有 logistic 一样不吃分层）；分层四格只用于 Mantel–Haenszel，
// 由调用方用同一份格子再算。这里交出的是 logOR、标准误、协方差和每层的 a/b/c/d。

import {
  FL_LOGISTIC_LUT_LEN,
  FL_LOGISTIC_Z_MAX_Q,
  FL_LOGISTIC_Z_MIN_Q,
  buildFlLogisticLut,
  flLogisticSigmoidQ,
} from "./fl-logistic-model";

export const SITE_EFFECT_ANALYSIS_TYPE = "comparative-effect";
export const SITE_EFFECT_OPERATOR_ID = "rws.comparative-effect";
export const SITE_EFFECT_Q = 65536;
export const SITE_EFFECT_HALF_Q = SITE_EFFECT_Q / 2;
export const SITE_EFFECT_RIDGE_Q = 1;
export const SITE_EFFECT_ITERS = 40;
/** round(1.959963984540054 * 65536)。 */
export const SITE_EFFECT_Z_Q = 128450;
/** |logOR| ≥ 10 视为分离，改走 Firth。与浮点实现同一阈值。 */
export const SITE_EFFECT_SEPARATION_Q = 10 * SITE_EFFECT_Q;

const HEADER_BYTES = 32;
const MAX_N = 1048576;
const MAX_K = 64;

export interface SiteEffectQ16 {
  method: 0 | 1;
  logOrQ: number;
  seQ: number;
  cov00Q: number;
  cov01Q: number;
  cov11Q: number;
  ci0Q: number;
  ci1Q: number;
  cells: Array<{ a: number; b: number; c: number; d: number }>;
}

export interface SiteEffectEncoded {
  n: number;
  k: number;
  input: Uint8Array;
  outOff: number;
  outBytes: number;
  requiredBytes: number;
}

function satI32(v: bigint): number {
  const lo = -0x40000000n;
  const hi = 0x3fffffffn;
  if (v < lo) return Number(lo);
  if (v > hi) return Number(hi);
  return Number(v);
}

function isqrt(n: bigint): bigint {
  if (n <= 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

function wQ(mu: number, q: number): number {
  return Number((BigInt(mu) * BigInt(q - mu)) / BigInt(q));
}

interface NewtonOut {
  b0: number;
  b1: number;
  broke: boolean;
  h00: bigint;
  h01: bigint;
  h11: bigint;
}

function newton(args: {
  a: number;
  b: number;
  c: number;
  d: number;
  lut: readonly number[];
  iters: number;
  firth: boolean;
  q: number;
  half: number;
  ridge: number;
}): NewtonOut {
  const { a, b, c, d, lut, iters, firth, q, half, ridge } = args;
  const n = a + b + c + d;
  const n0 = c + d;
  const n1 = a + b;
  let b0 = 0;
  let b1 = 0;
  let broke = false;
  let h00 = 0n;
  let h01 = 0n;
  let h11 = 0n;
  const qB = BigInt(q);
  for (let iter = 0; iter < iters; iter++) {
    const mu0 = flLogisticSigmoidQ(b0, lut);
    const mu1 = flLogisticSigmoidQ(b0 + b1, lut);
    const w0 = wQ(mu0, q);
    const w1 = wQ(mu1, q);
    h00 = BigInt(n0) * BigInt(w0) + BigInt(n1) * BigInt(w1);
    h01 = BigInt(n1) * BigInt(w1);
    h11 = h01;
    let i00 = h00;
    let i01 = h01;
    let i11 = h11;
    if (firth) {
      i00 += BigInt(ridge);
      i11 += BigInt(ridge);
    }
    const detI = i00 * i11 - i01 * i01;
    let g0: bigint;
    let g1: bigint;
    if (!firth) {
      const e0 = BigInt(q - mu0);
      const e1 = BigInt(-mu0);
      const e2 = BigInt(q - mu1);
      const e3 = BigInt(-mu1);
      g0 = BigInt(c) * e0 + BigInt(d) * e1 + BigInt(a) * e2 + BigInt(b) * e3;
      g1 = BigInt(a) * e2 + BigInt(b) * e3;
    } else {
      if (detI === 0n) {
        broke = true;
        break;
      }
      const inv00 = (i11 * qB * qB) / detI;
      const inv01 = (-i01 * qB * qB) / detI;
      const inv11 = (i00 * qB * qB) / detI;
      const hi0 = (BigInt(w0) * inv00) / qB;
      const quad1 = inv00 + 2n * inv01 + inv11;
      const hi1 = (BigInt(w1) * quad1) / qB;
      const adj = (err: bigint, hi: bigint, mu: number) =>
        err + (hi * BigInt(half - mu)) / qB;
      const a0 = adj(BigInt(q - mu0), hi0, mu0);
      const a1 = adj(BigInt(-mu0), hi0, mu0);
      const a2 = adj(BigInt(q - mu1), hi1, mu1);
      const a3 = adj(BigInt(-mu1), hi1, mu1);
      g0 = BigInt(c) * a0 + BigInt(d) * a1 + BigInt(a) * a2 + BigInt(b) * a3;
      g1 = BigInt(a) * a2 + BigInt(b) * a3;
    }
    const g0s = g0 / BigInt(n);
    const g1s = g1 / BigInt(n);
    const h00s = i00 / BigInt(n);
    const h01s = i01 / BigInt(n);
    const h11s = i11 / BigInt(n);
    const detS = h00s * h11s - h01s * h01s;
    if (detS === 0n) {
      broke = true;
      break;
    }
    const d0 = satI32(((g0s * h11s - g1s * h01s) * qB) / detS);
    const d1 = satI32(((h00s * g1s - h01s * g0s) * qB) / detS);
    b0 = satI32(BigInt(b0) + BigInt(d0));
    b1 = satI32(BigInt(b1) + BigInt(d1));
    if (Math.abs(d0) < 1 && Math.abs(d1) < 1) break;
  }
  return { b0, b1, broke, h00, h01, h11 };
}

function covariance(h00: bigint, h01: bigint, h11: bigint, n: number, q: number) {
  const nB = BigInt(n);
  const h00s = h00 / nB;
  const h01s = h01 / nB;
  const h11s = h11 / nB;
  const detS = h00s * h11s - h01s * h01s;
  if (detS === 0n || n <= 0) {
    return { cov00Q: 0, cov01Q: 0, cov11Q: 0, seQ: 0 };
  }
  const qB = BigInt(q);
  const cov00Q = satI32((h11s * qB * qB) / detS / nB);
  const cov01Q = satI32((-h01s * qB * qB) / detS / nB);
  const cov11Q = satI32((h00s * qB * qB) / detS / nB);
  const seQ = satI32(isqrt(BigInt(cov11Q) * qB));
  return { cov00Q, cov01Q, cov11Q, seQ };
}

/** 定点站点效应量。格子由调用方从行上数好；分层顺序与 `cells` 一致。 */
export function siteEffectQ16(input: {
  exposed: ArrayLike<number>;
  event: ArrayLike<number>;
  stratum: ArrayLike<number>;
  k: number;
  lut?: readonly number[];
  iters?: number;
}): SiteEffectQ16 {
  const n = input.exposed.length;
  const k = input.k;
  if (n <= 0 || n > MAX_N) throw new Error("site-effect: n 非法");
  if (k <= 0 || k > MAX_K) throw new Error("site-effect: k 非法");
  if (input.event.length !== n || input.stratum.length !== n) {
    throw new Error("site-effect: 三列长度不一致");
  }
  const cells = Array.from({ length: k }, () => ({ a: 0, b: 0, c: 0, d: 0 }));
  for (let i = 0; i < n; i++) {
    const s = input.stratum[i];
    const x = input.exposed[i];
    const y = input.event[i];
    if (!Number.isInteger(s) || s < 0 || s >= k) throw new Error("site-effect: 分层下标越界");
    if ((x !== 0 && x !== 1) || (y !== 0 && y !== 1)) throw new Error("site-effect: 暴露/结局必须是 0 或 1");
    const cell = cells[s];
    if (x === 1 && y === 1) cell.a += 1;
    else if (x === 1 && y === 0) cell.b += 1;
    else if (x === 0 && y === 1) cell.c += 1;
    else cell.d += 1;
  }
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (const cell of cells) {
    a += cell.a;
    b += cell.b;
    c += cell.c;
    d += cell.d;
  }
  const lut = input.lut ?? buildFlLogisticLut();
  const iters = input.iters ?? SITE_EFFECT_ITERS;
  const common = { a, b, c, d, lut, iters, q: SITE_EFFECT_Q, half: SITE_EFFECT_HALF_Q, ridge: SITE_EFFECT_RIDGE_Q };
  let fit = newton({ ...common, firth: false });
  let method: 0 | 1 = 0;
  if (fit.broke || Math.abs(fit.b1) >= SITE_EFFECT_SEPARATION_Q) {
    fit = newton({ ...common, firth: true });
    method = 1;
  }
  const cov = covariance(fit.h00, fit.h01, fit.h11, a + b + c + d, SITE_EFFECT_Q);
  const z = SITE_EFFECT_Z_Q;
  const margin = Number((BigInt(z) * BigInt(cov.seQ)) / BigInt(SITE_EFFECT_Q));
  return {
    method,
    logOrQ: satI32(BigInt(fit.b1)),
    seQ: cov.seQ,
    cov00Q: cov.cov00Q,
    cov01Q: cov.cov01Q,
    cov11Q: cov.cov11Q,
    ci0Q: satI32(BigInt(fit.b1 - margin)),
    ci1Q: satI32(BigInt(fit.b1 + margin)),
    cells,
  };
}

function align8(value: number): number {
  return (value + 7) & ~7;
}

/** 行 → 模块输入。分层下标由宿主排好，模块只见 0..k-1。 */
export function encodeSiteEffect(input: {
  exposed: ArrayLike<number>;
  event: ArrayLike<number>;
  stratum: ArrayLike<number>;
  k: number;
  lut?: readonly number[];
}): SiteEffectEncoded {
  const n = input.exposed.length;
  const lut = input.lut ?? buildFlLogisticLut();
  if (lut.length !== FL_LOGISTIC_LUT_LEN) throw new Error("site-effect: 查表长度不符");
  const rowsOff = HEADER_BYTES + lut.length * 4;
  const scratchOff = align8(rowsOff + n * 3);
  const bytes = new Uint8Array(scratchOff + 48);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, FL_LOGISTIC_Z_MIN_Q, true);
  view.setInt32(4, FL_LOGISTIC_Z_MAX_Q, true);
  view.setUint32(8, lut.length, true);
  view.setUint32(12, SITE_EFFECT_ITERS, true);
  view.setInt32(16, SITE_EFFECT_RIDGE_Q, true);
  view.setInt32(20, SITE_EFFECT_HALF_Q, true);
  view.setInt32(24, SITE_EFFECT_Q, true);
  view.setInt32(28, SITE_EFFECT_Z_Q, true);
  for (let i = 0; i < lut.length; i++) view.setInt32(HEADER_BYTES + i * 4, lut[i], true);
  for (let i = 0; i < n; i++) {
    bytes[rowsOff + i] = input.exposed[i];
    bytes[rowsOff + n + i] = input.event[i];
    bytes[rowsOff + 2 * n + i] = input.stratum[i];
  }
  const outOff = align8(bytes.length);
  const outBytes = 32 + input.k * 16;
  return { n, k: input.k, input: bytes, outOff, outBytes, requiredBytes: outOff + outBytes };
}

/** 模块输出区 → 定点结果。 */
export function decodeSiteEffect(output: Uint8Array, k: number): SiteEffectQ16 {
  if (output.length < 32 + k * 16) throw new Error("site-effect: 输出长度不足");
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const method = view.getInt32(0, true);
  if (method !== 0 && method !== 1) throw new Error("site-effect: method 非法");
  const cells = [];
  for (let i = 0; i < k; i++) {
    const at = 32 + i * 16;
    cells.push({
      a: view.getUint32(at, true),
      b: view.getUint32(at + 4, true),
      c: view.getUint32(at + 8, true),
      d: view.getUint32(at + 12, true),
    });
  }
  return {
    method,
    logOrQ: view.getInt32(4, true),
    seQ: view.getInt32(8, true),
    cov00Q: view.getInt32(12, true),
    cov01Q: view.getInt32(16, true),
    cov11Q: view.getInt32(20, true),
    ci0Q: view.getInt32(24, true),
    ci1Q: view.getInt32(28, true),
    cells,
  };
}
