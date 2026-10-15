// 站内 Cox 一步 Newton + 分箱 Kaplan–Meier。零浮点。直方图写在宿主留出的暂存里。
//
// ABI v1（小端；宿主必须显式声明 `survival-effect@1`）：
//   run(inOff, n, k, outOff) -> i32
//   输入 @inOff:
//     +0  minCell i32
//     +4  binWidth i32
//     +8  q i32
//     +12 maxBins i32
//     然后 n 行，每行 8 字节：treated u8、event u8、pad u16、duration i32
//     对齐后的直方图暂存：4 × 4096 个 u32（处理组事件、对照组事件、处理组退出、对照组退出）
//   输出 @outOff:
//     method i32 · logHrQ i32 · seQ i32 · suppressed i32 · nBins i32 · pad i32
//     然后每个箱 16 字节：t i32 · survQ i32 · atRisk i32 · suppressed i32
//   错误码：5 参数非法 · 3 行非法 · 6 没有行
//
// 语义必须与 `src/survival-effect-model.ts#survivalEffectQ16` 逐字段一致。

export const abi_version: i32 = 1;

const MAX_N: i32 = 4096;
const MAX_DAY: i32 = 4095;
const HIST_DAYS: i32 = 4096;

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

function histAt(scratch: i32, which: i32, day: i32): i32 {
  return scratch + (which * HIST_DAYS + day) * 4;
}

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (n <= 0) return 6;
  if (n > MAX_N || k <= 0) return 5;
  const minCell = load<i32>(inOff);
  const binWidth = load<i32>(inOff + 4);
  const q = load<i32>(inOff + 8);
  const maxBins = load<i32>(inOff + 12);
  if (minCell < 1 || binWidth < 1 || q <= 1 || maxBins < 1) return 5;
  const rowsOff = inOff + 16;
  const scratch = align8(rowsOff + n * 8);
  const histBytes: i32 = 4 * HIST_DAYS * 4;
  if (outOff < scratch + histBytes) return 5;

  for (let i: i32 = 0; i < histBytes; i += 4) store<u32>(scratch + i, 0);

  let maxDur: i32 = 0;
  let events: i32 = 0;
  let riskT: i32 = 0;
  let riskC: i32 = 0;
  for (let i: i32 = 0; i < n; i++) {
    const at = rowsOff + i * 8;
    const treated = <i32>load<u8>(at);
    const ev = <i32>load<u8>(at + 1);
    const day = load<i32>(at + 4);
    if ((treated != 0 && treated != 1) || (ev != 0 && ev != 1) || day < 0 || day > MAX_DAY) return 3;
    if (day > maxDur) maxDur = day;
    const whichExit: i32 = treated == 1 ? 2 : 3;
    const whichEvent: i32 = treated == 1 ? 0 : 1;
    store<u32>(histAt(scratch, whichExit, day), load<u32>(histAt(scratch, whichExit, day)) + 1);
    if (treated == 1) riskT++;
    else riskC++;
    if (ev == 1) {
      store<u32>(histAt(scratch, whichEvent, day), load<u32>(histAt(scratch, whichEvent, day)) + 1);
      events++;
    }
  }
  const nBins = maxDur / binWidth + 1;
  if (nBins > maxBins) return 5;

  let scoreQ: i64 = 0;
  let infoQ: i64 = 0;
  let survQ: i64 = q;
  let rt: i32 = riskT;
  let rc: i32 = riskC;
  let written: i32 = 0;
  const qB: i64 = q;
  for (let day: i32 = 0; day <= maxDur; day++) {
    const risk = rt + rc;
    if (day % binWidth == 0) {
      const at = outOff + 24 + written * 16;
      store<i32>(at, day);
      if (risk < minCell) {
        store<i32>(at + 4, 0);
        store<i32>(at + 8, 0);
        store<i32>(at + 12, 1);
      } else {
        store<i32>(at + 4, satI32(survQ));
        store<i32>(at + 8, risk);
        store<i32>(at + 12, 0);
      }
      written++;
    }
    const e1 = <i32>load<u32>(histAt(scratch, 0, day));
    const e0 = <i32>load<u32>(histAt(scratch, 1, day));
    const dEvents = e1 + e0;
    const s0 = risk;
    const s1 = rt;
    if (dEvents > 0 && s0 > 0) {
      scoreQ += <i64>e1 * qB - (<i64>dEvents * <i64>s1 * qB) / <i64>s0;
      infoQ += (<i64>dEvents * <i64>s1 * <i64>(s0 - s1) * qB) / (<i64>s0 * <i64>s0);
      for (let j: i32 = 0; j < dEvents; j++) survQ = (survQ * <i64>(s0 - 1)) / <i64>s0;
    }
    rt -= <i32>load<u32>(histAt(scratch, 2, day));
    rc -= <i32>load<u32>(histAt(scratch, 3, day));
  }

  store<i32>(outOff, 0);
  store<i32>(outOff + 16, written);
  store<i32>(outOff + 20, 0);
  if (events < minCell || infoQ == 0) {
    store<i32>(outOff + 4, 0);
    store<i32>(outOff + 8, 0);
    store<i32>(outOff + 12, 1);
    return 0;
  }
  const logHrQ = (scoreQ * qB) / infoQ;
  const se2 = (qB * qB * qB) / infoQ;
  store<i32>(outOff + 4, satI32(logHrQ));
  store<i32>(outOff + 8, satI32(isqrt(se2)));
  store<i32>(outOff + 12, 0);
  return 0;
}
