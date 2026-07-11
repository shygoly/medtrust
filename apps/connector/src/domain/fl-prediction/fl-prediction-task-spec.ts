/**
 * L4 表格数据联邦预测建模任务规格。
 *
 * 与 SecretFlowTaskSpec（多模态 LLM + LoRA）并行，走 WorkloadType.FEDERATED_LEARNING。
 * 数据面只消费 structured_ehr 表格列；产物经 outputPolicy 白名单出域（无原始行）。
 *
 * 存储位置：ComputeTask.algorithmParams.flPredictionSpec
 */

/** 水平联邦：各方特征 schema 一致、样本不同（HFL）。VFL 后续扩展。 */
export type FlFederationMode = 'horizontal';

export type FlModelType = 'xgboost' | 'logistic_regression' | 'random_forest';

export type FlPartyRole = 'provider' | 'consumer' | 'coordinator';

export type FlFeatureDtype = 'numeric' | 'categorical' | 'boolean';

/** 联邦聚合 / 安全协议（底层可映射 SecretFlow SecureBoost 或 FedAvg）。 */
export type FlAggregationStrategy = 'fedavg' | 'secureboost';

export type FlPredictionArtifactKind =
  | 'feature_importance'
  | 'auc'
  | 'f1'
  | 'precision'
  | 'recall'
  | 'model_hash'
  | 'aggregate_metrics'
  | 'calibration_curve'
  | 'attestation_report';

export type FlTaskObjective = 'binary' | 'multiclass' | 'regression';

export interface FlParty {
  participantId: string;
  role: FlPartyRole;
  /** 该院贡献的目录数据产品（连接器 prefetch 元数据 + localDataPath）。 */
  dataProductId: string;
  connectorId?: string;
}

export interface FlFeatureColumn {
  /** 列名，须与 catalog fhirSchema.fields[].name 或 Synthea 导出列一致。 */
  name: string;
  dtype: FlFeatureDtype;
  /** 分类列可选枚举；推理时用于合法性检查。 */
  categories?: string[];
}

export interface FlHyperparameters {
  learningRate?: number;
  maxDepth?: number;
  nEstimators?: number;
  /** 逻辑回归正则系数等。 */
  regularization?: number;
}

export interface FlPrivacySpec {
  dpEpsilon?: number;
  dpDelta?: number;
  /** 最小队列规模（输出门控 / 小单元格抑制）。 */
  minCohortSize?: number;
}

export interface FlOutputPolicy {
  allowedArtifacts: FlPredictionArtifactKind[];
}

/**
 * 表格联邦预测任务声明（控制面契约）。
 * 执行面（FlTaskRunner / connector-ml）必须按此 spec 加载列、训练、聚合、出域。
 */
export interface FlPredictionTaskSpec {
  /** 与数字合约 purpose 对齐，PEP 校验用。 */
  purpose: string;
  federationMode: FlFederationMode;
  parties: FlParty[];
  /** 固定表格模态；L4 路径不混 multimodal。 */
  modality: 'structured_ehr';
  modelType: FlModelType;
  objective: FlTaskObjective;
  targetColumn: string;
  featureColumns: FlFeatureColumn[];
  aggregation: FlAggregationStrategy;
  /** 联邦通信轮次（非本地 epoch）。 */
  rounds: number;
  /** 各方本地训练/拟合超参。 */
  hyperparameters?: FlHyperparameters;
  privacy?: FlPrivacySpec;
  outputPolicy: FlOutputPolicy;
  /**
   * 可选：覆盖 catalog 默认 dataPath（演示用）。
   * 正常运行时由 dataProductId → catalog fhirSchema.dataPath 解析。
   */
  dataPath?: string;
}

const PARTY_ROLES: FlPartyRole[] = ['provider', 'consumer', 'coordinator'];
const MODEL_TYPES: FlModelType[] = ['xgboost', 'logistic_regression', 'random_forest'];
const FEATURE_DTYPES: FlFeatureDtype[] = ['numeric', 'categorical', 'boolean'];
const AGGREGATION_STRATEGIES: FlAggregationStrategy[] = ['fedavg', 'secureboost'];
const OBJECTIVES: FlTaskObjective[] = ['binary', 'multiclass', 'regression'];
const ARTIFACT_KINDS: FlPredictionArtifactKind[] = [
  'feature_importance',
  'auc',
  'f1',
  'precision',
  'recall',
  'model_hash',
  'aggregate_metrics',
  'calibration_curve',
  'attestation_report',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasRequiredFlParties(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.parties) || value.parties.length < 2) {
    return false;
  }
  const providers = value.parties.filter(
    (p) => isRecord(p) && p.role === 'provider' && isNonEmptyString(p.participantId),
  );
  if (providers.length < 2) {
    return false;
  }
  return value.parties.every(
    (party) =>
      isRecord(party) &&
      isNonEmptyString(party.participantId) &&
      typeof party.role === 'string' &&
      PARTY_ROLES.includes(party.role as FlPartyRole) &&
      (party.role !== 'provider' || isNonEmptyString(party.dataProductId)),
  );
}

