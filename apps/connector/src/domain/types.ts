// A raw patient record as it exists INSIDE the hospital source system.
export interface RawPatientRecord {
  patientId: string;
  name: string;
  phone?: string;
  birthDate: string;
  gender?: string;
  conditions: string[];
  medications: string[];
  adverseEvents: AdverseEvent[];
  followUpDays?: number;
  eventOccurred?: boolean;
}

export interface AdverseEvent {
  organSystem: string;
  term: string;
  serious: boolean;
}

export interface InternalRecord {
  subjectKey: string;
  ageBand: string;
  sex?: string;
  conditions: string[];
  medications: string[];
  adverseEvents: AdverseEvent[];
  followUpDays?: number;
  eventOccurred?: boolean;
  treated?: boolean;
}

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

export type CausalMethod = 'psm' | 'iptw' | 'cox';

export interface TteOutcomeSpec {
  type: 'time_to_event' | 'binary';
  event: string;
  censoring?: 'administrative' | 'loss_to_followup';
}

export interface TteSpec {
  exposureArm: string;
  comparatorArm: string;
  timeZeroRule: string;
  inclusion: string[];
  exclusion: string[];
  outcome: TteOutcomeSpec;
  graceDays?: number;
  washoutDays?: number;
  matchingCovariates?: string[];
}

export interface RwsAnalysis {
  type:
    | 'adverse-event-signal'
    | 'cohort-count'
    | 'condition-prevalence'
    | 'disproportionality'
    | 'comparative-effect'
    | 'causal-psm'
    | 'causal-survival';
  level?: RwsAnalysisLevel;
  mode?: FederationMode;
  drug?: string;
  outcome?: string;
  outcomeKind?: 'adverse_event' | 'condition';
  stratifyBy?: Array<'ageBand' | 'sex'>;
  method?: CausalMethod;
  tte?: TteSpec;
  allowedArtifacts?: RwsArtifactKind[];
}

export type EffectMeasure = 'log_or' | 'log_hr' | 'ate';

export interface EffectEstimatePayload {
  measure: EffectMeasure;
  beta: number;
  standardError: number;
  covariance?: number[][];
  ci95: [number, number];
  /** 使用的估计器：标准 logistic，或完全分离/小样本时的 Firth 惩罚回归。 */
  method?: 'logistic' | 'firth';
  mantelHaenszel?: {
    logOr: number;
    or: number;
    standardError: number;
    ci95: [number, number];
  };
}

export interface KmBin {
  t: number;
  survival: number;
  atRisk: number;
  suppressed?: boolean;
}

export interface KmCurvePayload {
  bins: KmBin[];
  binWidthDays: number;
}

export interface AggregateResult {
  analysisType: string;
  cohortSize: number;
  outcome?: string;
  buckets: {
    key: string;
    count: number;
    rate: number;
    suppressed?: boolean;
    b?: number;
    c?: number;
    d?: number;
  }[];
  effectEstimate?: EffectEstimatePayload;
  kmCurve?: KmCurvePayload;
  /** 4.5/4.12 — output-gate warnings (statistical power, empty buckets, …). */
  warnings?: AggregateWarning[];
}

export interface AggregateWarning {
  code: 'insufficient_power' | 'empty_buckets' | 'single_arm';
  detail: string;
}

export type AccessOrigin = 'internal' | 'external';

export interface AccessContext {
  origin: AccessOrigin;
  actor: string;
}
