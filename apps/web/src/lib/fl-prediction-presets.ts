/** 与 API FlPredictionTaskSpec 对齐的客户端类型（演示 + 表单构建）。 */

export type FlModelType = 'xgboost' | 'logistic_regression' | 'random_forest';
export type FlAggregationStrategy = 'fedavg' | 'secureboost';

export interface FlFeatureColumn {
  name: string;
  dtype: 'numeric' | 'categorical' | 'boolean';
  categories?: string[];
}

export interface FlPredictionTaskSpec {
  purpose: string;
  federationMode: 'horizontal';
  modality: 'structured_ehr';
  parties: {
    participantId: string;
    role: 'provider' | 'consumer' | 'coordinator';
    dataProductId: string;
    connectorId?: string;
  }[];
  modelType: FlModelType;
  objective: 'binary' | 'multiclass' | 'regression';
  targetColumn: string;
  featureColumns: FlFeatureColumn[];
  aggregation: FlAggregationStrategy;
  rounds: number;
  hyperparameters?: { maxDepth?: number; learningRate?: number; nEstimators?: number };
  privacy?: { dpEpsilon?: number; dpDelta?: number; minCohortSize?: number };
  outputPolicy: { allowedArtifacts: string[] };
}

export const CKD_FL_FEATURE_COLUMNS: FlFeatureColumn[] = [
  { name: 'egfr', dtype: 'numeric' },
  { name: 'scr', dtype: 'numeric' },
  { name: 'uacr', dtype: 'numeric' },
  { name: 'ckd_stage', dtype: 'categorical', categories: ['G1', 'G2', 'G3', 'G4', 'G5'] },
  { name: 'bp_systolic', dtype: 'numeric' },
];

export interface ActiveContractLike {
  id: string;
  providerId: string;
  dataProductId: string;
  purpose: string;
  retention?: string;
  output?: string;
}

/** 从已选数字合约动态构建 spec（保证 provider ↔ dataProduct 与合约一致）。 */
export function buildFlPredictionSpecFromContracts(
  contracts: ActiveContractLike[],
  options: {
    modelType: FlModelType;
    aggregation: FlAggregationStrategy;
    targetColumn: string;
    rounds: number;
    consumerParticipantId: string;
  },
): FlPredictionTaskSpec {
  if (contracts.length < 2) {
    throw new Error('L4 联邦预测至少选择 2 份提供方合约');
  }
  const purpose = contracts[0].purpose;
  if (!contracts.every((c) => c.purpose === purpose)) {
    throw new Error('所选合约的研究目的必须一致');
  }

  const providers = contracts.map((c) => ({
    participantId: String(c.providerId),
    role: 'provider' as const,
    dataProductId: String(c.dataProductId),
  }));

  return {
    purpose,
    federationMode: 'horizontal',
    modality: 'structured_ehr',
    parties: [
      ...providers,
      {
        participantId: options.consumerParticipantId,
        role: 'consumer',
        dataProductId: '',
      },
    ],
    modelType: options.modelType,
    objective: 'binary',
    targetColumn: options.targetColumn,
    featureColumns: CKD_FL_FEATURE_COLUMNS,
    aggregation: options.aggregation,
    rounds: options.rounds,
    hyperparameters: { maxDepth: 4, learningRate: 0.1, nEstimators: 100 },
    privacy: { dpEpsilon: 4.0, dpDelta: 1e-5, minCohortSize: 5 },
    outputPolicy: {
      allowedArtifacts: [
        'feature_importance',
        'auc',
        'f1',
        'model_hash',
        'aggregate_metrics',
        'attestation_report',
      ],
    },
  };
}

export function flAggregationHint(aggregation: FlAggregationStrategy): string {
  return aggregation === 'secureboost'
    ? 'SecureBoost 路径需 MPC 安全聚合（connector-ml sidecar）'
    : 'FedAvg 标准联邦平均（可用 mock 或 connector-ml）';
}
