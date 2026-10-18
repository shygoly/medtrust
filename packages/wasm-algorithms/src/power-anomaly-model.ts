// power.anomaly-detection@1.0.0 的整数参考实现 —— 与 Wasm 模块同源。
//
// 语义必须与 `modules/power-anomaly-as/assembly/power-anomaly.ts` 逐字段一致；
// 对拍见 `scripts/power-anomaly-parity.test.mjs`。
import {
  POWER_FIXED_MAX_M,
  POWER_FIXED_MAX_N,
  align8,
  assertIntegerSeries,
  encodePowerSeries,
  isqrtBig,
  readI32s,
} from "./power-fixed";

export const POWER_ANOMALY_OPERATOR_ID = "power.anomaly-detection";
export const POWER_ANOMALY_ANALYSIS_TYPE = "power-anomaly";
export const POWER_ANOMALY_HOURS = 24;
export const POWER_ANOMALY_MIN_DETECTION = 720;
export const POWER_ANOMALY_WINDOW = 168;
export const POWER_ANOMALY_STRIDE = 6;
export const POWER_ANOMALY_HEADER_FIELDS = 8;
const DIMS = 6;
const SAMPLE_MAX = 64;
const REFS_AT = 88;

export const POWER_ANOMALY_TYPES = [
  "none",
  "zero_power",
  "negative_power",
  "power_spike",
  "abnormally_low",
  "periodic",
  "insufficient_data",
] as const;
export type PowerAnomalyTypeName = (typeof POWER_ANOMALY_TYPES)[number];

export interface PowerAnomalyFixed {
  scorePermille: number;
  type: number;
  /** 0 = rule_ensemble · 1 = isolation_forest */
  method: number;
  confidencePermille: number;
  evidence: [number, number];
}

export interface PowerAnomalyEntityInput {
  values: readonly number[];
  /** 孤立森林种子（u32；0 视作 1）。宿主由表计标识派生。 */
  seed: number;
}

function clampPermille(v: bigint): number {
  if (v < 0n) return 0;
  if (v > 1000n) return 1000;
  return Number(v);
}

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

function lcg(s: number): number {
  return (Math.imul(s, 1664525) + 1013904223) >>> 0;
}

function meanStd(values: readonly number[], start: number, end: number): [bigint, bigint] {
  const n = BigInt(end - start);
  let sum = 0n;
  for (let i = start; i < end; i++) sum += BigInt(values[i]!);
  const mean = sum / n;
  let sq = 0n;
  for (let i = start; i < end; i++) {
    const d = BigInt(values[i]!) - mean;
    sq += d * d;
  }
  return [mean, isqrtBig(sq / n)];
}

function windowVector(values: readonly number[], start: number, end: number): number[] {
  const [mean, stdRaw] = meanStd(values, start, end);
  const s = stdRaw < 1n ? 1n : stdRaw;
  const n = end - start;
  let zeros = 0n;
  let spikes = 0n;
  let mn = values[start]!;
  let mx = mn;
  for (let i = start; i < end; i++) {
    const v = values[i]!;
    if (v === 0) zeros++;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    if (i > start) {
      const d = abs(BigInt(v) - BigInt(values[i - 1]!));
      if (d > 4n * s && 2n * d > abs(mean)) spikes++;
    }
  }
  const spikeDen = Math.trunc(n / 50) > 0 ? BigInt(Math.trunc(n / 50)) : 1n;
  return [
    Number(mean),
    Number(stdRaw),
    clampPermille((zeros * 1000n) / BigInt(n)),
    mn,
    mx,
    clampPermille((spikes * 1000n) / spikeDen),
  ];
}

interface RuleFeaturesFixed {
  zero: number;
  neg: number;
  spike: number;
  low: number;
  periodic: number;
  dominant: number;
  evidence: [number, number];
}

