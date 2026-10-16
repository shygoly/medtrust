// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.anomaly-detection@1.0.0 的领域逻辑（任务 5.1，spec: power-theft-detection）。
 *
 * 规则特征（零/负/突变/异常低）+ 简化孤立森林，输出 0–1 异常评分。
 * 只做纯计算，不做 I/O。
 */

export const MIN_DETECTION_DAYS = 30;
const HOURS_PER_DAY = 24;
export const MIN_DETECTION_POINTS = MIN_DETECTION_DAYS * HOURS_PER_DAY;

export type AnomalyType =
  | "zero_power"
  | "negative_power"
  | "power_spike"
  | "abnormally_low"
  | "periodic"
  | "none"
  | "insufficient_data";

export type DetectionMethod = "isolation_forest" | "rule_ensemble";

export interface AnomalyDetectionInput {
  readonly entityId: string;
  /** 有功功率序列（至少 30×24 点，冷启动可更短） */
  readonly powerKw: readonly number[];
  readonly userType?: "industrial" | "commercial" | "residential";
  /** 同类用户基准均值（冷启动 / 异常低功率对照），可选 */
  readonly peerMeanKw?: number;
  readonly anomalyThreshold?: number;
}

export interface AnomalyDetectionResult {
  readonly entityId: string;
  readonly anomalyScore: number;
  readonly anomalyType: AnomalyType;
  readonly detectionMethod: DetectionMethod;
  readonly confidence: number;
  /** 异常证据时段索引区间 [start, end)（样本下标，泛化到日级） */
  readonly evidencePeriod: readonly [number, number];
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function std(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

/** 规则特征：返回各模式强度 0–1 */
export function ruleFeatures(powerKw: readonly number[], peerMean?: number): {
  zero: number;
  negative: number;
  spike: number;
  low: number;
  periodic: number;
  dominantType: AnomalyType;
  evidence: [number, number];
} {
  const n = powerKw.length;
  let zeroCount = 0;
  let negCount = 0;
  let spikeCount = 0;
  let lowCount = 0;
  let firstAnom = -1;
  let lastAnom = -1;

  const m = mean(powerKw);
  const s = Math.max(std(powerKw), 1e-6);
  const lowRef = typeof peerMean === "number" && peerMean > 0 ? peerMean : m;

  for (let i = 0; i < n; i++) {
    const v = powerKw[i]!;
    let hit = false;
    if (v === 0) {
      zeroCount++;
      hit = true;
    }
    if (v < 0) {
      negCount++;
      hit = true;
    }
    if (i > 0) {
      const prev = powerKw[i - 1]!;
      if (Math.abs(v - prev) > 4 * s && Math.abs(v - prev) > Math.abs(m) * 0.5) {
        spikeCount++;
        hit = true;
      }
    }
    if (v >= 0 && v < lowRef * 0.2) {
      lowCount++;
      hit = true;
    }
    if (hit) {
      if (firstAnom < 0) firstAnom = i;
      lastAnom = i + 1;
    }
  }

  // 周期性：按小时桶统计零功率比例，若某时段显著偏高
  const hourZero = Array.from({ length: HOURS_PER_DAY }, () => 0);
  const hourN = Array.from({ length: HOURS_PER_DAY }, () => 0);
  for (let i = 0; i < n; i++) {
    const h = i % HOURS_PER_DAY;
    hourN[h]!++;
    if (powerKw[i] === 0) hourZero[h]!++;
  }
  const hourRates = hourZero.map((z, h) => (hourN[h]! > 0 ? z / hourN[h]! : 0));
  const avgRate = mean(hourRates);
  const periodic = clamp01(Math.max(...hourRates) - avgRate);

  const zero = clamp01(zeroCount / n);
  const negative = clamp01(negCount / Math.max(1, n * 0.02)); // 少量负功率即高分
  const spike = clamp01(spikeCount / Math.max(1, n * 0.02));
  const low = clamp01(lowCount / n);

  const scores: { type: AnomalyType; score: number }[] = [
    { type: "zero_power", score: zero },
    { type: "negative_power", score: negative },
    { type: "power_spike", score: spike },
    { type: "abnormally_low", score: low },
    { type: "periodic", score: periodic },
  ];
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0]!;
  const dominantType: AnomalyType = top.score < 0.05 ? "none" : top.type;
  const evidence: [number, number] =
    firstAnom >= 0 ? [firstAnom, Math.max(firstAnom + 1, lastAnom)] : [0, n];

  return { zero, negative, spike, low, periodic, dominantType, evidence };
}

/**
 * 简化孤立森林：在特征空间上随机切分，路径越短越异常。
 * 特征 = [mean, std, zeroRate, min, max, spikeRate]
 */
export function isolationForestScore(
  features: readonly number[],
  reference: readonly (readonly number[])[],
  opts?: { trees?: number; seed?: number },
): number {
  const trees = opts?.trees ?? 32;
  const seed0 = opts?.seed ?? 42;
  let rng = seed0;
  const next = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 0xffffffff;
  };

  if (reference.length === 0) return 0.5;

