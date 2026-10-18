// 需求响应潜力（整数定点）—— 平台签名的 Wasm 算法模块（power.dr-potential@1.0.0）。
//
// 宿主按电表分组、按小时重采样并缩放为非负整数后传入；用户类型系数、舒适度、设备容量
// 都由宿主折算成千分比 / 整数单位放进头部（参数，不是数据）。
//
// ABI v1（小端）：
//   run(inOff: i32, m: i32, hours: i32, outOff: i32) -> i32      (0 = 成功；hours 必须 = 24)
//   输入 @inOff：
//     header i32[8]：curtailPermille · shiftPermille · offPeakPermille · comfortPermille ·
//                    ratedCapUnits(-1=无) · curtailDeviceCapUnits(-1=无) · shiftDeviceCapUnits(-1=无) · pad
//     offsets u32[m+1] · values i32[offsets[m]]
//   工作区：scratch = align8(输入末尾)，需要 4·ceil(n/24) 字节（每个小时桶排序用）
//   输出 @outOff（每块表 73 个 i32）：baseline[24] · peakCap[24] · valleyCap[24] · fullLoad
//   定义：baseline[h] = min(桶均值, 桶 P25)，P25 = sorted[(len-1)>>2]；
//         peakMean = Σbaseline/24；fullLoad = ∀h baseline·100 ≥ max(v)·98；
//         peakCap  = fullLoad ? 0 : load·curtail/1000 （load<peakMean 再 ·offPeak/1000）→ 设备/额定截断 → ·comfort/1000；
//         valleyCap = peakMean·shift/1000 （load>peakMean 再 ·offPeak/1000）→ 设备/额定截断 → ·comfort/1000。
//   错误码：1 m 非法 · 2 hours≠24 · 3 某表样本数非法（< 7×24）· 4 数值越界（须 0..MAX_ABS）·
//           5 偏移非单调 · 6 outOff 与输入/工作区重叠 · 7 头部参数非法
//
// 零能力：只导入 env.memory，不分配堆。语义必须与 `src/power-dr-potential-model.ts` 逐字段一致。

export const abi_version: i32 = 1;

const HOURS: i32 = 24;
const MAX_M: i32 = 65536;
const MAX_N: i32 = 65536;
const MIN_N: i32 = 168;
const MAX_ABS: i32 = 5000000;
const HEADER_BYTES: i32 = 32;
const STRIDE: i32 = 73;

function align8(off: i32): i32 {
  return (off + 7) & ~7;
}

function siftDown(base: i32, start: i32, end: i32): void {
  let root: i32 = start;
  while (true) {
    let child: i32 = 2 * root + 1;
    if (child >= end) return;
    if (child + 1 < end && load<i32>(base + (child + 1) * 4) > load<i32>(base + child * 4)) child++;
    const rv: i32 = load<i32>(base + root * 4);
    const cv: i32 = load<i32>(base + child * 4);
    if (rv >= cv) return;
    store<i32>(base + root * 4, cv);
    store<i32>(base + child * 4, rv);
    root = child;
  }
}

/** 原地堆排序（升序）。排序结果唯一，与参考实现用何种排序无关。 */
function heapSort(base: i32, len: i32): void {
  for (let s = (len >> 1) - 1; s >= 0; s--) siftDown(base, s, len);
  for (let end = len - 1; end > 0; end--) {
    const top: i32 = load<i32>(base);
    store<i32>(base, load<i32>(base + end * 4));
    store<i32>(base + end * 4, top);
    siftDown(base, 0, end);
  }
}

function capAt(v: i64, cap: i32): i64 {
  return cap >= 0 && <i64>cap < v ? <i64>cap : v;
}

