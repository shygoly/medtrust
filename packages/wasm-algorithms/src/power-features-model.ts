// power.feature-extraction@1.0.0 的整数参考实现 —— 与 Wasm 模块同源。
//
// 语义必须与 `modules/power-features-as/assembly/power-features.ts` 逐字段一致；
// 两者用同一组夹具对拍（`scripts/power-features-parity.test.mjs`），漂移即测试红。
import {
  POWER_FIXED_MAX_M,
  POWER_FIXED_MAX_N,
  align8,
  assertIntegerSeries,
  clampI32,
  encodePowerSeries,
  isqrtBig,
  readI32s,
} from "./power-fixed";

export const POWER_FEATURES_OPERATOR_ID = "power.feature-extraction";
export const POWER_FEATURES_ANALYSIS_TYPE = "power-features";
export const POWER_FEATURES_MIN_N = 3;
export const POWER_FEATURES_MAX_PERIOD = 168;
/** 每块表输出的定长字段数（不含 phaseMean）。 */
export const POWER_FEATURES_FIXED_FIELDS = 7;

export interface PowerFeaturesFixed {
  n: number;
  mean: number;
  std: number;
  max: number;
  min: number;
  /** 每样本斜率 ×1000。 */
  trendMilli: number;
  seasonality: number;
  phaseMeans: number[];
}

function assertPeriod(period: number): void {
  if (period !== 0 && (!Number.isInteger(period) || period < 2 || period > POWER_FEATURES_MAX_PERIOD)) {
    throw new Error(`power-features: period 须为 0 或 2..${POWER_FEATURES_MAX_PERIOD}，收到 ${period}`);
  }
}

/** 单块表的整数特征（与模块逐步同式）。 */
export function powerFeaturesFixedOne(values: readonly number[], period: number): PowerFeaturesFixed {
  const n = values.length;
  if (n < POWER_FEATURES_MIN_N || n > POWER_FIXED_MAX_N) {
    throw new Error(`power-features: 单表样本数须在 ${POWER_FEATURES_MIN_N}..${POWER_FIXED_MAX_N}，收到 ${n}`);
  }
  const N = BigInt(n);
  let sum = 0n;
  let mx = values[0]!;
  let mn = values[0]!;
  for (const v of values) {
    sum += BigInt(v);
    if (v > mx) mx = v;
    if (v < mn) mn = v;
  }
  const mean = sum / N;

  let sq = 0n;
  let num = 0n;
  for (let i = 0; i < n; i++) {
    const v = BigInt(values[i]!);
    const d = v - mean;
    sq += d * d;
    num += BigInt(2 * i - (n - 1)) * v;
  }
  const std = isqrtBig(sq / N);
  num *= 2n;
  const den = (N * (N * N - 1n)) / 3n;
  const q = num / den;
  const r = num - q * den;
  const trendMilli = clampI32(q * 1000n + (r * 1000n) / den);

  const phaseMeans: number[] = [];
  let pmax = 0n;
  let pmin = 0n;
  let any = false;
  for (let p = 0; p < period; p++) {
    let ps = 0n;
    let pc = 0n;
    for (let i = p; i < n; i += period) {
      ps += BigInt(values[i]!);
      pc++;
    }
    let pm = 0n;
    if (pc > 0n) {
      pm = ps / pc;
      if (!any || pm > pmax) pmax = pm;
      if (!any || pm < pmin) pmin = pm;
      any = true;
    }
    phaseMeans.push(Number(pm));
  }

  return {
    n,
    mean: Number(mean),
    std: Number(std),
    max: mx,
    min: mn,
    trendMilli,
    seasonality: any ? Number(pmax - pmin) : 0,
    phaseMeans,
  };
}

/** 多块表（宿主已按电表分组、已缩放为整数）。 */
export function powerFeaturesFixed(series: readonly (readonly number[])[], period: number): PowerFeaturesFixed[] {
  if (series.length === 0 || series.length > POWER_FIXED_MAX_M) {
    throw new Error(`power-features: 表计数须在 1..${POWER_FIXED_MAX_M}`);
  }
  assertPeriod(period);
  assertIntegerSeries(series, "power-features");
  return series.map((s) => powerFeaturesFixedOne(s, period));
}

export interface PowerFeaturesEncoded {
  bytes: Uint8Array;
  m: number;
  period: number;
  outOff: number;
  outBytes: number;
  /** 内存上限判据（输入 + 输出 + 余量）。 */
  requiredBytes: number;
}

/** 编码为模块输入块（输入写在偏移 0；输出紧随其后、8 字节对齐）。 */
export function encodePowerFeatures(
  series: readonly (readonly number[])[],
  period: number,
): PowerFeaturesEncoded {
  assertPeriod(period);
  assertIntegerSeries(series, "power-features");
  const block = encodePowerSeries(series);
  const outOff = align8(block.bytes.length);
  const outBytes = block.m * (POWER_FEATURES_FIXED_FIELDS + period) * 4;
  return {
    bytes: block.bytes,
    m: block.m,
    period,
    outOff,
    outBytes,
    requiredBytes: outOff + outBytes + 65_536,
  };
}

export function decodePowerFeaturesOutput(
  bytes: Uint8Array,
  m: number,
  period: number,
): PowerFeaturesFixed[] {
  const stride = POWER_FEATURES_FIXED_FIELDS + period;
  const all = readI32s(bytes, m * stride);
  const out: PowerFeaturesFixed[] = [];
  for (let e = 0; e < m; e++) {
    const row = all.slice(e * stride, (e + 1) * stride);
    out.push({
      n: row[0]!,
      mean: row[1]!,
      std: row[2]!,
      max: row[3]!,
      min: row[4]!,
      trendMilli: row[5]!,
      seasonality: row[6]!,
      phaseMeans: row.slice(POWER_FEATURES_FIXED_FIELDS),
    });
  }
  return out;
}
