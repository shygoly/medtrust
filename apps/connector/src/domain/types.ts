// A raw patient record as it exists INSIDE the hospital source system.
// Contains direct identifiers. This shape never leaves the connector and is
// never persisted — it is de-identified immediately on ingestion.
export interface RawPatientRecord {
  patientId: string; // real hospital MRN / id-card — sensitive
  name: string;
  phone?: string;
  birthDate: string; // YYYY-MM-DD
  gender?: string;
  conditions: string[];
  medications: string[];
  adverseEvents: AdverseEvent[];
}

export interface AdverseEvent {
  organSystem: string; // e.g. 肝胆系统
  term: string; // e.g. ALT 升高
  serious: boolean;
}

// De-identified internal record. No direct identifiers. This is the ONLY shape
// persisted in the connector-local store and the ONLY shape compute runs over.
export interface InternalRecord {
  subjectKey: string; // pseudonymous (hashed), not the real id
  ageBand: string; // coarse band, not exact birthDate
  sex?: string;
  conditions: string[];
  medications: string[];
  adverseEvents: AdverseEvent[];
}

// 分析分级(rws-analytics-ladder). L1 描述 / L1.5 失衡信号 / L2 比较 / L3 因果 / L4 预测.
export type RwsAnalysisLevel = 'L1' | 'L1.5' | 'L2' | 'L3' | 'L4';

// 联邦执行模式. A = 本地全量 + 中心随机效应 meta(单发); B = 多轮迭代联邦拟合.
export type FederationMode = 'A' | 'B';

// 允许离开连接器的产物类别白名单.
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

// An RWS analysis definition submitted by the consumer (pharma). It describes
// WHAT to compute; it is executed locally and may only emit aggregates.
export interface RwsAnalysis {
  type: 'adverse-event-signal' | 'cohort-count' | 'condition-prevalence';
  level?: RwsAnalysisLevel; // 缺省视为 L1
  mode?: FederationMode; // 缺省视为 A
  drug?: string; // medication of interest for the cohort
  allowedArtifacts?: RwsArtifactKind[];
}

// Aggregate result — the ONLY thing allowed to leave the connector.
export interface AggregateResult {
  analysisType: string;
  cohortSize: number;
  buckets: { key: string; count: number; rate: number; suppressed?: boolean }[];
}

export type AccessOrigin = 'internal' | 'external';

export interface AccessContext {
  origin: AccessOrigin;
  actor: string;
}
