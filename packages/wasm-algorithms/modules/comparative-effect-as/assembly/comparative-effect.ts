// 比较效果站点效应量（Q16.16 整数 IRLS）。零浮点、零堆分配。
//
// ABI v1（小端；宿主必须显式声明 `site-effect@1`）：
//   run(inOff, n, k, outOff) -> i32
//   输入 @inOff:
//     +0  zMinQ i32
//     +4  zMaxQ i32
//     +8  lutLen u32
//     +12 iters u32
//     +16 ridgeQ i32
//     +20 halfQ i32
//     +24 q i32
//     +28 z975Q i32
//     +32 lut[lutLen] i32
//     然后 exposed u8[n]、event u8[n]、stratum u8[n]
//     对齐后的 48 字节奏描区（宿主留出，模块写 Hessian）
//   输出 @outOff:
//     method i32 · logOrQ i32 · seQ i32
//     cov00Q i32 · cov01Q i32 · cov11Q i32
//     ci0Q i32 · ci1Q i32
//     然后 k 层 {a,b,c,d} 各 u32
//   错误码：5 参数非法 · 3 分层或 0/1 越界 · 6 没有行
//
// 语义必须与 `src/site-effect-model.ts#siteEffectQ16` 逐字段一致。

export const abi_version: i32 = 1;

const MAX_N: i32 = 1048576;
const MAX_K: i32 = 64;
const SEPARATION_MUL: i32 = 10;

function align8(off: i32): i32 {
  return (off + 7) & ~7;
}

function satI32(v: i64): i32 {
  if (v < <i64>-1073741824) return <i32>-1073741824;
  if (v > <i64>1073741823) return 1073741823;
  return <i32>v;
}

function isqrt(n: i64): i64 {
  if (n <= 0) return 0;
  let x: i64 = n;
  let y: i64 = (x + 1) / 2;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2;
  }
  return x;
}

function sigmoidQ(zQ: i32, lutOff: i32, lutLen: i32, zMinQ: i32, zMaxQ: i32): i32 {
  const den: i32 = zMaxQ - zMinQ;
  const off: i32 = zQ - zMinQ;
  if (off <= 0) return load<i32>(lutOff);
  if (off >= den) return load<i32>(lutOff + (lutLen - 1) * 4);
  const num: i64 = <i64>off * <i64>(lutLen - 1);
  const i: i32 = <i32>(num / <i64>den);
  const rem: i64 = num - <i64>i * <i64>den;
  const lo: i64 = <i64>load<i32>(lutOff + i * 4);
  const hi: i64 = <i64>load<i32>(lutOff + (i + 1) * 4);
  return <i32>((lo * (<i64>den - rem) + hi * rem) / <i64>den);
}

function wOf(mu: i32, q: i32): i32 {
  return <i32>((<i64>mu * <i64>(q - mu)) / <i64>q);
}

