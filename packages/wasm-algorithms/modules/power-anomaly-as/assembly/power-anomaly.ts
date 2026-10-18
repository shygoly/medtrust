// 用电异常检测（整数定点）—— 平台签名的 Wasm 算法模块（power.anomaly-detection@1.0.0）。
//
// 规则集成（零 / 负 / 突变 / 异常低 / 周期性零功率）+ 整数孤立森林。全部千分比整数；
// 随机性来自宿主给的种子（宿主由表计标识派生，标识本身不进模块），LCG 与参考实现同式。
//
// ABI v1（小端）：
//   run(inOff: i32, m: i32, hours: i32, outOff: i32) -> i32      (0 = 成功；hours 必须 = 24)
//   输入 @inOff：
//     header i32[8]：peerMean(-1=无) · pad · pad · pad · pad · pad · pad · pad
//     seeds  u32[m]（每块表一个孤立森林种子，0 视作 1）
//     offsets u32[m+1] · values i32[offsets[m]]
//   工作区：scratch = align8(输入末尾)，需要 (88 + 6·R)·4 字节，R = 参考窗口数（≤ n/168）
//   输出 @outOff（每块表 6 个 i32）：score‰ · type · method · confidence‰ · evStart · evEnd
//     type：0 none · 1 zero_power · 2 negative_power · 3 power_spike · 4 abnormally_low · 5 periodic · 6 insufficient_data
//     method：0 rule_ensemble · 1 isolation_forest
//   错误码：1 m 非法 · 2 hours≠24 · 3 样本数非法 · 4 数值越界 · 5 偏移非单调 · 6 outOff 与输入/工作区重叠
//
// 零能力：只导入 env.memory，不分配堆。语义必须与 `src/power-anomaly-model.ts` 逐字段一致。

export const abi_version: i32 = 1;

const HOURS: i32 = 24;
const MAX_M: i32 = 65536;
const MAX_N: i32 = 65536;
const MAX_ABS: i32 = 5000000;
const HEADER_BYTES: i32 = 32;
const MIN_DETECTION: i32 = 720;
const WINDOW: i32 = 168;
const DIMS: i32 = 6;
const SAMPLE_MAX: i32 = 64;
const STRIDE: i32 = 6;
// scratch 布局（i32 下标）：rules[16] · point[8] · sample[64] · refs[R*6]
const RULES_AT: i32 = 0;
const POINT_AT: i32 = 16;
const SAMPLE_AT: i32 = 24;
const REFS_AT: i32 = 88;

function align8(off: i32): i32 {
  return (off + 7) & ~7;
}

function clampPermille(v: i64): i32 {
  if (v < 0) return 0;
  if (v > 1000) return 1000;
  return <i32>v;
}

function abs64(v: i64): i64 {
  return v < 0 ? -v : v;
}

function isqrt64(x: i64): i64 {
  if (x <= 0) return 0;
  let rest: i64 = x;
  let res: i64 = 0;
  let bit: i64 = <i64>1 << 62;
  while (bit > rest) bit >>= 2;
  while (bit != 0) {
    if (rest >= res + bit) {
      rest -= res + bit;
      res = (res >> 1) + bit;
    } else {
      res >>= 1;
    }
    bit >>= 2;
  }
  return res;
}

function lcg(s: u32): u32 {
  return s * 1664525 + 1013904223;
}

/** [start,end) 的 mean 与总体 std（截断 / 向下取整）。写到 dst[0..2)。 */
function meanStd(base: i32, start: i32, end: i32, dst: i32): void {
  const n: i64 = <i64>(end - start);
  let sum: i64 = 0;
  for (let i = start; i < end; i++) sum += <i64>load<i32>(base + i * 4);
  const mean: i64 = sum / n;
  let sq: i64 = 0;
  for (let i = start; i < end; i++) {
    const d: i64 = <i64>load<i32>(base + i * 4) - mean;
    sq += d * d;
  }
  store<i32>(dst, <i32>mean);
  store<i32>(dst + 4, <i32>isqrt64(sq / n));
}

/** 窗口特征向量 [mean, std, zero‰, min, max, spike‰] → dst。 */
function windowVector(base: i32, start: i32, end: i32, dst: i32): void {
  meanStd(base, start, end, dst);
  const n: i32 = end - start;
  const mean: i64 = <i64>load<i32>(dst);
  const stdRaw: i64 = <i64>load<i32>(dst + 4);
  const s: i64 = stdRaw < 1 ? 1 : stdRaw;
  let zeros: i64 = 0;
  let spikes: i64 = 0;
  let mn: i32 = load<i32>(base + start * 4);
  let mx: i32 = mn;
  for (let i = start; i < end; i++) {
    const v: i32 = load<i32>(base + i * 4);
    if (v == 0) zeros++;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    if (i > start) {
      const d: i64 = abs64(<i64>v - <i64>load<i32>(base + (i - 1) * 4));
      if (d > 4 * s && 2 * d > abs64(mean)) spikes++;
    }
  }
  const spikeDen: i64 = n / 50 > 0 ? <i64>(n / 50) : 1;
  store<i32>(dst + 8, clampPermille((zeros * 1000) / <i64>n));
  store<i32>(dst + 12, mn);
  store<i32>(dst + 16, mx);
  store<i32>(dst + 20, clampPermille((spikes * 1000) / spikeDen));
}

