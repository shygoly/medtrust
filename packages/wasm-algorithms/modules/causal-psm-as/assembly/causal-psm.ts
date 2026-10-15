// 站内 PSM / IPTW（Q16.16）。零浮点。配对照用输入区里宿主留出的暂存，不另申请堆。
//
// ABI v1（小端；宿主必须显式声明 `causal-ate@1`）：
//   run(inOff, n, k, outOff) -> i32
//   输入 @inOff:
//     +0  method i32（0 IPTW，1 PSM）
//     +4  minCell i32
//     +8  q i32
//     +12 treated u8[n]、outcome u8[n]、stratum u8[n]
//     对齐后的 n 字节暂存（只给 PSM 按层记下先出现的处理组结局）
//   输出 @outOff（24 字节）:
//     method i32 · ateQ i32 · seQ i32 · nUsed i32 · nStrata i32 · suppressed i32
//   错误码：5 参数非法 · 3 分层或 0/1 越界 · 6 没有行
//
// 语义必须与 `src/causal-ate-model.ts#causalAteQ16` 逐字段一致。

export const abi_version: i32 = 1;

const MAX_N: i32 = 1048576;
const MAX_K: i32 = 64;

function align8(off: i32): i32 {
  return (off + 7) & ~7;
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

function storeOut(
  outOff: i32,
  method: i32,
  ateQ: i32,
  seQ: i32,
  nUsed: i32,
  nStrata: i32,
  suppressed: i32,
): void {
  store<i32>(outOff, method);
  store<i32>(outOff + 4, ateQ);
  store<i32>(outOff + 8, seQ);
  store<i32>(outOff + 12, nUsed);
  store<i32>(outOff + 16, nStrata);
  store<i32>(outOff + 20, suppressed);
}

function satI32(v: i64): i32 {
  if (v < <i64>-2147483648) return <i32>-2147483648;
  if (v > <i64>2147483647) return 2147483647;
  return <i32>v;
}

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (n <= 0 || n > MAX_N) return 6;
  if (k <= 0 || k > MAX_K) return 5;
  const method = load<i32>(inOff);
  const minCell = load<i32>(inOff + 4);
  const q = load<i32>(inOff + 8);
  if ((method != 0 && method != 1) || minCell < 1 || q <= 1) return 5;
  const rowsOff = inOff + 12;
  const scratch = align8(rowsOff + n * 3);
  if (outOff < scratch + n) return 5;

  if (method == 0) return iptw(rowsOff, n, k, minCell, q, outOff);
  return psm(rowsOff, n, k, minCell, q, scratch, outOff);
}

function iptw(rowsOff: i32, n: i32, k: i32, minCell: i32, q: i32, outOff: i32): i32 {
  let num: i64 = 0;
  let acc: i64 = 0;
  let nUsed: i32 = 0;
  let nStrata: i32 = 0;
  for (let s: i32 = 0; s < k; s++) {
    let a: i32 = 0;
    let b: i32 = 0;
    let c: i32 = 0;
    let d: i32 = 0;
    for (let i: i32 = 0; i < n; i++) {
      const t = <i32>load<u8>(rowsOff + i);
      const y = <i32>load<u8>(rowsOff + n + i);
      const st = <i32>load<u8>(rowsOff + 2 * n + i);
      if (st >= k || (t != 0 && t != 1) || (y != 0 && y != 1)) return 3;
      if (st != s) continue;
      if (t == 1 && y == 1) a++;
      else if (t == 1 && y == 0) b++;
      else if (t == 0 && y == 1) c++;
      else d++;
    }
    const n1 = a + b;
    const n0 = c + d;
    if (n1 < minCell || n0 < minCell) continue;
    const ns = n1 + n0;
    nUsed += ns;
    nStrata++;
    const qB: i64 = q;
    num += (<i64>ns * qB * <i64>a) / <i64>n1;
    num -= (<i64>ns * qB * <i64>c) / <i64>n0;
    let t1: i64 = (<i64>a * <i64>b * qB) / <i64>n1;
    t1 = t1 / <i64>n1;
    t1 = (t1 * qB) / <i64>n1;
    let t0: i64 = (<i64>c * <i64>d * qB) / <i64>n0;
    t0 = t0 / <i64>n0;
    t0 = (t0 * qB) / <i64>n0;
    acc += <i64>ns * <i64>ns * (t1 + t0);
  }
  if (nUsed == 0) {
    storeOut(outOff, 0, 0, 0, 0, 0, 1);
    return 0;
  }
  const ateQ = num / <i64>nUsed;
  const se2 = acc / (<i64>nUsed * <i64>nUsed);
  storeOut(outOff, 0, satI32(ateQ), satI32(isqrt(se2)), nUsed, nStrata, 0);
  return 0;
}

function psm(
  rowsOff: i32,
  n: i32,
  k: i32,
  minCell: i32,
  q: i32,
  scratch: i32,
  outOff: i32,
): i32 {
  let sumD: i64 = 0;
  let sumD2: i64 = 0;
  let pairs: i32 = 0;
  let nStrata: i32 = 0;
  for (let s: i32 = 0; s < k; s++) {
    let n1: i32 = 0;
    let n0: i32 = 0;
    for (let i: i32 = 0; i < n; i++) {
      const t = <i32>load<u8>(rowsOff + i);
      const y = <i32>load<u8>(rowsOff + n + i);
      const st = <i32>load<u8>(rowsOff + 2 * n + i);
      if (st >= k || (t != 0 && t != 1) || (y != 0 && y != 1)) return 3;
      if (st != s) continue;
      if (t == 1) n1++;
      else n0++;
    }
    const m = n1 < n0 ? n1 : n0;
    if (m < minCell) continue;
    nStrata++;
    let seen: i32 = 0;
    for (let i: i32 = 0; i < n && seen < m; i++) {
      const t = <i32>load<u8>(rowsOff + i);
      const st = <i32>load<u8>(rowsOff + 2 * n + i);
      if (st != s || t != 1) continue;
      store<u8>(scratch + seen, load<u8>(rowsOff + n + i));
      seen++;
    }
    seen = 0;
    for (let i: i32 = 0; i < n && seen < m; i++) {
      const t = <i32>load<u8>(rowsOff + i);
      const st = <i32>load<u8>(rowsOff + 2 * n + i);
      if (st != s || t != 0) continue;
      const diff: i64 = <i64>load<u8>(scratch + seen) - <i64>load<u8>(rowsOff + n + i);
      sumD += diff;
      sumD2 += diff * diff;
      seen++;
    }
    pairs += m;
  }
  if (pairs < 2) {
    storeOut(outOff, 1, 0, 0, 0, 0, 1);
    return 0;
  }
  const qB: i64 = q;
  const core: i64 = <i64>pairs * sumD2 - sumD * sumD;
  let se2: i64 = (core * qB) / (<i64>pairs * <i64>pairs);
  se2 = (se2 * qB) / <i64>(pairs - 1);
  const ateQ: i64 = (sumD * qB) / <i64>pairs;
  storeOut(outOff, 1, satI32(ateQ), satI32(isqrt(se2)), pairs * 2, nStrata, 0);
  return 0;
}
