// power.dr-potential@1.0.0 的整数参考实现 —— 与 Wasm 模块同源。
//
// 语义必须与 `modules/power-dr-potential-as/assembly/power-dr-potential.ts` 逐字段一致；
// 对拍见 `scripts/power-dr-potential-parity.test.mjs`。
import {
  POWER_FIXED_MAX_M,
  POWER_FIXED_MAX_N,
  align8,
  assertIntegerSeries,
  encodePowerSeries,
  readI32s,
} from "./power-fixed";

export const POWER_DR_POTENTIAL_OPERATOR_ID = "power.dr-potential";
export const POWER_DR_POTENTIAL_ANALYSIS_TYPE = "power-dr-potential";
export const POWER_DR_HOURS = 24;
export const POWER_DR_MIN_N = 7 * POWER_DR_HOURS;
export const POWER_DR_STRIDE = 3 * POWER_DR_HOURS + 1;
export const POWER_DR_HEADER_FIELDS = 8;

export interface PowerDrParamsFixed {
  /** 削减比例（千分比）。 */
  curtailPermille: number;
  /** 转移比例（千分比）。 */
  shiftPermille: number;
  /** 非峰（或非谷）时段的折扣（千分比；浮点实现里是 0.3）。 */
  offPeakPermille: number;
  /** 舒适度折算后的保留比例（千分比）。 */
  comfortPermille: number;
  /** 额定容量上限（整数单位；-1 = 无）。 */
  ratedCapUnits: number;
  curtailDeviceCapUnits: number;
  shiftDeviceCapUnits: number;
}

export interface PowerDrPotentialFixed {
  baseline: number[];
  peakCap: number[];
  valleyCap: number[];
  fullLoad: boolean;
}

function assertParams(p: PowerDrParamsFixed): void {
  const permilles = [p.curtailPermille, p.shiftPermille, p.offPeakPermille, p.comfortPermille];
  if (!permilles.every((v) => Number.isInteger(v) && v >= 0 && v <= 1000)) {
    throw new Error("power-dr-potential: 千分比参数须为 0..1000 的整数");
  }
  const caps = [p.ratedCapUnits, p.curtailDeviceCapUnits, p.shiftDeviceCapUnits];
  if (!caps.every((v) => Number.isInteger(v) && v >= -1)) {
    throw new Error("power-dr-potential: 容量参数须为 ≥ -1 的整数（-1 = 无上限）");
  }
}

function capAt(v: bigint, cap: number): bigint {
  return cap >= 0 && BigInt(cap) < v ? BigInt(cap) : v;
}

export function powerDrPotentialFixedOne(
  values: readonly number[],
  p: PowerDrParamsFixed,
): PowerDrPotentialFixed {
  const n = values.length;
  if (n < POWER_DR_MIN_N || n > POWER_FIXED_MAX_N) {
    throw new Error(`power-dr-potential: 单表样本数须在 ${POWER_DR_MIN_N}..${POWER_FIXED_MAX_N}，收到 ${n}`);
  }
  let historyMax = 0;
  for (const v of values) {
    if (v < 0) throw new Error("power-dr-potential: 历史负荷须为非负");
    if (v > historyMax) historyMax = v;
  }
  const baseline: number[] = [];
  let baseSum = 0n;
  for (let h = 0; h < POWER_DR_HOURS; h++) {
    const bucket: number[] = [];
    let sum = 0n;
    for (let i = h; i < n; i += POWER_DR_HOURS) {
      bucket.push(values[i]!);
      sum += BigInt(values[i]!);
    }
    bucket.sort((a, b) => a - b);
    const p25 = BigInt(bucket[(bucket.length - 1) >> 2]!);
    const mean = sum / BigInt(bucket.length);
    const bl = mean < p25 ? mean : p25;
    baseline.push(Number(bl));
    baseSum += bl;
  }
  const peakMean = baseSum / BigInt(POWER_DR_HOURS);
  const fullLoad = baseline.every((b) => BigInt(b) * 100n >= BigInt(historyMax) * 98n);

  const curtail = BigInt(p.curtailPermille);
  const shift = BigInt(p.shiftPermille);
  const offPeak = BigInt(p.offPeakPermille);
  const comfort = BigInt(p.comfortPermille);
  const peakCap: number[] = [];
  const valleyCap: number[] = [];
  for (let h = 0; h < POWER_DR_HOURS; h++) {
    const ld = BigInt(baseline[h]!);
    let cap = 0n;
    if (!fullLoad) {
      cap = (ld * curtail) / 1000n;
      if (ld < peakMean) cap = (cap * offPeak) / 1000n;
      cap = capAt(cap, p.curtailDeviceCapUnits);
      cap = capAt(cap, p.ratedCapUnits);
      cap = (cap * comfort) / 1000n;
    }
    peakCap.push(Number(cap));

    let sh = (peakMean * shift) / 1000n;
    if (ld > peakMean) sh = (sh * offPeak) / 1000n;
    sh = capAt(sh, p.shiftDeviceCapUnits);
    sh = capAt(sh, p.ratedCapUnits);
    sh = (sh * comfort) / 1000n;
    valleyCap.push(Number(sh));
  }
  return { baseline, peakCap, valleyCap, fullLoad };
}

export function powerDrPotentialFixed(
  series: readonly (readonly number[])[],
  p: PowerDrParamsFixed,
): PowerDrPotentialFixed[] {
  if (series.length === 0 || series.length > POWER_FIXED_MAX_M) {
    throw new Error(`power-dr-potential: 表计数须在 1..${POWER_FIXED_MAX_M}`);
  }
  assertParams(p);
  assertIntegerSeries(series, "power-dr-potential");
  return series.map((s) => powerDrPotentialFixedOne(s, p));
}

export interface PowerDrPotentialEncoded {
  bytes: Uint8Array;
  m: number;
  outOff: number;
  outBytes: number;
  requiredBytes: number;
}

export function encodePowerDrPotential(
  series: readonly (readonly number[])[],
  p: PowerDrParamsFixed,
): PowerDrPotentialEncoded {
  assertParams(p);
  assertIntegerSeries(series, "power-dr-potential");
  const block = encodePowerSeries(series, [
    p.curtailPermille,
    p.shiftPermille,
    p.offPeakPermille,
    p.comfortPermille,
    p.ratedCapUnits,
    p.curtailDeviceCapUnits,
    p.shiftDeviceCapUnits,
    0,
  ]);
  const scratch = align8(block.bytes.length);
  const maxBucket = Math.ceil(block.maxSeriesLength / POWER_DR_HOURS);
  const outOff = align8(scratch + maxBucket * 4);
  const outBytes = block.m * POWER_DR_STRIDE * 4;
  return {
    bytes: block.bytes,
    m: block.m,
    outOff,
    outBytes,
    requiredBytes: outOff + outBytes + 65_536,
  };
}

export function decodePowerDrPotentialOutput(bytes: Uint8Array, m: number): PowerDrPotentialFixed[] {
  const all = readI32s(bytes, m * POWER_DR_STRIDE);
  const out: PowerDrPotentialFixed[] = [];
  const H = POWER_DR_HOURS;
  for (let e = 0; e < m; e++) {
    const row = all.slice(e * POWER_DR_STRIDE, (e + 1) * POWER_DR_STRIDE);
    out.push({
      baseline: row.slice(0, H),
      peakCap: row.slice(H, 2 * H),
      valleyCap: row.slice(2 * H, 3 * H),
      fullLoad: row[3 * H] === 1,
    });
  }
  return out;
}
