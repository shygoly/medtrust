/**
 * RWS 分析分级契约(rws-analytics-ladder,组1).
 *
 * 声明一次 RWS 任务的分析层级、联邦执行模式、允许出域的产物类别白名单。
 * 与 SecretFlowTaskSpec / FlPredictionTaskSpec 并列,存于
 * `ComputeTask.algorithmParams.analysis`。
 *
 * 层级:L1 描述 / L1.5 失衡信号 / L2 比较 / L3 因果 / L4 预测。
 * 模式:A = 本地全量 + 中心随机效应 meta(单发);B = 多轮迭代联邦拟合。
 */
export type RwsAnalysisLevel = 'L1' | 'L1.5' | 'L2' | 'L3' | 'L4';

export type FederationMode = 'A' | 'B';

export type RwsArtifactKind =
  | 'cohort_count'
  | 'condition_prevalence'
  | 'adverse_event_signal'
  | 'disproportionality'
  | 'effect_estimate'
  | 'hazard_ratio'
  | 'km_curve'
  | 'meta_pooled'
  | 'model_hash'
  | 'aggregate_metrics';

export const RWS_ANALYSIS_LEVELS: readonly RwsAnalysisLevel[] = ['L1', 'L1.5', 'L2', 'L3', 'L4'];
export const FEDERATION_MODES: readonly FederationMode[] = ['A', 'B'];
export const RWS_ARTIFACT_KINDS: readonly RwsArtifactKind[] = [
  'cohort_count',
  'condition_prevalence',
  'adverse_event_signal',
  'disproportionality',
  'effect_estimate',
  'hazard_ratio',
  'km_curve',
  'meta_pooled',
  'model_hash',
  'aggregate_metrics',
];

/** RWS 分析声明。`type` 为具体分析;`level`/`mode` 缺省时按 L1 / 模式 A 处理。 */
export interface RwsAnalysisSpec {
  type: string;
  level?: RwsAnalysisLevel;
  mode?: FederationMode;
  drug?: string;
  allowedArtifacts?: RwsArtifactKind[];
}

export function isRwsAnalysisLevel(v: unknown): v is RwsAnalysisLevel {
  return typeof v === 'string' && (RWS_ANALYSIS_LEVELS as readonly string[]).includes(v);
}

export function isFederationMode(v: unknown): v is FederationMode {
  return typeof v === 'string' && (FEDERATION_MODES as readonly string[]).includes(v);
}

export function isRwsArtifactKind(v: unknown): v is RwsArtifactKind {
  return typeof v === 'string' && (RWS_ARTIFACT_KINDS as readonly string[]).includes(v);
}

/**
 * 校验 RWS analysis 的可选分级字段——存在才校验,保持向后兼容(仅 `type` 的旧任务照旧通过)。
 * 返回错误信息;合法返回 null。
 */
export function validateRwsAnalysisLadder(analysis: {
  level?: unknown;
  mode?: unknown;
  allowedArtifacts?: unknown;
}): string | null {
  if (analysis.level !== undefined && !isRwsAnalysisLevel(analysis.level)) {
    return `RWS analysis.level must be one of ${RWS_ANALYSIS_LEVELS.join('/')}`;
  }
  if (analysis.mode !== undefined && !isFederationMode(analysis.mode)) {
    return 'RWS analysis.mode must be A or B';
  }
  if (analysis.allowedArtifacts !== undefined) {
    if (
      !Array.isArray(analysis.allowedArtifacts) ||
      !analysis.allowedArtifacts.every(isRwsArtifactKind)
    ) {
      return 'RWS analysis.allowedArtifacts contains an unknown artifact kind';
    }
  }
  return null;
}
