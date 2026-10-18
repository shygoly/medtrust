// 电力时序特征（整数定点）—— 平台签名的 Wasm 算法模块（power.feature-extraction@1.0.0）。
//
// 整数口径的理由与 fl-logistic 相同：承载受托分析逻辑的算子 MUST 是 wasm（D-MDOP-5），
// parity 对拍逐字段相等，所以模块内零浮点。功率值由宿主按统一量纲（缺省 W）取整后传入；
// 表计标识、时间戳都不进入模块，宿主按电表分组后只给各表的数值序列。
//
// ABI v1（小端）：
//   run(inOff: i32, m: i32, period: i32, outOff: i32) -> i32      (0 = 成功)
//   输入 @inOff：
//     offsets u32[m+1]          // 前缀和：第 e 块表的样本在 values[offsets[e], offsets[e+1])
//     values  i32[offsets[m]]   // 各表按时间顺序的整数功率
//   输出 @outOff（每块表 7 + period 个 i32）：
//     n · mean · std · max · min · trendMilli · seasonality · phaseMean[period]
//   定义（全部截断除法 / 向下取整平方根）：
//     mean = Σv / n；std = isqrt(Σ(v-mean)² / n)；
//     a_i = 2i-(n-1)，trendMilli = 1000·2Σa_i·v / Σa_i²（每样本斜率 ×1000，截到 ±(2³¹-1)）；
//     phaseMean[p] = Σ_{i%period=p} v / count_p；seasonality = max(phaseMean) - min(phaseMean)。
//   错误码：1 m 非法 · 2 period 非法 · 3 某表样本数非法 · 4 数值越界 · 5 偏移非单调 · 6 outOff 与输入重叠
//
// 零能力：只导入 env.memory，不导入函数/表/全局量，不分配堆（--runtime stub）。
// 语义必须与 `src/power-features-model.ts#powerFeaturesFixed` 逐字段一致（`scripts/power-features-parity.test.mjs`）。

export const abi_version: i32 = 1;

const MAX_M: i32 = 65536;
const MAX_N: i32 = 65536;
const MAX_PERIOD: i32 = 168;
const MIN_N: i32 = 3;
/** |v| 上限：保证 Σ(v-mean)² 与 2Σa_i·v 不溢出 i64（宿主按量纲缩放）。 */
const MAX_ABS: i32 = 5000000;

const I32_MAX: i64 = 2147483647;

/** 向下取整平方根（逐位法，纯整数）。 */
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

function clampI32(v: i64): i32 {
  if (v > I32_MAX) return <i32>I32_MAX;
  if (v < -I32_MAX) return <i32>(-I32_MAX);
  return <i32>v;
}

export function run(inOff: i32, m: i32, period: i32, outOff: i32): i32 {
  if (m <= 0 || m > MAX_M) return 1;
  if (period != 0 && (period < 2 || period > MAX_PERIOD)) return 2;

  const valuesOff: i32 = inOff + (m + 1) * 4;
  let prev: u32 = load<u32>(inOff);
  if (prev != 0) return 5;
  for (let e = 0; e < m; e++) {
    const next: u32 = load<u32>(inOff + (e + 1) * 4);
    if (next < prev) return 5;
    const n: i32 = <i32>(next - prev);
    if (n < MIN_N || n > MAX_N) return 3;
    prev = next;
  }
  const total: i32 = <i32>prev;
  const inEnd: i32 = valuesOff + total * 4;
  if (outOff < inEnd) return 6;

  const stride: i32 = 7 + period;
  for (let e = 0; e < m; e++) {
    const start: i32 = <i32>load<u32>(inOff + e * 4);
    const end: i32 = <i32>load<u32>(inOff + (e + 1) * 4);
    const n: i32 = end - start;
    const base: i32 = valuesOff + start * 4;

    let sum: i64 = 0;
    let mx: i32 = load<i32>(base);
    let mn: i32 = mx;
    for (let i = 0; i < n; i++) {
      const v: i32 = load<i32>(base + i * 4);
      if (v > MAX_ABS || v < -MAX_ABS) return 4;
      sum += <i64>v;
      if (v > mx) mx = v;
      if (v < mn) mn = v;
    }
    const mean: i64 = sum / <i64>n;

    let sq: i64 = 0;
    let num: i64 = 0;
    for (let i = 0; i < n; i++) {
      const v: i64 = <i64>load<i32>(base + i * 4);
      const d: i64 = v - mean;
      sq += d * d;
      num += <i64>(2 * i - (n - 1)) * v;
    }
    const std: i64 = isqrt64(sq / <i64>n);
    num = num * 2;
    const nn: i64 = <i64>n;
    const den: i64 = (nn * (nn * nn - 1)) / 3;
    const q: i64 = num / den;
    const r: i64 = num - q * den;
    const trendMilli: i64 = q * 1000 + (r * 1000) / den;

    const out: i32 = outOff + e * stride * 4;
    let pmax: i64 = 0;
    let pmin: i64 = 0;
    let any: bool = false;
    for (let p = 0; p < period; p++) {
      let ps: i64 = 0;
      let pc: i64 = 0;
      for (let i = p; i < n; i += period) {
        ps += <i64>load<i32>(base + i * 4);
        pc++;
      }
      let pm: i64 = 0;
      if (pc > 0) {
        pm = ps / pc;
        if (!any || pm > pmax) pmax = pm;
        if (!any || pm < pmin) pmin = pm;
        any = true;
      }
      store<i32>(out + (7 + p) * 4, <i32>pm);
    }

    store<i32>(out, n);
    store<i32>(out + 4, <i32>mean);
    store<i32>(out + 8, <i32>std);
    store<i32>(out + 12, mx);
    store<i32>(out + 16, mn);
    store<i32>(out + 20, clampI32(trendMilli));
    store<i32>(out + 24, any ? <i32>(pmax - pmin) : 0);
  }
  return 0;
}