export function hasRequiredFlFeatures(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.targetColumn)) {
    return false;
  }
  if (!Array.isArray(value.featureColumns) || value.featureColumns.length === 0) {
    return false;
  }
  const target = value.targetColumn.trim();
  const names = new Set<string>();
  for (const col of value.featureColumns) {
    if (!isRecord(col) || !isNonEmptyString(col.name) || typeof col.dtype !== 'string') {
      return false;
    }
    if (!FEATURE_DTYPES.includes(col.dtype as FlFeatureDtype)) {
      return false;
    }
    const name = col.name.trim();
    if (name === target) {
      return false;
    }
    if (names.has(name)) {
      return false;
    }
    names.add(name);
  }
  return true;
}

export function hasRequiredFlOutputPolicy(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.outputPolicy)) {
    return false;
  }
  const { outputPolicy } = value;
  return (
    Array.isArray(outputPolicy.allowedArtifacts) &&
    outputPolicy.allowedArtifacts.length > 0 &&
    outputPolicy.allowedArtifacts.every(
      (a) => typeof a === 'string' && ARTIFACT_KINDS.includes(a as FlPredictionArtifactKind),
    )
  );
}

export function hasRequiredFlModelConfig(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.modality !== 'structured_ehr') {
    return false;
  }
  if (!isNonEmptyString(value.purpose)) {
    return false;
  }
  if (value.federationMode !== 'horizontal') {
    return false;
  }
  if (!MODEL_TYPES.includes(value.modelType as FlModelType)) {
    return false;
  }
  if (!OBJECTIVES.includes(value.objective as FlTaskObjective)) {
    return false;
  }
  if (!AGGREGATION_STRATEGIES.includes(value.aggregation as FlAggregationStrategy)) {
    return false;
  }
  if (typeof value.rounds !== 'number' || value.rounds < 1 || !Number.isInteger(value.rounds)) {
    return false;
  }
  return true;
}

export function isFlPredictionTaskSpec(value: unknown): value is FlPredictionTaskSpec {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasRequiredFlModelConfig(value) &&
    hasRequiredFlParties(value) &&
    hasRequiredFlFeatures(value) &&
    hasRequiredFlOutputPolicy(value)
  );
}

/**
 * CKD 进展 / ESRD 风险演示规格（华山 + 瑞金，水平联邦 XGBoost）。
 * 特征列对齐 packages/demo-scenario ckd-scenario.json → dp-ckd-ehr fhirSchema.fields。
 */
export function ckdEsrdRiskFlPredictionSpec(): FlPredictionTaskSpec {
  return {
    purpose: 'CKD 多中心疗效真实世界研究',
    federationMode: 'horizontal',
    modality: 'structured_ehr',
    parties: [
      {
        participantId: 'p-huashan',
        role: 'provider',
        dataProductId: 'dp-ckd-ehr',
        connectorId: 'cn-huashan',
      },
      {
        participantId: 'p-ruijin',
        role: 'provider',
        dataProductId: 'dp-dkd-cohort',
        connectorId: 'cn-ruijin',
      },
      {
        participantId: 'p-meddata',
        role: 'consumer',
        dataProductId: '',
      },
    ],
    modelType: 'xgboost',
    objective: 'binary',
    targetColumn: 'esrd_event',
    featureColumns: [
      { name: 'egfr', dtype: 'numeric' },
      { name: 'scr', dtype: 'numeric' },
      { name: 'uacr', dtype: 'numeric' },
      { name: 'ckd_stage', dtype: 'categorical', categories: ['G1', 'G2', 'G3', 'G4', 'G5'] },
      { name: 'bp_systolic', dtype: 'numeric' },
    ],
    aggregation: 'secureboost',
    rounds: 5,
    hyperparameters: { maxDepth: 4, learningRate: 0.1, nEstimators: 100 },
    privacy: { dpEpsilon: 1.0, dpDelta: 1e-5, minCohortSize: 5 },
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
