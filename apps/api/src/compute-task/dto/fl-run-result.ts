/**
 * L4 联邦预测任务执行结果（连接器本地 / 控制面聚合后出域）。
 *
 * 存储：ComputeTask.resultSummary.flRunResult（完整信封）
 * UI 扁平字段由 projectFlRunResultToTaskSummary() 投影。
 */

import type {
  FlAggregationStrategy,
  FlModelType,
  FlPredictionArtifactKind,
  FlPredictionTaskSpec,
  FlTaskObjective,
} from "./fl-prediction-task-spec";

export interface FlClassificationMetrics {
  auc?: number;
  f1?: number;
  precision?: number;
  recall?: number;
  accuracy?: number;
}

export interface FlFeatureImportanceEntry {
  feature: string;
  importance: number;
}

export interface FlCalibrationPoint {
  threshold: number;
  truePositiveRate: number;
  falsePositiveRate: number;
}

export interface FlPartyContribution {
  participantId: string;
  sampleCount: number;
  roundsParticipated: number;
  localMetrics?: FlClassificationMetrics;
  localModelHash?: string;
}

/** 单方连接器本地训练产物（聚合前，不出域给 consumer）。 */
export type FlTrainingMode = "sklearn" | "mock";

export interface FlPartyRunResult {
  taskId: string;
  participantId: string;
  roundsCompleted: number;
  sampleCount: number;
  localMetrics: FlClassificationMetrics;
  localModelHash: string;
  /** connector-ml 回传：sklearn 真实训练 vs 无行数据时的 mock */
  trainingMode?: FlTrainingMode;
  /** 任务 6.2: 声明 ε 时须为 true. */
  dpApplied?: boolean;
  dpEpsilon?: number;
}

export interface FlAttestationSummary {
  reportHash: string;
  runtime: "mock" | "connector-ml" | "tee";
  generatedAt: string;
  specHash: string;
  chainTxHash?: string;
  chainBlock?: number;
}

export interface FlPrivacySummary {
  aggregation: FlAggregationStrategy;
  dpEpsilon?: number;
  dpDelta?: number;
  minCohortSize?: number;
  dpApplied?: boolean;
  safeOutputOnly: true;
}

/**
 * 联邦聚合后的全局结果信封。
 * 仅含 outputPolicy 允许的聚合指标与哈希，禁止原始行 / 明文权重。
 */
export interface FlRunResult {
  taskId: string;
  roundsCompleted: number;
  totalRounds: number;
  modelType: FlModelType;
  objective: FlTaskObjective;
  modelHash: string;
  aggregateMetrics: FlClassificationMetrics;
  partyContributions: FlPartyContribution[];
  featureImportance?: FlFeatureImportanceEntry[];
  calibrationCurve?: FlCalibrationPoint[];
  attestation?: FlAttestationSummary;
  privacySummary: FlPrivacySummary;
}

export type FlTaskRunResult = FlRunResult & {
  workloadType: "federated_learning";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isClassificationMetrics(
  value: unknown,
): value is FlClassificationMetrics {
  if (!isRecord(value)) {
    return false;
  }
  const metricKeys = ["auc", "f1", "precision", "recall", "accuracy"] as const;
  return metricKeys.some((key) => key in value && isFiniteNumber(value[key]));
}

export function isFlPartyRunResult(value: unknown): value is FlPartyRunResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.taskId) &&
    isNonEmptyString(value.participantId) &&
    isFiniteNumber(value.roundsCompleted) &&
    isFiniteNumber(value.sampleCount) &&
    value.sampleCount >= 0 &&
    isClassificationMetrics(value.localMetrics) &&
    isNonEmptyString(value.localModelHash)
  );
}

export function isFlRunResult(value: unknown): value is FlRunResult {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !isNonEmptyString(value.taskId) ||
    !isFiniteNumber(value.roundsCompleted) ||
    !isFiniteNumber(value.totalRounds) ||
    !isNonEmptyString(value.modelHash) ||
    !isClassificationMetrics(value.aggregateMetrics)
  ) {
    return false;
  }
  if (
    !Array.isArray(value.partyContributions) ||
    value.partyContributions.length === 0
  ) {
    return false;
  }
  const contributionsValid = value.partyContributions.every(
    (c) =>
      isRecord(c) &&
      isNonEmptyString(c.participantId) &&
      isFiniteNumber(c.sampleCount) &&
      isFiniteNumber(c.roundsParticipated),
  );
  if (!contributionsValid) {
    return false;
  }
  if (
    !isRecord(value.privacySummary) ||
    value.privacySummary.safeOutputOnly !== true
  ) {
    return false;
  }
  return true;
}

