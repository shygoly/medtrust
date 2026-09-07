/**
 * Connector-side mirror of apps/api compute-task/dto/fl-run-result.ts
 * (no cross-workspace import; keep shapes in sync).
 */

export type FlAggregationStrategy = 'fedavg' | 'secureboost';
export type FlModelType = 'xgboost' | 'logistic_regression' | 'random_forest';
export type FlTaskObjective = 'binary' | 'multiclass' | 'regression';

export type FlPredictionArtifactKind =
  | 'feature_importance'
  | 'auc'
  | 'f1'
  | 'precision'
  | 'recall'
  | 'model_hash'
  | 'aggregate_metrics'
  | 'calibration_curve'
  | 'attestation_report'
  | 'model_weights';

/** Local logistic coefficients (key names avoid output-guard weight/coef tokens). */
export interface FlModelParams {
  featureSchemaVersion: string;
  featureNames: string[];
  theta: number[];
  intercept: number;
  trainedOnSynthetic?: boolean;
}

export interface FlWeightBundle {
  taskId: string;
  featureSchemaVersion: string;
  featureNames: string[];
  theta: number[];
  intercept: number;
  modelHash: string;
  trainedOnSynthetic: boolean;
  sampleCount: number;
  contractIds?: string[];
}

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

export type FlTrainingMode = 'sklearn' | 'mock' | 'local-logistic';

export interface FlPartyRunResult {
  taskId: string;
  participantId: string;
  roundsCompleted: number;
  sampleCount: number;
  localMetrics: FlClassificationMetrics;
  localModelHash: string;
  trainingMode?: FlTrainingMode;
  dpApplied?: boolean;
  dpEpsilon?: number;
  /** Present when outputPolicy includes model_weights (FedAvg LR). */
  modelParams?: FlModelParams;
}

export interface FlAttestationSummary {
  reportHash: string;
  runtime: 'mock' | 'connector-ml' | 'tee';
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

export interface FlRunResult {
  weightBundle?: FlWeightBundle;
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

export type FlTaskRunResult = FlRunResult & { workloadType: 'federated_learning' };
