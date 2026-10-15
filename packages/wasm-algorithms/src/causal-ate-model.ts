// 站内 PSM / IPTW 的平均处理效应（Q16.16）。与 Wasm 模块逐字段同式。
//
// 协变量已经在调用方收成离散分层。IPTW 用该分层上的饱和标准化（与经验倾向评分加权同一数字）。
// PSM 在层内按输入顺序 1:1 配对，不跨层。标准误用配对差的样本标准差。
// 层内样本量或配对数低于 minCell 的层不进入效应量。配对数不足 2 时给不出样本标准误，整站抑制。

export const CAUSAL_ATE_Q = 65536;
const MAX_N = 1048576;
const MAX_K = 64;
const HEADER_BYTES = 12;

export interface CausalAteInput {
  method: 0 | 1;
  minCell: number;
  treated: readonly number[];
  outcome: readonly number[];
  stratum: readonly number[];
  k: number;
}

export interface CausalAteQ16 {
  method: 0 | 1;
  ateQ: number;
  seQ: number;
  nUsed: number;
  nStrata: number;
  suppressed: 0 | 1;
}

export interface CausalAteEncoded {
  n: number;
  k: number;
  input: Uint8Array;
  outOff: number;
  outBytes: number;
  requiredBytes: number;
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

function align8(off: number): number {
  return (off + 7) & ~7;
}

interface Cells {
  a: number;
  b: number;
  c: number;
  d: number;
}

function counts(input: CausalAteInput, s: number): Cells {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  const n = input.treated.length;
  for (let i = 0; i < n; i++) {
    if (input.stratum[i] !== s) continue;
    const t = input.treated[i];
    const y = input.outcome[i];
    if (t === 1 && y === 1) a++;
    else if (t === 1 && y === 0) b++;
    else if (t === 0 && y === 1) c++;
    else d++;
  }
  return { a, b, c, d };
}

function finish(
  method: 0 | 1,
  ateQ: bigint,
  se2: bigint,
  nUsed: number,
  nStrata: number,
): CausalAteQ16 {
  const lo = -0x80000000n;
  const hi = 0x7fffffffn;
  const ate = ateQ < lo ? lo : ateQ > hi ? hi : ateQ;
  const se = isqrt(se2);
  return {
    method,
    ateQ: Number(ate),
    seQ: Number(se > hi ? hi : se),
    nUsed,
    nStrata,
    suppressed: 0,
  };
}

function suppressed(method: 0 | 1): CausalAteQ16 {
  return { method, ateQ: 0, seQ: 0, nUsed: 0, nStrata: 0, suppressed: 1 };
}

function iptw(input: CausalAteInput): CausalAteQ16 {
  const q = BigInt(CAUSAL_ATE_Q);
  let num = 0n;
  let acc = 0n;
  let nUsed = 0;
  let nStrata = 0;
  for (let s = 0; s < input.k; s++) {
    const cell = counts(input, s);
    const n1 = cell.a + cell.b;
    const n0 = cell.c + cell.d;
    if (n1 < input.minCell || n0 < input.minCell) continue;
    const ns = n1 + n0;
    nUsed += ns;
    nStrata++;
    num += (BigInt(ns) * q * BigInt(cell.a)) / BigInt(n1);
    num -= (BigInt(ns) * q * BigInt(cell.c)) / BigInt(n0);
    let t1 = (BigInt(cell.a) * BigInt(cell.b) * q) / BigInt(n1);
    t1 = t1 / BigInt(n1);
    t1 = (t1 * q) / BigInt(n1);
    let t0 = (BigInt(cell.c) * BigInt(cell.d) * q) / BigInt(n0);
    t0 = t0 / BigInt(n0);
    t0 = (t0 * q) / BigInt(n0);
    acc += BigInt(ns) * BigInt(ns) * (t1 + t0);
  }
  if (nUsed === 0) return suppressed(0);
  const ateQ = num / BigInt(nUsed);
  const se2 = acc / (BigInt(nUsed) * BigInt(nUsed));
  return finish(0, ateQ, se2, nUsed, nStrata);
}

function psm(input: CausalAteInput): CausalAteQ16 {
  const q = BigInt(CAUSAL_ATE_Q);
  let sumD = 0;
  let sumD2 = 0;
  let pairs = 0;
  let nStrata = 0;
  const n = input.treated.length;
  for (let s = 0; s < input.k; s++) {
    const treatedY: number[] = [];
    const controlY: number[] = [];
    for (let i = 0; i < n; i++) {
      if (input.stratum[i] !== s) continue;
      if (input.treated[i] === 1) treatedY.push(input.outcome[i]);
      else controlY.push(input.outcome[i]);
    }
    const m = Math.min(treatedY.length, controlY.length);
    if (m < input.minCell) continue;
    nStrata++;
    for (let j = 0; j < m; j++) {
      const diff = treatedY[j] - controlY[j];
      sumD += diff;
      sumD2 += diff * diff;
    }
    pairs += m;
  }
  if (pairs < 2) return suppressed(1);
  const core = BigInt(pairs) * BigInt(sumD2) - BigInt(sumD) * BigInt(sumD);
  let se2 = (core * q) / (BigInt(pairs) * BigInt(pairs));
  se2 = (se2 * q) / BigInt(pairs - 1);
  const ateQ = (BigInt(sumD) * q) / BigInt(pairs);
  return finish(1, ateQ, se2, pairs * 2, nStrata);
}

export function causalAteQ16(input: CausalAteInput): CausalAteQ16 {
  if (input.method === 0) return iptw(input);
  return psm(input);
}

export function encodeCausalAte(input: CausalAteInput): CausalAteEncoded {
  const n = input.treated.length;
  if (input.outcome.length !== n || input.stratum.length !== n) {
    throw new Error("暴露、结局、分层长度不一致");
  }
  if (n > MAX_N || input.k < 1 || input.k > MAX_K || input.minCell < 1) {
    throw new Error("行数、分层数或最小格超出模块上限");
  }
  if (input.method !== 0 && input.method !== 1) throw new Error("方法只能是 0（IPTW）或 1（PSM）");
  const rowsOff = HEADER_BYTES;
  const scratch = align8(rowsOff + n * 3);
  const outOff = align8(scratch + n);
  const outBytes = 24;
  const bytes = new Uint8Array(outOff + outBytes);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, input.method, true);
  view.setInt32(4, input.minCell, true);
  view.setInt32(8, CAUSAL_ATE_Q, true);
  for (let i = 0; i < n; i++) {
    const t = input.treated[i];
    const y = input.outcome[i];
    const s = input.stratum[i];
    if ((t !== 0 && t !== 1) || (y !== 0 && y !== 1) || s < 0 || s >= input.k) {
      throw new Error("暴露/结局必须是 0 或 1，分层下标必须落在 k 内");
    }
    bytes[rowsOff + i] = t;
    bytes[rowsOff + n + i] = y;
    bytes[rowsOff + 2 * n + i] = s;
  }
  return { n, k: input.k, input: bytes, outOff, outBytes, requiredBytes: bytes.length };
}

export function decodeCausalAte(output: Uint8Array): CausalAteQ16 {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const method = view.getInt32(0, true);
  return {
    method: method === 1 ? 1 : 0,
    ateQ: view.getInt32(4, true),
    seQ: view.getInt32(8, true),
    nUsed: view.getInt32(12, true),
    nStrata: view.getInt32(16, true),
    suppressed: view.getInt32(20, true) === 1 ? 1 : 0,
  };
}