function ruleFeatures(values: readonly number[], peer: number): RuleFeaturesFixed {
  const n = values.length;
  const [mean, stdRaw] = meanStd(values, 0, n);
  const s = stdRaw < 1n ? 1n : stdRaw;
  const lowRef = peer > 0 ? BigInt(peer) : mean;
  let zeros = 0n;
  let negs = 0n;
  let spikes = 0n;
  let lows = 0n;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    let hit = false;
    if (v === 0) {
      zeros++;
      hit = true;
    }
    if (v < 0) {
      negs++;
      hit = true;
    }
    if (i > 0) {
      const d = abs(BigInt(v) - BigInt(values[i - 1]!));
      if (d > 4n * s && 2n * d > abs(mean)) {
        spikes++;
        hit = true;
      }
    }
    if (v >= 0 && 5n * BigInt(v) < lowRef) {
      lows++;
      hit = true;
    }
    if (hit) {
      if (first < 0) first = i;
      last = i + 1;
    }
  }
  let rateSum = 0n;
  let rateMax = 0n;
  for (let h = 0; h < POWER_ANOMALY_HOURS; h++) {
    let hn = 0n;
    let hz = 0n;
    for (let i = h; i < n; i += POWER_ANOMALY_HOURS) {
      hn++;
      if (values[i] === 0) hz++;
    }
    const rate = hn > 0n ? (hz * 1000n) / hn : 0n;
    rateSum += rate;
    if (rate > rateMax) rateMax = rate;
  }
  const periodic = clampPermille(rateMax - rateSum / BigInt(POWER_ANOMALY_HOURS));
  const den = Math.trunc(n / 50) > 0 ? BigInt(Math.trunc(n / 50)) : 1n;
  const zero = clampPermille((zeros * 1000n) / BigInt(n));
  const neg = clampPermille((negs * 1000n) / den);
  const spike = clampPermille((spikes * 1000n) / den);
  const low = clampPermille((lows * 1000n) / BigInt(n));
  let top = zero;
  let type = 1;
  for (const [score, t] of [
    [neg, 2],
    [spike, 3],
    [low, 4],
    [periodic, 5],
  ] as const) {
    if (score > top) {
      top = score;
      type = t;
    }
  }
  return {
    zero,
    neg,
    spike,
    low,
    periodic,
    dominant: top < 50 ? 0 : type,
    evidence: first >= 0 ? [first, last > first + 1 ? last : first + 1] : [0, n],
  };
}

function isolationScore(
  point: readonly number[],
  refs: readonly (readonly number[])[],
  trees: number,
  seed: number,
): number {
  let rng = seed >>> 0 === 0 ? 1 : seed >>> 0;
  const r = refs.length;
  const rr = r < 2 ? 2 : r;
  let limit = 0;
  while (1 << limit < rr) limit++;
  const size = Math.min(r, SAMPLE_MAX);
  let sumPath = 0n;
  for (let t = 0; t < trees; t++) {
    let sample: number[] = [];
    for (let i = 0; i < size; i++) {
      rng = lcg(rng);
      sample.push(rng % r);
    }
    let depth = 0;
    while (depth < limit && sample.length > 1) {
      rng = lcg(rng);
      const dim = rng % DIMS;
      let lo = refs[sample[0]!]![dim]!;
      let hi = lo;
      for (const idx of sample) {
        const v = refs[idx]![dim]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi <= lo) break;
      rng = lcg(rng);
      const split = BigInt(lo) + ((BigInt(rng) * (BigInt(hi) - BigInt(lo))) >> 32n);
      const goLeft = BigInt(point[dim]!) < split;
      const kept = sample.filter((idx) => (BigInt(refs[idx]![dim]!) < split) === goLeft);
      depth++;
      if (kept.length === 0 || kept.length === sample.length) break;
      sample = kept;
    }
    sumPath += BigInt(depth);
  }
  const den = BigInt(trees) * BigInt(limit < 2 ? 2 : limit);
  return clampPermille(1000n - (2000n * sumPath) / den);
}

export function powerAnomalyFixedOne(
  input: PowerAnomalyEntityInput,
  peerMean: number,
): PowerAnomalyFixed {
  const values = input.values;
  const n = values.length;
  if (n < 1 || n > POWER_FIXED_MAX_N) {
    throw new Error(`power-anomaly: 单表样本数须在 1..${POWER_FIXED_MAX_N}，收到 ${n}`);
  }
  const rules = ruleFeatures(values, peerMean);
  if (n < POWER_ANOMALY_MIN_DETECTION) {
    if (peerMean > 0) {
      const mx = Math.max(rules.zero, rules.neg, rules.low);
      const score = clampPermille((BigInt(mx) * 800n) / 1000n);
      return {
        scorePermille: score,
        type: score >= 300 ? rules.dominant : 6,
        method: 0,
        confidencePermille: 400,
        evidence: rules.evidence,
      };
    }
    return { scorePermille: 0, type: 6, method: 0, confidencePermille: 200, evidence: [0, n] };
  }
  const ruleScore = clampPermille(
    (350n * BigInt(rules.zero) +
      350n * BigInt(rules.neg) +
      150n * BigInt(rules.spike) +
      100n * BigInt(rules.low) +
      50n * BigInt(rules.periodic)) /
      1000n,
  );
  const long = n > 2 * POWER_ANOMALY_MIN_DETECTION;
  const step = long ? 2 * POWER_ANOMALY_WINDOW : POWER_ANOMALY_WINDOW;
  const refs: number[][] = [];
  for (let i = 0; i + POWER_ANOMALY_WINDOW <= n; i += step) {
    refs.push(windowVector(values, i, i + POWER_ANOMALY_WINDOW));
  }
  const point = windowVector(values, 0, n);
  const ifScore = isolationScore(point, refs, long ? 12 : 24, input.seed);
  const score =
    ruleScore < 120
      ? ruleScore
      : clampPermille((650n * BigInt(ruleScore) + 350n * BigInt(ifScore)) / 1000n);
  return {
    scorePermille: score,
    type: score < 50 ? 0 : rules.dominant,
    method: ruleScore >= 120 && ifScore > ruleScore ? 1 : 0,
    confidencePermille: clampPermille(BigInt(500 + Math.abs(score - 500))),
    evidence: rules.evidence,
  };
}

