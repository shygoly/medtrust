import type { PinnedModuleSpec } from "@medtrust/wasm-algorithms";
import type { ExecutionIsolation } from "@medtrust/database";

export type RwsAnalysisType =
  | "adverse-event-signal"
  | "cohort-count"
  | "condition-prevalence"
  | "disproportionality"
  | "comparative-effect"
  | "causal-psm"
  | "causal-survival"
  | "algorithm-validation";

export type CausalMethod = "psm" | "iptw" | "cox";

// rws-study-protocol-spec — closed sets and structured types mirrored from
// apps/api/src/compute-task/dto/rws-analysis-spec.ts (canonical source).
export type RwsDesignType =
  | "cross-sectional"
  | "cohort"
  | "case-control"
  | "nested-case-control"
  | "case-cohort"
  | "case-crossover";

export interface SapPlan {
  significanceLevel: number;
  power?: number;
  sampleSizeAssumption?: number;
  sampleSizeJustification?: string;
  multiplicityAlphaAdjustment?: string;
  // L2-sap-lock (Phase 3): frozen SAP version-control + model signature.
  sapVersion?: string;
  frozenAt?: string;
  dateStamp?: string;
  modelSignature?: string;
}

export interface MissingnessDeclaration {
  mechanism: "MCAR" | "MAR" | "MNAR";
  imputationStrategy: string;
}

export interface SensitivityAnalysisDeclaration {
  id: string;
  description: string;
}

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
  level?: "L0" | "L1" | "L1.5" | "L2" | "L3" | "L4";
  drug?: string;
  outcome?: string;
  outcomeKind?: "adverse_event" | "condition";
  stratifyBy?: Array<"ageBand" | "sex">;
  method?: CausalMethod;
  tte?: TteSpec;
  /** Requested outbound artifact categories (validated against the contract
   * allow-list by the connector PEP). */
  allowedArtifacts?: string[];
  /** rws-algorithm-validation L0: opaque algorithm definition + target variable. */
  algorithm?: {
    id: string;
    version: string;
    expression: unknown;
    assessmentWindowDays?: number | string;
  };
  variableDefinitionId?: string;
  goldStandardSetVersion?: string;
  // rws-study-protocol-spec (Phase 1 — all optional).
  designType?: RwsDesignType;
  rationale?: string;
  outcomeAlgorithm?: { id: string; version: string; expression: unknown };
  exposureAlgorithm?: { id: string; version: string; expression: unknown };
  comparatorAlgorithm?: { id: string; version: string; expression: unknown };
  sap?: SapPlan;
  missingness?: MissingnessDeclaration;
  sensitivityAnalyses?: SensitivityAnalysisDeclaration[];
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
  /** rws-study-protocol-spec D6: absolute-risk expression. Optional; produced
   * from post-gate {a,b,c,d} site counts. See connector types.ts for semantics. */
  absoluteRisk?: {
    riskDifference: number;
    ci95: [number, number];
    baselineRate: number;
    baselineSource: "aggregated_site_counts";
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
  /** rws-study-protocol-spec D6: pooled absolute-risk expression, derived
   * from the merged site baseline rates (NOT from individual data). */
  pooledAbsoluteRisk?: {
    riskDifference: number;
    ci95: [number, number];
    baselineRate: number;
  };
  /** L3-confounding: 未测量混杂稳健性分析 (E-value, VanderWeele & Ding 2017).
   * 因果生存/因果比率 (log_hr) 主结果报告 MUST 附上;使点估计/置信区间被未测量
   * 混杂完全解释(或推到含无效值)所需的最小暴露-混杂联合关联 (RR 尺度)。 */
  unmeasuredConfounding?: {
    method: "evalue";
    evaluePoint: number;
    evalueCi: number;
    interpretation: string;
  };
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
  /** L1.5 池化后重算的失衡指标（按 event key）。 */
  prr?: number;
  prrCi95?: [number, number];
  ror?: number;
  rorCi95?: [number, number];
  chiSqYates?: number;
  ic?: number;
  signal?: boolean;
}

export interface RwsPartyAggregate {
  analysisType: string;
  cohortSize: number;
  outcome?: string;
  buckets: RwsAggregateBucket[];
  effectEstimate?: RwsEffectEstimate;
  kmCurve?: RwsKmCurve;
  /** rws-algorithm-validation L0: per-provider validation result. The connector
   * returns it as part of the aggregate envelope; the orchestrator's L0 merge
   * path collects these into `merged.l0Validation`. */
  validationResult?: Record<string, unknown>;
  /** L2-sap-lock: actual model signature reported by the connector's main-analysis
   * run log, checked against the frozen SAP-declared `sap.modelSignature`. A
   * connector that reports one MUST reproduce the frozen signature; the
   * orchestrator fails closed on divergence. */
  actualModelSignature?: string;
  /** rws-study-protocol-spec §3.5 — sensitivity-analysis results (reconciled
   * against the protocol's declared ids at issuance). */
  sensitivityResults?: Array<{ id: string; result: Record<string, unknown> }>;
}

