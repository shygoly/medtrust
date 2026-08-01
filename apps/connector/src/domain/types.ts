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

export type RwsAnalysisLevel = 'L0' | 'L1' | 'L1.5' | 'L2' | 'L3' | 'L4';
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
  | 'aggregate_metrics'
  | 'validation_metrics'; // rws-algorithm-validation: Se/Sp/PPV/NPV + 95%CI

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
    | 'causal-survival'
    | 'algorithm-validation';
  level?: RwsAnalysisLevel;
  mode?: FederationMode;
  drug?: string;
  outcome?: string;
  outcomeKind?: 'adverse_event' | 'condition';
  stratifyBy?: Array<'ageBand' | 'sex'>;
  method?: CausalMethod;
  tte?: TteSpec;
  allowedArtifacts?: RwsArtifactKind[];
  /** rws-algorithm-validation L0: target variable + algorithm to validate. */
  algorithm?: IdentificationAlgorithm;
  /** Variable definition the gold standard is keyed against (D1). */
  variableDefinitionId?: string;
  /** Version of the gold-standard annotation set the result binds to (D6/version). */
  goldStandardSetVersion?: string;
  // rws-study-protocol-spec (Phase 1 — all optional, no BREAKING).
  /** §2.5 流行病学设计类型 (six-value closed set, see EVIDENCE.md §4). */
  designType?: RwsDesignType;
  /** §2.5 选型理由 — required when designType is present (paired check). */
  rationale?: string;
  /** §2.7.4 结构化结局定义引用 (when the outcome is expressed via an
   * IdentificationAlgorithm rather than free-text `tte.outcome.event`). */
  outcomeAlgorithm?: IdentificationAlgorithm;
  /** §2.7.4 结构化暴露定义引用 (exposure arm). */
  exposureAlgorithm?: IdentificationAlgorithm;
  /** §2.7.4 结构化对照定义引用 (comparator arm). */
  comparatorAlgorithm?: IdentificationAlgorithm;
  /** §3.1/§3.2 SAP — significance level / power / sample size / multiplicity. */
  sap?: SapPlan;
  /** §3.4 缺失值机制 + 填补策略 (paired declaration enforced). */
  missingness?: MissingnessDeclaration;
  /** §3.5 敏感性分析声明 (Phase 1: declaration only; the issuance-blocking
   * reconciliation gate lands in Phase 2/3). */
  sensitivityAnalyses?: SensitivityAnalysisDeclaration[];
}

// rws-study-protocol-spec §2.5 design-type closed set.
// Values pre-registered in EVIDENCE.md §4. The system MUST NOT impose any
// ranking on these (规范 §2.5 "不推荐认定某设计一定优于其他").
export type RwsDesignType =
  | 'cross-sectional'
  | 'cohort'
  | 'case-control'
  | 'nested-case-control'
  | 'case-cohort'
  | 'case-crossover';

/** §3.1/§3.2 统计分析计划 (SAP). Phase 1: shape validation only. */
export interface SapPlan {
  /** Significance level α (two-sided), e.g. 0.05. Phase 1: 0 < α < 1. */
  significanceLevel: number;
  /** Target power (0–1), e.g. 0.8. */
  power?: number;
  /** Sample-size assumption (the number the study is powered for). */
  sampleSizeAssumption?: number;
  /** Free-text justification for the sample-size / power calculation. */
  sampleSizeJustification?: string;
  /** §3.1 multiplicity α-adjustment method (required when the task involves
   * multiple subgroups or multiple drug-event combinations). Phase 1: optional
   * string; Phase 2 enforces per D4. */
  multiplicityAlphaAdjustment?: string;
}

/** §3.4 缺失值机制假设 (one of) + 填补策略 (free text).
 * Both MUST be declared together — Phase 1 validator enforces pairing. */
export interface MissingnessDeclaration {
  mechanism: 'MCAR' | 'MAR' | 'MNAR';
  imputationStrategy: string;
}