function newton(
  a: i32,
  b: i32,
  c: i32,
  d: i32,
  lutOff: i32,
  lutLen: i32,
  zMinQ: i32,
  zMaxQ: i32,
  iters: i32,
  firth: i32,
  q: i32,
  half: i32,
  ridge: i32,
  dest: i32,
): void {
  const n: i32 = a + b + c + d;
  const n0: i32 = c + d;
  const n1: i32 = a + b;
  let b0: i32 = 0;
  let b1: i32 = 0;
  let broke: i32 = 0;
  let h00: i64 = 0;
  let h01: i64 = 0;
  let h11: i64 = 0;
  const qB: i64 = q;
  for (let iter = 0; iter < iters; iter++) {
    const mu0 = sigmoidQ(b0, lutOff, lutLen, zMinQ, zMaxQ);
    const mu1 = sigmoidQ(b0 + b1, lutOff, lutLen, zMinQ, zMaxQ);
    const w0 = wOf(mu0, q);
    const w1 = wOf(mu1, q);
    h00 = <i64>n0 * <i64>w0 + <i64>n1 * <i64>w1;
    h01 = <i64>n1 * <i64>w1;
    h11 = h01;
    let i00: i64 = h00;
    let i01: i64 = h01;
    let i11: i64 = h11;
    if (firth != 0) {
      i00 += <i64>ridge;
      i11 += <i64>ridge;
    }
    const detI: i64 = i00 * i11 - i01 * i01;
    let g0: i64 = 0;
    let g1: i64 = 0;
    if (firth == 0) {
      const e0: i64 = q - mu0;
      const e1: i64 = -mu0;
      const e2: i64 = q - mu1;
      const e3: i64 = -mu1;
      g0 = <i64>c * e0 + <i64>d * e1 + <i64>a * e2 + <i64>b * e3;
      g1 = <i64>a * e2 + <i64>b * e3;
    } else {
      if (detI == 0) {
        broke = 1;
        break;
      }
      const inv00: i64 = (i11 * qB * qB) / detI;
      const inv01: i64 = ((0 - i01) * qB * qB) / detI;
      const inv11: i64 = (i00 * qB * qB) / detI;
      const hi0: i64 = (<i64>w0 * inv00) / qB;
      const quad1: i64 = inv00 + (<i64>2 * inv01) + inv11;
      const hi1: i64 = (<i64>w1 * quad1) / qB;
      const a0: i64 = <i64>(q - mu0) + (hi0 * <i64>(half - mu0)) / qB;
      const a1: i64 = <i64>(0 - mu0) + (hi0 * <i64>(half - mu0)) / qB;
      const a2: i64 = <i64>(q - mu1) + (hi1 * <i64>(half - mu1)) / qB;
      const a3: i64 = <i64>(0 - mu1) + (hi1 * <i64>(half - mu1)) / qB;
      g0 = <i64>c * a0 + <i64>d * a1 + <i64>a * a2 + <i64>b * a3;
      g1 = <i64>a * a2 + <i64>b * a3;
    }
    const nB: i64 = n;
    const g0s: i64 = g0 / nB;
    const g1s: i64 = g1 / nB;
    const h00s: i64 = i00 / nB;
    const h01s: i64 = i01 / nB;
    const h11s: i64 = i11 / nB;
    const detS: i64 = h00s * h11s - h01s * h01s;
    if (detS == 0) {
      broke = 1;
      break;
    }
    const d0 = satI32(((g0s * h11s - g1s * h01s) * qB) / detS);
    const d1 = satI32(((h00s * g1s - h01s * g0s) * qB) / detS);
    b0 = satI32(<i64>b0 + <i64>d0);
    b1 = satI32(<i64>b1 + <i64>d1);
    const ad0 = d0 < 0 ? -d0 : d0;
    const ad1 = d1 < 0 ? -d1 : d1;
    if (ad0 < 1 && ad1 < 1) break;
  }
  store<i32>(dest, b0);
  store<i32>(dest + 4, b1);
  store<i32>(dest + 8, broke);
  store<i64>(dest + 16, h00);
  store<i64>(dest + 24, h01);
  store<i64>(dest + 32, h11);
}

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (n <= 0 || n > MAX_N) return n == 0 ? 6 : 5;
  if (k <= 0 || k > MAX_K) return 5;
  const zMinQ = load<i32>(inOff);
  const zMaxQ = load<i32>(inOff + 4);
  const lutLen = <i32>load<u32>(inOff + 8);
  const iters = <i32>load<u32>(inOff + 12);
  const ridge = load<i32>(inOff + 16);
  const half = load<i32>(inOff + 20);
  const q = load<i32>(inOff + 24);
  const z975 = load<i32>(inOff + 28);
  if (lutLen < 2 || zMaxQ <= zMinQ || iters <= 0 || q <= 0) return 5;

  const lutOff = inOff + 32;
  const rowsOff = lutOff + lutLen * 4;
  const scratch = align8(rowsOff + n * 3);
  if (outOff < scratch + 48) return 5;

  for (let s = 0; s < k; s++) {
    const at = outOff + 32 + s * 16;
    store<u32>(at, 0);
    store<u32>(at + 4, 0);
    store<u32>(at + 8, 0);
    store<u32>(at + 12, 0);
  }

  for (let i = 0; i < n; i++) {
    const x = <i32>load<u8>(rowsOff + i);
    const y = <i32>load<u8>(rowsOff + n + i);
    const s = <i32>load<u8>(rowsOff + 2 * n + i);
    if (s >= k || (x != 0 && x != 1) || (y != 0 && y != 1)) return 3;
    let field: i32 = 12;
    if (x == 1 && y == 1) field = 0;
    else if (x == 1 && y == 0) field = 4;
    else if (x == 0 && y == 1) field = 8;
    const slot = outOff + 32 + s * 16 + field;
    store<u32>(slot, load<u32>(slot) + 1);
  }

  let a: i32 = 0;
  let b: i32 = 0;
  let c: i32 = 0;
  let d: i32 = 0;
  for (let s = 0; s < k; s++) {
    const at = outOff + 32 + s * 16;
    a += <i32>load<u32>(at);
    b += <i32>load<u32>(at + 4);
    c += <i32>load<u32>(at + 8);
    d += <i32>load<u32>(at + 12);
  }

  newton(a, b, c, d, lutOff, lutLen, zMinQ, zMaxQ, iters, 0, q, half, ridge, scratch);
  let method: i32 = 0;
  let b1: i32 = load<i32>(scratch + 4);
  const separation: i32 = SEPARATION_MUL * q;
  const absB1 = b1 < 0 ? -b1 : b1;
  if (load<i32>(scratch + 8) != 0 || absB1 >= separation) {
    newton(a, b, c, d, lutOff, lutLen, zMinQ, zMaxQ, iters, 1, q, half, ridge, scratch);
    method = 1;
    b1 = load<i32>(scratch + 4);
  }
  const h00 = load<i64>(scratch + 16);
  const h01 = load<i64>(scratch + 24);
  const h11 = load<i64>(scratch + 32);
  const nB: i64 = a + b + c + d;
  const h00s: i64 = h00 / nB;
  const h01s: i64 = h01 / nB;
  const h11s: i64 = h11 / nB;
  const detS: i64 = h00s * h11s - h01s * h01s;
  let cov00: i32 = 0;
  let cov01: i32 = 0;
  let cov11: i32 = 0;
  let se: i32 = 0;
  if (detS != 0 && nB > 0) {
    const qB: i64 = q;
    cov00 = satI32((h11s * qB * qB) / detS / nB);
    cov01 = satI32(((0 - h01s) * qB * qB) / detS / nB);
    cov11 = satI32((h00s * qB * qB) / detS / nB);
    se = satI32(isqrt(<i64>cov11 * <i64>q));
  }
  const margin = <i32>((<i64>z975 * <i64>se) / <i64>q);
  store<i32>(outOff, method);
  store<i32>(outOff + 4, b1);
  store<i32>(outOff + 8, se);
  store<i32>(outOff + 12, cov00);
  store<i32>(outOff + 16, cov01);
  store<i32>(outOff + 20, cov11);
  store<i32>(outOff + 24, satI32(<i64>b1 - <i64>margin));
  store<i32>(outOff + 28, satI32(<i64>b1 + <i64>margin));
  return 0;
}