/** 按样本量加权平均各方分类指标。 */
export function mergeFlPartyResults(
  partyResults: FlPartyRunResult[],
  spec: FlPredictionTaskSpec,
  options?: { specHash?: string; runtime?: FlAttestationSummary["runtime"] },
): FlRunResult {
  if (partyResults.length === 0) {
    throw new Error("FL merge requires at least one party result");
  }

  const totalSamples = partyResults.reduce((sum, p) => sum + p.sampleCount, 0);
  const weight = (samples: number) =>
    totalSamples > 0 ? samples / totalSamples : 0;

  const weightedMetric = (
    key: keyof FlClassificationMetrics,
  ): number | undefined => {
    let sum = 0;
    let weightSum = 0;
    for (const party of partyResults) {
      const v = party.localMetrics[key];
      if (v === undefined) {
        continue;
      }
      const w = weight(party.sampleCount);
      sum += v * w;
      weightSum += w;
    }
    return weightSum > 0 ? sum / weightSum : undefined;
  };

  const modelHash = `FL:${partyResults
    .map((p) => p.localModelHash)
    .sort()
    .join("|")}`;

  const taskId = partyResults[0].taskId;
  const roundsCompleted = Math.min(
    ...partyResults.map((p) => p.roundsCompleted),
  );

  const result: FlRunResult = {
    taskId,
    roundsCompleted,
    totalRounds: spec.rounds,
    modelType: spec.modelType,
    objective: spec.objective,
    modelHash,
    aggregateMetrics: {
      auc: weightedMetric("auc"),
      f1: weightedMetric("f1"),
      precision: weightedMetric("precision"),
      recall: weightedMetric("recall"),
      accuracy: weightedMetric("accuracy"),
    },
    partyContributions: partyResults.map((p) => ({
      participantId: p.participantId,
      sampleCount: p.sampleCount,
      roundsParticipated: p.roundsCompleted,
      localMetrics: p.localMetrics,
      localModelHash: p.localModelHash,
    })),
    privacySummary: {
      aggregation: spec.aggregation,
      dpEpsilon: spec.privacy?.dpEpsilon,
      dpDelta: spec.privacy?.dpDelta,
      minCohortSize: spec.privacy?.minCohortSize,
      dpApplied: spec.privacy?.dpEpsilon !== undefined
        ? partyResults.every((p) => p.dpApplied)
        : undefined,
      safeOutputOnly: true,
    },
  };

  if (spec.outputPolicy.allowedArtifacts.includes("attestation_report")) {
    const specHash = options?.specHash ?? `spec:${spec.purpose}`;
    result.attestation = {
      reportHash: `ATT:${modelHash.slice(-16)}`,
      runtime: options?.runtime ?? "mock",
      generatedAt: new Date(0).toISOString(),
      specHash,
    };
  }

  if (spec.outputPolicy.allowedArtifacts.includes("feature_importance")) {
    result.featureImportance = spec.featureColumns.map((col, index) => ({
      feature: col.name,
      importance: Number((1 / (index + 1)).toFixed(4)),
    }));
  }

  return result;
}

export function buildMockFlPartyRunResult(
  taskId: string,
  participantId: string,
  sampleCount: number,
  roundsCompleted: number,
): FlPartyRunResult {
  const seed = `${taskId}:${participantId}`.length;
  const base = 0.7 + (seed % 10) / 100;
  return {
    taskId,
    participantId,
    roundsCompleted,
    sampleCount,
    localModelHash: `LOCAL:${participantId}:${roundsCompleted}`,
    trainingMode: "mock",
    dpApplied: true,
    dpEpsilon: 4,
    localMetrics: {
      auc: Number((base + 0.05).toFixed(4)),
      f1: Number((base - 0.02).toFixed(4)),
      precision: Number((base - 0.01).toFixed(4)),
      recall: Number((base + 0.01).toFixed(4)),
    },
  };
}

export function buildMockFlRunResult(
  taskId: string,
  spec: FlPredictionTaskSpec,
): FlTaskRunResult {
  const providers = spec.parties.filter((p) => p.role === "provider");
  const partyResults = providers.map((party, index) =>
    buildMockFlPartyRunResult(
      taskId,
      party.participantId,
      40 + index * 19,
      spec.rounds,
    ),
  );
  const merged = mergeFlPartyResults(partyResults, spec, { runtime: "mock" });
  return { ...merged, workloadType: "federated_learning" };
}

/** 剥离 spec.outputPolicy 未授权的可选字段。 */
export function filterFlRunResultByPolicy(
  result: FlRunResult,
  allowedArtifacts: FlPredictionArtifactKind[],
): FlRunResult {
  const allowed = new Set(allowedArtifacts);
  const filtered: FlRunResult = {
    ...result,
    aggregateMetrics: { ...result.aggregateMetrics },
  };

  if (!allowed.has("feature_importance")) {
    delete filtered.featureImportance;
  }
  if (!allowed.has("calibration_curve")) {
    delete filtered.calibrationCurve;
  }
  if (!allowed.has("attestation_report")) {
    delete filtered.attestation;
  }
  if (!allowed.has("model_hash")) {
    filtered.modelHash = "[withheld]";
  }

  const metrics = { ...filtered.aggregateMetrics };
  const keepAllMetrics = allowed.has("aggregate_metrics");
  if (!keepAllMetrics && !allowed.has("auc")) {
    delete metrics.auc;
  }
  if (!keepAllMetrics && !allowed.has("f1")) {
    delete metrics.f1;
  }
  if (!keepAllMetrics && !allowed.has("precision")) {
    delete metrics.precision;
  }
  if (!keepAllMetrics && !allowed.has("recall")) {
    delete metrics.recall;
  }
  filtered.aggregateMetrics = metrics;

  return filtered;
}
