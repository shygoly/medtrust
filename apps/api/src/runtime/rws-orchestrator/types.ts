export type RwsAnalysisType =
  | "adverse-event-signal"
  | "cohort-count"
  | "condition-prevalence"
  | "disproportionality"
  | "comparative-effect"
  | "causal-psm"
  | "causal-survival";

export type CausalMethod = "psm" | "iptw" | "cox";

export interface TteOutcomeSpec {
  type: "time_to_event" | "binary";
  event: string;
  censoring?: "administrative" | "loss_to_followup";
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

export interface RwsAnalysisSpec {
  type: RwsAnalysisType;
  level?: "L1" | "L1.5" | "L2" | "L3" | "L4";
  drug?: string;
  outcome?: string;
  outcomeKind?: "adverse_event" | "condition";
  stratifyBy?: Array<"ageBand" | "sex">;
  method?: CausalMethod;
  tte?: TteSpec;
}

export type RwsEffectMeasure = "log_or" | "log_hr" | "ate";

export interface RwsEffectEstimate {
  measure: RwsEffectMeasure;
  beta: number;
  standardError: number;
  covariance?: number[][];
  ci95: [number, number];
  mantelHaenszel?: {
    logOr: number;
    or: number;
    standardError: number;
    ci95: [number, number];
  };
}

export interface RwsKmBin {
  t: number;
  survival: number;
  atRisk: number;
  suppressed?: boolean;
}

export interface RwsKmCurve {
  bins: RwsKmBin[];
  binWidthDays: number;
}

export interface RwsMetaPooledSuccess {
  merged: true;
  method: "der_simonian_laird";
  pooledEffect: number;
  pooledOr?: number;
  pooledHr?: number;
  pooledSe: number;
  ci95: [number, number];
  orCi95?: [number, number];
  hrCi95?: [number, number];
  heterogeneity: {
    q: number;
    df: number;
    tau2: number;
    i2Percent: number;
  };
  forest: Array<{
    siteId: string;
    effect: number;
    ci95: [number, number];
    weightPercent: number;
  }>;
  inputFingerprint: string;
  resultHash: string;
  attestation: { txHash: string; block: number; hash: string };
}

export interface RwsMetaPooledSkipped {
  merged: false;
  reason: string;
  code: "single_site";
}

export type RwsMetaPooled = RwsMetaPooledSuccess | RwsMetaPooledSkipped;

export interface RwsAggregateBucket {
  key: string;
  count: number;
  rate: number;
  suppressed?: boolean;
  b?: number;
  c?: number;
  d?: number;
}

export interface RwsPartyAggregate {
  analysisType: string;
  cohortSize: number;
  outcome?: string;
  buckets: RwsAggregateBucket[];
  effectEstimate?: RwsEffectEstimate;
  kmCurve?: RwsKmCurve;
}

export type RwsMergedAggregate = RwsPartyAggregate & {
  metaPooled?: RwsMetaPooled;
};

export type AssignmentStatus = "pending" | "running" | "completed" | "failed";

export type RwsProgressStage =
  | "queued"
  | "pulled"
  | "catalog-prefetch"
  | "data-load"
  | "pep-check"
  | "compute"
  | "output-gate"
  | "retention"
  | "complete"
  | "failed";

export interface RwsProgressEvent {
  at: string;
  stage: RwsProgressStage;
  detail?: string;
}

export interface ConnectorContractPayload {
  id: string;
  dataProductId: string;
  providerId: string;
  consumerId: string;
  purpose: string;
  retention: string;
  output: string;
  validUntil: string;
  status: "active" | "draft" | "expired" | "revoked";
}

export interface RwsTaskAssignment {
  assignmentId: string;
  taskId: string;
  providerId: string;
  purpose: string;
  analysis: RwsAnalysisSpec;
  contract: ConnectorContractPayload;
  status: AssignmentStatus;
  progress?: RwsProgressEvent[];
  aggregate?: RwsPartyAggregate;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export type RwsOrchestrationStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed";

export interface RwsOrchestrationRecord {
  taskId: string;
  title: string;
  purpose: string;
  analysis: RwsAnalysisSpec;
  consumerId: string;
  contractIds: string[];
  status: RwsOrchestrationStatus;
  assignments: RwsTaskAssignment[];
  merged?: RwsMergedAggregate;
  /** 顶层存证摘要（从 merged.metaPooled.attestation 提升，便于消费方直接读取链上凭据）。 */
  attestation?: { txHash: string; block: number; hash: string };
  createdAt: string;
  completedAt?: string;
}

export interface ConnectorPendingTask {
  assignmentId: string;
  taskId: string;
  purpose: string;
  workloadType: "rws";
  analysis: RwsAnalysisSpec;
  contract: ConnectorContractPayload;
}