/** §3.5 敏感性分析声明. `id` is the reconciliation key (Phase 2/3 gate). */
export interface SensitivityAnalysisDeclaration {
  id: string;
  description: string;
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
  /**
   * rws-study-protocol-spec D6: absolute-risk expression. 《指导原则》§3.1
   * requires both relative AND absolute risk estimates — relative-only is
   * dangerously misleading at low baseline rates (common in drug-safety
   * signals). Derived from the post-gate {a,b,c,d} site counts; MUST NOT
   * be computed from individual data.
   */
  absoluteRisk?: {
    /** Risk difference: P(event|exposed) − P(event|unexposed). */
    riskDifference: number;
    /** 95% CI on the risk difference (Wald on the difference of proportions,
     * bounded to [−1, 1]). */
    ci95: [number, number];
    /** P(event|unexposed) — the baseline the difference is taken against. */
    baselineRate: number;
    /** Provenance: the baseline MUST come from post-gate site aggregate
     * counts, never from individual-level data on the control plane. */
    baselineSource: 'aggregated_site_counts';
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

/**
 * L1.5-data-audit — 逐变量缺失率审计（聚合语义，绝不携带行级/可识别数据）。
 * `present` = 该变量有值（数组为非空数组）的样本数；`missing` = 缺失样本数；
 * `missingRate` = missing / 样本总数；`distribution` = 取值分布摘要（计数）；
 * `flagged` = missingRate > HIGH_MISSING_THRESHOLD (0.3)。
 */
export interface VariableAudit {
  variable: string;
  present: number;
  missing: number;
  missingRate: number;
  distribution: Array<{ value: string; count: number }>;
  flagged: boolean;
}

export interface DataAuditReport {
  totalRows: number;
  variables: VariableAudit[];
  highMissingVariables: string[];
}

export interface QualityReport {
  totalRows: number;
  highMissingVariables: string[];
  audit: DataAuditReport;
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
  /** L1.5-data-audit — 逐变量缺失率/分布审计（聚合结果的一部分，随结果出域）。 */
  dataAudit?: DataAuditReport;
  /** L1.5-data-audit — 质量报告（高缺失变量清单）。 */
  qualityReport?: QualityReport;
  /** rws-algorithm-validation L0: per-provider validation result (D6 分列). */
  validationResult?: ValidationResult;
}

export interface AggregateWarning {
  code: 'insufficient_power' | 'empty_buckets' | 'single_arm' | 'high_missing_rate';
  detail: string;
}

export type AccessOrigin = 'internal' | 'external';

export interface AccessContext {
  origin: AccessOrigin;
  actor: string;
}

// ---------------------------------------------------------------------------
// rws-algorithm-validation (L0)
//
// The operational-definition carrier required by 《指导原则》§2.1/§2.6/§2.7.4:
// structured code sets + closed-grammar boolean combination + assessment time
// window. The connector interprets these — it MUST NOT eval arbitrary code
// (D4 in change design; grammar enforced by grammar-validator.ts).
// ---------------------------------------------------------------------------

/** §2.7.4 四要素: code system + version + codes + value source + diagnosis order. */
export interface CodeSet {
  codeSystem: string; // e.g. 'ICD-10'
  codeSystemVersion: string; // e.g. '2023' — MUST be present (scenario: missing rejected)
  codes: string[];
  /** Which clinical field the codes are matched against. */
  valueSource: 'outpatient_dx' | 'discharge_dx' | 'lab' | 'medication';
  /** Diagnosis-order constraint (§2.7.4 示例). */
  diagnosisOrder: 'primary_only' | 'top3_discharge' | 'any';
}

/** Closed-grammar AST. The grammar validator rejects any other shape. */
export type AlgorithmExpression =
  | { kind: 'codeset'; codeset: CodeSet }
  | { kind: 'and'; children: AlgorithmExpression[] }
  | { kind: 'or'; children: AlgorithmExpression[] }
  | { kind: 'not'; child: AlgorithmExpression }
  | { kind: 'window'; days: number; child: AlgorithmExpression };

/**
 * A variable's operational definition. Versions are immutable: bump `version`
 * to change anything; validation results bind to (algorithmVersion, providerId,
 * goldStandardSetVersion) and are never silently overwritten (D6/version).
 */
export interface IdentificationAlgorithm {
  id: string;
  version: string;
  expression: AlgorithmExpression;
  /** Assessment time window in days (§2.1 操作性定义). */
  assessmentWindowDays?: number;
}

/** 2×2 classifier confusion matrix. NOT the epidemiology {a,b,c,d} contingency. */
export interface ConfusionMatrix {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

/** Point estimate + 95% CI (Wilson score interval — see DOMAIN.md 派生公式区). */
export interface MetricWithCi {
  point: number;
  ci95: [number, number];
}

export interface ValidationMetrics {
  sensitivity: MetricWithCi; // Se = TP/(TP+FN)
  specificity: MetricWithCi; // Sp = TN/(TN+FP)
  ppv: MetricWithCi; // PPV = TP/(TP+FP)
  npv: MetricWithCi; // NPV = TN/(TN+FN)
}

/** Why an L0 result has no metrics. Structurally distinct from "poor accuracy". */
export type ValidationSuppressionReason = 'insufficient_sample';

/**
 * The out-of-domain payload of an L0 task. When `suppressed` is true,
 * `metrics` MUST be undefined — the output gate fails closed on any cell below
 * the suppression threshold (D3). The confusion matrix counts are still
 * returned but with suppressed cells zeroed.
 */
export interface ValidationResult {
  algorithmId: string;
  algorithmVersion: string;
  providerId: string;
  variableDefinitionId: string;
  goldStandardSetVersion: string;
  confusionMatrix: ConfusionMatrix;
  metrics?: ValidationMetrics;
  suppressed: boolean;
  suppressionReason?: ValidationSuppressionReason;
  /** D-RWS-4: TEE level如实标注 (currently 'software' until hardware enclave wires). */
  attestationLevel: 'software' | 'hardware';
  /**
   * rws-algorithm-validation §7.3: provenance of the gold-standard set the
   * result was scored against. Real hospital annotations are `real`; Synthea
   * / synthetic / unit-fixture annotations are `synthetic`.
   *
   * Synthetic results MUST NOT be used for regulatory submission. Carrying
   * the flag through the cross-domain payload makes that contract enforceable
   * at the API/report layer (the UI shows it; the API response exposes it).
   */
  goldStandardProvenance?: 'real' | 'synthetic';
}