export function run(inOff: i32, m: i32, hours: i32, outOff: i32): i32 {
  if (m <= 0 || m > MAX_M) return 1;
  if (hours != HOURS) return 2;

  const curtail: i64 = <i64>load<i32>(inOff);
  const shift: i64 = <i64>load<i32>(inOff + 4);
  const offPeak: i64 = <i64>load<i32>(inOff + 8);
  const comfort: i64 = <i64>load<i32>(inOff + 12);
  const rated: i32 = load<i32>(inOff + 16);
  const curtailDev: i32 = load<i32>(inOff + 20);
  const shiftDev: i32 = load<i32>(inOff + 24);
  if (curtail < 0 || curtail > 1000 || shift < 0 || shift > 1000) return 7;
  if (offPeak < 0 || offPeak > 1000 || comfort < 0 || comfort > 1000) return 7;
  if (rated < -1 || curtailDev < -1 || shiftDev < -1) return 7;

  const offsetsOff: i32 = inOff + HEADER_BYTES;
  const valuesOff: i32 = offsetsOff + (m + 1) * 4;
  let prev: u32 = load<u32>(offsetsOff);
  if (prev != 0) return 5;
  let maxBucket: i32 = 0;
  for (let e = 0; e < m; e++) {
    const next: u32 = load<u32>(offsetsOff + (e + 1) * 4);
    if (next < prev) return 5;
    const n: i32 = <i32>(next - prev);
    if (n < MIN_N || n > MAX_N) return 3;
    const b: i32 = (n + HOURS - 1) / HOURS;
    if (b > maxBucket) maxBucket = b;
    prev = next;
  }
  const scratch: i32 = align8(valuesOff + <i32>prev * 4);
  if (outOff < scratch + maxBucket * 4) return 6;

  for (let e = 0; e < m; e++) {
    const start: i32 = <i32>load<u32>(offsetsOff + e * 4);
    const n: i32 = <i32>load<u32>(offsetsOff + (e + 1) * 4) - start;
    const base: i32 = valuesOff + start * 4;
    const out: i32 = outOff + e * STRIDE * 4;

    let historyMax: i32 = 0;
    for (let i = 0; i < n; i++) {
      const v: i32 = load<i32>(base + i * 4);
      if (v < 0 || v > MAX_ABS) return 4;
      if (v > historyMax) historyMax = v;
    }

    let baseSum: i64 = 0;
    for (let h = 0; h < HOURS; h++) {
      let len: i32 = 0;
      let sum: i64 = 0;
      for (let i = h; i < n; i += HOURS) {
        const v: i32 = load<i32>(base + i * 4);
        store<i32>(scratch + len * 4, v);
        sum += <i64>v;
        len++;
      }
      heapSort(scratch, len);
      const p25: i64 = <i64>load<i32>(scratch + ((len - 1) >> 2) * 4);
      const mean: i64 = sum / <i64>len;
      const bl: i64 = mean < p25 ? mean : p25;
      store<i32>(out + h * 4, <i32>bl);
      baseSum += bl;
    }
    const peakMean: i64 = baseSum / <i64>HOURS;

    let fullLoad: bool = true;
    for (let h = 0; h < HOURS; h++) {
      if (<i64>load<i32>(out + h * 4) * 100 < <i64>historyMax * 98) {
        fullLoad = false;
        break;
      }
    }

    for (let h = 0; h < HOURS; h++) {
      const ld: i64 = <i64>load<i32>(out + h * 4);
      let cap: i64 = 0;
      if (!fullLoad) {
        cap = (ld * curtail) / 1000;
        if (ld < peakMean) cap = (cap * offPeak) / 1000;
        cap = capAt(cap, curtailDev);
        cap = capAt(cap, rated);
        cap = (cap * comfort) / 1000;
      }
      store<i32>(out + (HOURS + h) * 4, <i32>cap);

      let sh: i64 = (peakMean * shift) / 1000;
      if (ld > peakMean) sh = (sh * offPeak) / 1000;
      sh = capAt(sh, shiftDev);
      sh = capAt(sh, rated);
      sh = (sh * comfort) / 1000;
      store<i32>(out + (2 * HOURS + h) * 4, <i32>sh);
    }
    store<i32>(out + 3 * HOURS * 4, fullLoad ? 1 : 0);
  }
  return 0;
}
