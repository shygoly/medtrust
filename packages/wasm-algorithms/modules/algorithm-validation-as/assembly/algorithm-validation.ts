// 站点校验指标（Q16.16）。零浮点、零堆。配对计数直接扫输入行。
//
// ABI v1（小端；宿主必须显式声明 `validation-metrics@1`）：
//   run(inOff, n, k, outOff) -> i32
//   输入 @inOff:
//     +0 minCell i32 · +4 q i32 · +8 nCal i32 · +12 nDc i32
//     然后 n 行 8 字节：label u8、pad、score i32（0..q）
//   输出 @outOff:
//     suppressed i32 · aucQ i32 · seQ i32 · nPos i32 · nNeg i32 · nCal i32 · nDc i32 · pad i32
//     然后 nCal 个校准箱，各 16 字节：n · events · meanQ · suppressed
//     然后 nDc 个决策点，各 16 字节：threshold · netBenefitQ · suppressed · pad
//   错误码：5 参数非法 · 3 行非法 · 6 没有行
//
// 语义必须与 `src/validation-metrics-model.ts#validationMetricsQ16` 逐字段一致。

export const abi_version: i32 = 1;

const MAX_N: i32 = 4096;

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

function satI32(v: i64): i32 {
  if (v < <i64>-2147483648) return <i32>-2147483648;
  if (v > <i64>2147483647) return 2147483647;
  return <i32>v;
}

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (n <= 0) return 6;
  if (n > MAX_N || k <= 0) return 5;
  const minCell = load<i32>(inOff);
  const q = load<i32>(inOff + 4);
  const nCal = load<i32>(inOff + 8);
  const nDc = load<i32>(inOff + 12);
  if (minCell < 1 || q <= 1 || nCal != 5 || nDc != 9) return 5;
  const rowsOff = inOff + 16;
  if (outOff < align8(rowsOff + n * 8)) return 5;

  let nPos: i32 = 0;
  let nNeg: i32 = 0;
  let concordant: i32 = 0;
  let ties: i32 = 0;
  const binN0 = 0;
  const binN1 = 0;
  const binN2 = 0;
  const binN3 = 0;
  const binN4 = 0;
  let b0: i32 = binN0;
  let b1: i32 = binN1;
  let b2: i32 = binN2;
  let b3: i32 = binN3;
  let b4: i32 = binN4;
  let e0: i32 = 0;
  let e1: i32 = 0;
  let e2: i32 = 0;
  let e3: i32 = 0;
  let e4: i32 = 0;
  let s0: i32 = 0;
  let s1: i32 = 0;
  let s2: i32 = 0;
  let s3: i32 = 0;
  let s4: i32 = 0;

  for (let i: i32 = 0; i < n; i++) {
    const at = rowsOff + i * 8;
    const label = <i32>load<u8>(at);
    const score = load<i32>(at + 4);
    if ((label != 0 && label != 1) || score < 0 || score > q) return 3;
    if (label == 1) nPos++;
    else nNeg++;
    let bin: i32 = <i32>((<i64>score * <i64>nCal) / <i64>q);
    if (bin >= nCal) bin = nCal - 1;
    if (bin == 0) {
      b0++;
      s0 += score;
      if (label == 1) e0++;
    } else if (bin == 1) {
      b1++;
      s1 += score;
      if (label == 1) e1++;
    } else if (bin == 2) {
      b2++;
      s2 += score;
      if (label == 1) e2++;
    } else if (bin == 3) {
      b3++;
      s3 += score;
      if (label == 1) e3++;
    } else {
      b4++;
      s4 += score;
      if (label == 1) e4++;
    }
  }
  for (let i: i32 = 0; i < n; i++) {
    const atI = rowsOff + i * 8;
    if (<i32>load<u8>(atI) != 1) continue;
    const si = load<i32>(atI + 4);
    for (let j: i32 = 0; j < n; j++) {
      const atJ = rowsOff + j * 8;
      if (<i32>load<u8>(atJ) != 0) continue;
      const sj = load<i32>(atJ + 4);
      if (si > sj) concordant++;
      else if (si == sj) ties++;
    }
  }

  storeBin(outOff, 0, n, minCell, b0, e0, s0);
  storeBin(outOff, 1, n, minCell, b1, e1, s1);
  storeBin(outOff, 2, n, minCell, b2, e2, s2);
  storeBin(outOff, 3, n, minCell, b3, e3, s3);
  storeBin(outOff, 4, n, minCell, b4, e4, s4);

  for (let t: i32 = 1; t <= nDc; t++) {
    let tp: i32 = 0;
    let fp: i32 = 0;
    for (let i: i32 = 0; i < n; i++) {
      const at = rowsOff + i * 8;
      const score = load<i32>(at + 4);
      if (<i64>score * 10 < <i64>t * <i64>q) continue;
      if (<i32>load<u8>(at) == 1) tp++;
      else fp++;
    }
    const at = outOff + 32 + nCal * 16 + (t - 1) * 16;
    store<i32>(at, t);
    store<i32>(at + 12, 0);
    if (n < minCell || tp + fp < minCell) {
      store<i32>(at + 4, 0);
      store<i32>(at + 8, 1);
    } else {
      const qB: i64 = q;
      const nb: i64 =
        (<i64>tp * qB) / <i64>n - (<i64>fp * qB * <i64>t) / (<i64>n * <i64>(10 - t));
      store<i32>(at + 4, satI32(nb));
      store<i32>(at + 8, 0);
    }
  }

  store<i32>(outOff + 12, nPos);
  store<i32>(outOff + 16, nNeg);
  store<i32>(outOff + 20, nCal);
  store<i32>(outOff + 24, nDc);
  store<i32>(outOff + 28, 0);
  if (n < minCell || nPos == 0 || nNeg == 0) {
    store<i32>(outOff, 1);
    store<i32>(outOff + 4, 0);
    store<i32>(outOff + 8, 0);
    return 0;
  }
  const qB: i64 = q;
  const aucQ: i64 = (<i64>(2 * concordant + ties) * qB) / <i64>(2 * nPos * nNeg);
  const q1: i64 = (aucQ * qB) / (2 * qB - aucQ);
  const q2: i64 = (2 * aucQ * aucQ) / (qB + aucQ);
  const factor: i64 = qB + <i64>(nPos - 1) * q1 + <i64>(nNeg - 1) * q2;
  const se2: i64 = (aucQ * (qB - aucQ) * factor) / (qB * <i64>nPos * <i64>nNeg);
  store<i32>(outOff, 0);
  store<i32>(outOff + 4, satI32(aucQ));
  store<i32>(outOff + 8, satI32(isqrt(se2)));
  return 0;
}

function storeBin(outOff: i32, index: i32, n: i32, minCell: i32, count: i32, events: i32, sum: i32): void {
  const at = outOff + 32 + index * 16;
  if (n < minCell || count < minCell) {
    store<i32>(at, 0);
    store<i32>(at + 4, 0);
    store<i32>(at + 8, 0);
    store<i32>(at + 12, 1);
    return;
  }
  store<i32>(at, count);
  store<i32>(at + 4, events);
  store<i32>(at + 8, sum / count);
  store<i32>(at + 12, 0);
}