function assertPeer(peerMean: number): void {
  if (!Number.isInteger(peerMean) || peerMean < -1) {
    throw new Error("power-anomaly: peerMean 须为整数（-1 = 无）");
  }
}

export function powerAnomalyFixed(
  inputs: readonly PowerAnomalyEntityInput[],
  peerMean: number,
): PowerAnomalyFixed[] {
  if (inputs.length === 0 || inputs.length > POWER_FIXED_MAX_M) {
    throw new Error(`power-anomaly: 表计数须在 1..${POWER_FIXED_MAX_M}`);
  }
  assertPeer(peerMean);
  assertIntegerSeries(
    inputs.map((x) => x.values),
    "power-anomaly",
  );
  return inputs.map((x) => powerAnomalyFixedOne(x, peerMean));
}

export interface PowerAnomalyEncoded {
  bytes: Uint8Array;
  m: number;
  outOff: number;
  outBytes: number;
  requiredBytes: number;
}

export function encodePowerAnomaly(
  inputs: readonly PowerAnomalyEntityInput[],
  peerMean: number,
): PowerAnomalyEncoded {
  assertPeer(peerMean);
  const series = inputs.map((x) => x.values);
  assertIntegerSeries(series, "power-anomaly");
  // header[8] 之后紧跟 seeds[m]，再是 offsets + values：seeds 当作头部的一部分写入
  const header = [peerMean, 0, 0, 0, 0, 0, 0, 0, ...inputs.map((x) => x.seed | 0)];
  const block = encodePowerSeries(series, header);
  const scratch = align8(block.bytes.length);
  let maxRefs = 0;
  for (const s of series) {
    if (s.length >= POWER_ANOMALY_MIN_DETECTION) {
      const step =
        s.length > 2 * POWER_ANOMALY_MIN_DETECTION ? 2 * POWER_ANOMALY_WINDOW : POWER_ANOMALY_WINDOW;
      maxRefs = Math.max(maxRefs, Math.trunc((s.length - POWER_ANOMALY_WINDOW) / step) + 1);
    }
  }
  const outOff = align8(scratch + (REFS_AT + maxRefs * DIMS) * 4);
  const outBytes = block.m * POWER_ANOMALY_STRIDE * 4;
  return {
    bytes: block.bytes,
    m: block.m,
    outOff,
    outBytes,
    requiredBytes: outOff + outBytes + 65_536,
  };
}

export function decodePowerAnomalyOutput(bytes: Uint8Array, m: number): PowerAnomalyFixed[] {
  const all = readI32s(bytes, m * POWER_ANOMALY_STRIDE);
  const out: PowerAnomalyFixed[] = [];
  for (let e = 0; e < m; e++) {
    const row = all.slice(e * POWER_ANOMALY_STRIDE, (e + 1) * POWER_ANOMALY_STRIDE);
    out.push({
      scorePermille: row[0]!,
      type: row[1]!,
      method: row[2]!,
      confidencePermille: row[3]!,
      evidence: [row[4]!, row[5]!],
    });
  }
  return out;
}

/** 表计标识 → 孤立森林种子（宿主侧派生；标识本身不进模块）。 */
export function powerAnomalySeed(entityKey: string): number {
  let h = 0;
  for (let i = 0; i < entityKey.length; i++) h = (Math.imul(h, 31) + entityKey.charCodeAt(i)) >>> 0;
  return h || 1;
}