/** 全序列规则特征 → rules[0..8)：zero neg spike low periodic dominant evStart evEnd；rules[10..12) 暂存 mean/std。 */
function ruleFeatures(base: i32, n: i32, peer: i32, rules: i32): void {
  meanStd(base, 0, n, rules + 40);
  const mean: i64 = <i64>load<i32>(rules + 40);
  const stdRaw: i64 = <i64>load<i32>(rules + 44);
  const s: i64 = stdRaw < 1 ? 1 : stdRaw;
  const lowRef: i64 = peer > 0 ? <i64>peer : mean;

  let zeros: i64 = 0;
  let negs: i64 = 0;
  let spikes: i64 = 0;
  let lows: i64 = 0;
  let first: i32 = -1;
  let last: i32 = -1;
  for (let i = 0; i < n; i++) {
    const v: i32 = load<i32>(base + i * 4);
    let hit: bool = false;
    if (v == 0) {
      zeros++;
      hit = true;
    }
    if (v < 0) {
      negs++;
      hit = true;
    }
    if (i > 0) {
      const d: i64 = abs64(<i64>v - <i64>load<i32>(base + (i - 1) * 4));
      if (d > 4 * s && 2 * d > abs64(mean)) {
        spikes++;
        hit = true;
      }
    }
    if (v >= 0 && 5 * <i64>v < lowRef) {
      lows++;
      hit = true;
    }
    if (hit) {
      if (first < 0) first = i;
      last = i + 1;
    }
  }

  let rateSum: i64 = 0;
  let rateMax: i64 = 0;
  for (let h = 0; h < HOURS; h++) {
    let hn: i64 = 0;
    let hz: i64 = 0;
    for (let i = h; i < n; i += HOURS) {
      hn++;
      if (load<i32>(base + i * 4) == 0) hz++;
    }
    const rate: i64 = hn > 0 ? (hz * 1000) / hn : 0;
    rateSum += rate;
    if (rate > rateMax) rateMax = rate;
  }
  const periodic: i32 = clampPermille(rateMax - rateSum / <i64>HOURS);

  const den: i64 = n / 50 > 0 ? <i64>(n / 50) : 1;
  const zero: i32 = clampPermille((zeros * 1000) / <i64>n);
  const neg: i32 = clampPermille((negs * 1000) / den);
  const spike: i32 = clampPermille((spikes * 1000) / den);
  const low: i32 = clampPermille((lows * 1000) / <i64>n);

  store<i32>(rules, zero);
  store<i32>(rules + 4, neg);
  store<i32>(rules + 8, spike);
  store<i32>(rules + 12, low);
  store<i32>(rules + 16, periodic);
  // 主导类型：按 zero→neg→spike→low→periodic 取第一个最大值
  let top: i32 = zero;
  let type: i32 = 1;
  if (neg > top) {
    top = neg;
    type = 2;
  }
  if (spike > top) {
    top = spike;
    type = 3;
  }
  if (low > top) {
    top = low;
    type = 4;
  }
  if (periodic > top) {
    top = periodic;
    type = 5;
  }
  store<i32>(rules + 20, top < 50 ? 0 : type);
  if (first >= 0) {
    store<i32>(rules + 24, first);
    store<i32>(rules + 28, last > first + 1 ? last : first + 1);
  } else {
    store<i32>(rules + 24, 0);
    store<i32>(rules + 28, n);
  }
}

/** 整数孤立森林：返回 if‰。 */
function isolationScore(point: i32, refs: i32, r: i32, sample: i32, trees: i32, seed: u32): i32 {
  let rng: u32 = seed == 0 ? 1 : seed;
  const rr: i32 = r < 2 ? 2 : r;
  let limit: i32 = 0;
  while ((1 << limit) < rr) limit++;
  const size: i32 = r < SAMPLE_MAX ? r : SAMPLE_MAX;
  let sumPath: i64 = 0;
  for (let t = 0; t < trees; t++) {
    for (let i = 0; i < size; i++) {
      rng = lcg(rng);
      store<i32>(sample + i * 4, <i32>(rng % <u32>r));
    }
    let len: i32 = size;
    let depth: i32 = 0;
    while (depth < limit && len > 1) {
      rng = lcg(rng);
      const dim: i32 = <i32>(rng % <u32>DIMS);
      let lo: i32 = load<i32>(refs + (load<i32>(sample) * DIMS + dim) * 4);
      let hi: i32 = lo;
      for (let i = 1; i < len; i++) {
        const v: i32 = load<i32>(refs + (load<i32>(sample + i * 4) * DIMS + dim) * 4);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi <= lo) break;
      rng = lcg(rng);
      const split: i64 = <i64>lo + ((<i64>rng * (<i64>hi - <i64>lo)) >> 32);
      const goLeft: bool = <i64>load<i32>(point + dim * 4) < split;
      let kept: i32 = 0;
      for (let i = 0; i < len; i++) {
        const idx: i32 = load<i32>(sample + i * 4);
        const v: i64 = <i64>load<i32>(refs + (idx * DIMS + dim) * 4);
        if ((v < split) == goLeft) {
          store<i32>(sample + kept * 4, idx);
          kept++;
        }
      }
      depth++;
      if (kept == 0 || kept == len) break;
      len = kept;
    }
    sumPath += <i64>depth;
  }
  const den: i64 = <i64>trees * <i64>(limit < 2 ? 2 : limit);
  return clampPermille(1000 - (2000 * sumPath) / den);
}