export type RwsMergedAggregate = RwsPartyAggregate & {
  metaPooled?: RwsMetaPooled;
  /** rws-algorithm-validation L0: per-provider results + attestation (D6 分列). */
  l0Validation?: unknown;
  /** rws-study-protocol-spec §3.5 — union of all sensitivity-analysis
   * results across providers (declared vs returned reconciliation is
   * enforced by the orchestrator's issuance gate, EVD-10). */
  sensitivityAnalysesMerged?: Array<{
    id: string;
    result: Record<string, unknown>;
  }>;
  /** L2-sap-lock: actual model signature recorded in the main-analysis run log,
   * checked against the frozen SAP-declared `sap.modelSignature`. */
  actualModelSignature?: string;
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
  /** Structured egress gate (authoritative). */
  outputPolicy?: {
    preset: "aggregate_only" | "model_only" | "aggregate_and_model";
    allowedArtifacts: string[];
    minCell: number;
    dp:
      | { mode: "none" }
      | { mode: "epsilon"; epsilon: number; budgetScope: "per_task" };
  };
  /** Expanded PEP artifact allow-list (from outputPolicy). */
  allowedArtifacts?: string[];
  /** Implied analysis levels for the preset. */
  allowedLevels?: string[];
  /** Convenience copy of outputPolicy.minCell for the output gate. */
  minCell?: number;
  validUntil: string;
  status: "active" | "draft" | "expired" | "revoked";
  /** algorithm-sandbox「固定算法模块」条款:分析类型 → 模块 SM3(计入合约哈希)。 */
  /**
   * algorithm-sandbox / third-party-module-admission:固定算法模块条款。
   * 旧口径 = 纯 SM3;新口径 = {sm3, tier, review}(第三方必须带层级 + 审查背书)。
   */
  pinnedModules?: Record<string, PinnedModuleSpec>;
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
  /** algorithm-sandbox:该院实际执行隔离(none | wasm-sandbox)。 */
  executionIsolation?: ExecutionIsolation;
  /** algorithm-sandbox:该院实际使用的模块 SM3。 */
  moduleSm3?: string;
  /**
   * third-party-module-admission(task 6.4):该院这次实际跑的模块的准入标注。
   * 取自合约固定条款 —— 医院同意的就是「这个 SM3 + 这个层级 + 这份背书」。
   * 旧口径(纯 SM3 的平台自研模块)按 Tier A 呈现,背书缺省。
   */
  moduleAdmission?: {
    tier: "A" | "B";
    review?: {
      reviewer: string;
      reviewedAt: string;
      reproducibleBuildRef: string;
      confidential: boolean;
    };
  };
  /**
   * on-chain-provider-endorsement:该院对其结果摘要的连接器 SM2 背书。
   * 界面按院显示「证书指纹前若干位 + 验签通过」;签名本身不回显(无意义且冗长),
   * 需要完整签名去链上/存证 payload 取,再用 scripts/verify-endorsement.mjs 独立核验。
   */
  endorsement?: {
    resultSm3: string;
    certFingerprint: string;
    /** 平台入库前已按该院证书验过签(验不过的贡献根本不会入库)。 */
    verified: true;
  };
}

export type RwsOrchestrationStatus =
  "pending" | "running" | "completed" | "partial" | "failed";

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
  /** rws-study-protocol-spec §1.2 方案版本（默认 1，初始提交）。 */
  protocolVersion?: number;
  /** rws-study-protocol-spec §1.6 / §4.1: admission warnings (Phase 1 advisory). */
  protocolWarnings?: string[];
  createdAt: string;
  completedAt?: string;
  /**
   * algorithm-sandbox:任务级执行隔离取所有医院中最弱的一级
   * (任一家 none,任务即 none);无已完成分派时缺省。
   */
  executionIsolation?: ExecutionIsolation;
}

export interface ConnectorPendingTask {
  assignmentId: string;
  taskId: string;
  purpose: string;
  workloadType: "rws";
  analysis: RwsAnalysisSpec;
  contract: ConnectorContractPayload;
  /** algorithm-sandbox:合约固定了模块时的模块引用(D6)。 */
  module?: { analysisType: string; sm3: string };
}