  const pathLength = (point: readonly number[], sample: readonly (readonly number[])[], depth: number, limit: number): number => {
    if (depth >= limit || sample.length <= 1) return depth;
    const dim = Math.floor(next() * point.length);
    const vals = sample.map((r) => r[dim]!);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    if (hi <= lo) return depth;
    const split = lo + next() * (hi - lo);
    const left = sample.filter((r) => r[dim]! < split);
    const right = sample.filter((r) => r[dim]! >= split);
    const goLeft = point[dim]! < split;
    const nextSample = goLeft ? left : right;
    if (nextSample.length === 0 || nextSample.length === sample.length) return depth + 1;
    return pathLength(point, nextSample, depth + 1, limit);
  };

  const limit = Math.ceil(Math.log2(Math.max(2, reference.length)));
  let avgPath = 0;
  for (let t = 0; t < trees; t++) {
    // 子采样
    const size = Math.min(reference.length, 64);
    const sample: number[][] = [];
    for (let i = 0; i < size; i++) {
      sample.push([...reference[Math.floor(next() * reference.length)]!]);
    }
    avgPath += pathLength(features, sample, 0, limit);
  }
  avgPath /= trees;
  // 路径越短 → 分数越高；归一化到 0–1
  const expected = limit / 2;
  return clamp01(1 - avgPath / Math.max(expected, 1));
}

function buildFeatureVector(powerKw: readonly number[]): number[] {
  const rules = ruleFeatures(powerKw);
  const m = mean(powerKw);
  const s = std(powerKw);
  return [m, s, rules.zero, Math.min(...powerKw), Math.max(...powerKw), rules.spike];
}

/**
 * 检测单用户异常用电模式。
 *
 * - 样本不足 30 天：返回 `insufficient_data`（冷启动）；若提供 peerMean 则仍给弱规则分。
 * - 否则：规则集成 + 孤立森林取 max。
 */
export function detectAnomaly(input: AnomalyDetectionInput): AnomalyDetectionResult {
  if (typeof input.entityId !== "string" || input.entityId.length === 0) {
    throw new Error("缺少 entityId");
  }
  if (!Array.isArray(input.powerKw) || input.powerKw.length === 0) {
    throw new Error("用电序列不能为空");
  }
  if (!input.powerKw.every((v) => Number.isFinite(v))) {
    throw new Error("用电序列包含非有限数");
  }

  const n = input.powerKw.length;
  if (n < MIN_DETECTION_POINTS) {
    if (typeof input.peerMeanKw === "number" && input.peerMeanKw > 0) {
      const rules = ruleFeatures(input.powerKw, input.peerMeanKw);
      const score = clamp01(Math.max(rules.zero, rules.negative, rules.low) * 0.8);
      return {
        entityId: input.entityId,
        anomalyScore: score,
        anomalyType: score >= 0.3 ? rules.dominantType : "insufficient_data",
        detectionMethod: "rule_ensemble",
        confidence: 0.4,
        evidencePeriod: rules.evidence,
      };
    }
    return {
      entityId: input.entityId,
      anomalyScore: 0,
      anomalyType: "insufficient_data",
      detectionMethod: "rule_ensemble",
      confidence: 0.2,
      evidencePeriod: [0, n],
    };
  }

  const rules = ruleFeatures(input.powerKw, input.peerMeanKw);
  const ruleScore = clamp01(
    0.35 * rules.zero +
      0.35 * rules.negative +
      0.15 * rules.spike +
      0.1 * rules.low +
      0.05 * rules.periodic,
  );

  // 用滑动窗口自构建参考集做孤立森林（长序列加大步长、减树数以控制吞吐）
  const window = HOURS_PER_DAY * 7;
  const step = n > MIN_DETECTION_POINTS * 2 ? window * 2 : window;
  const refs: number[][] = [];
  for (let i = 0; i + window <= n; i += step) {
    refs.push(buildFeatureVector(input.powerKw.slice(i, i + window)));
  }
  if (refs.length === 0) refs.push(buildFeatureVector(input.powerKw));
  const point = buildFeatureVector(input.powerKw);
  const trees = n > MIN_DETECTION_POINTS * 2 ? 12 : 24;
  const ifScore = isolationForestScore(point, refs, { trees, seed: hashId(input.entityId) });

  // 规则主导：孤立森林仅在规则已示警时加权，避免正常曲线被自参照 IF 误抬
  const anomalyScore =
    ruleScore < 0.12
      ? ruleScore
      : clamp01(0.65 * ruleScore + 0.35 * ifScore);
  const method: DetectionMethod =
    ruleScore >= 0.12 && ifScore > ruleScore ? "isolation_forest" : "rule_ensemble";

  return {
    entityId: input.entityId,
    anomalyScore,
    anomalyType: anomalyScore < 0.05 ? "none" : rules.dominantType,
    detectionMethod: method,
    confidence: clamp01(0.5 + Math.abs(anomalyScore - 0.5)),
    evidencePeriod: rules.evidence,
  };
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h || 1;
}

/**
 * 批量检测；用于全正常 / 全异常边界断言。
 */
export function detectAnomalies(
  inputs: readonly AnomalyDetectionInput[],
): AnomalyDetectionResult[] {
  return inputs.map((input) => detectAnomaly(input));
}