export function run(inOff: i32, m: i32, hours: i32, outOff: i32): i32 {
  if (m <= 0 || m > MAX_M) return 1;
  if (hours != HOURS) return 2;
  const peer: i32 = load<i32>(inOff);
  const seedsOff: i32 = inOff + HEADER_BYTES;
  const offsetsOff: i32 = seedsOff + m * 4;
  const valuesOff: i32 = offsetsOff + (m + 1) * 4;

  let prev: u32 = load<u32>(offsetsOff);
  if (prev != 0) return 5;
  let maxRefs: i32 = 0;
  for (let e = 0; e < m; e++) {
    const next: u32 = load<u32>(offsetsOff + (e + 1) * 4);
    if (next < prev) return 5;
    const n: i32 = <i32>(next - prev);
    if (n < 1 || n > MAX_N) return 3;
    if (n >= MIN_DETECTION) {
      const step: i32 = n > 2 * MIN_DETECTION ? 2 * WINDOW : WINDOW;
      const r: i32 = (n - WINDOW) / step + 1;
      if (r > maxRefs) maxRefs = r;
    }
    prev = next;
  }
  const scratch: i32 = align8(valuesOff + <i32>prev * 4);
  if (outOff < scratch + (REFS_AT + maxRefs * DIMS) * 4) return 6;
  const rules: i32 = scratch + RULES_AT * 4;
  const point: i32 = scratch + POINT_AT * 4;
  const sample: i32 = scratch + SAMPLE_AT * 4;
  const refs: i32 = scratch + REFS_AT * 4;

  for (let e = 0; e < m; e++) {
    const start: i32 = <i32>load<u32>(offsetsOff + e * 4);
    const n: i32 = <i32>load<u32>(offsetsOff + (e + 1) * 4) - start;
    const base: i32 = valuesOff + start * 4;
    for (let i = 0; i < n; i++) {
      const v: i32 = load<i32>(base + i * 4);
      if (v > MAX_ABS || v < -MAX_ABS) return 4;
    }
    const out: i32 = outOff + e * STRIDE * 4;
    ruleFeatures(base, n, peer, rules);
    const zero: i64 = <i64>load<i32>(rules);
    const neg: i64 = <i64>load<i32>(rules + 4);
    const spike: i64 = <i64>load<i32>(rules + 8);
    const low: i64 = <i64>load<i32>(rules + 12);
    const periodic: i64 = <i64>load<i32>(rules + 16);
    const dominant: i32 = load<i32>(rules + 20);

    let score: i32 = 0;
    let type: i32 = 6;
    let method: i32 = 0;
    let confidence: i32 = 200;
    let evStart: i32 = 0;
    let evEnd: i32 = n;

    if (n < MIN_DETECTION) {
      if (peer > 0) {
        let mx: i64 = zero;
        if (neg > mx) mx = neg;
        if (low > mx) mx = low;
        score = clampPermille((mx * 800) / 1000);
        type = score >= 300 ? dominant : 6;
        confidence = 400;
        evStart = load<i32>(rules + 24);
        evEnd = load<i32>(rules + 28);
      }
    } else {
      const ruleScore: i32 = clampPermille(
        (350 * zero + 350 * neg + 150 * spike + 100 * low + 50 * periodic) / 1000,
      );
      const step: i32 = n > 2 * MIN_DETECTION ? 2 * WINDOW : WINDOW;
      let r: i32 = 0;
      for (let i = 0; i + WINDOW <= n; i += step) {
        windowVector(base, i, i + WINDOW, refs + r * DIMS * 4);
        r++;
      }
      windowVector(base, 0, n, point);
      const trees: i32 = n > 2 * MIN_DETECTION ? 12 : 24;
      const ifScore: i32 = isolationScore(point, refs, r, sample, trees, load<u32>(seedsOff + e * 4));
      score =
        ruleScore < 120
          ? ruleScore
          : clampPermille((650 * <i64>ruleScore + 350 * <i64>ifScore) / 1000);
      method = ruleScore >= 120 && ifScore > ruleScore ? 1 : 0;
      type = score < 50 ? 0 : dominant;
      const dist: i32 = score > 500 ? score - 500 : 500 - score;
      confidence = clampPermille(<i64>(500 + dist));
      evStart = load<i32>(rules + 24);
      evEnd = load<i32>(rules + 28);
    }
    store<i32>(out, score);
    store<i32>(out + 4, type);
    store<i32>(out + 8, method);
    store<i32>(out + 12, confidence);
    store<i32>(out + 16, evStart);
    store<i32>(out + 20, evEnd);
  }
  return 0;
}
