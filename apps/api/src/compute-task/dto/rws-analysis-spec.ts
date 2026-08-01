/**
 * RWS 分析分级契约(rws-analytics-ladder,组1 + 组5 TTE).
 */
export type RwsAnalysisLevel = "L0" | "L1" | "L1.5" | "L2" | "L3" | "L4";

export type FederationMode = "A" | "B";

export type RwsArtifactKind =
  | "cohort_count"
  | "condition_prevalence"
  | "adverse_event_signal"
  | "disproportionality"
  | "effect_estimate"
  | "hazard_ratio"
  | "km_curve"
  | "meta_pooled"
  | "model_hash"
  | "aggregate_metrics"
  | "validation_metrics";

export const RWS_ANALYSIS_LEVELS: readonly RwsAnalysisLevel[] = [
  "L0",
  "L1",
  "L1.5",
  "L2",
  "L3",
  "L4",
];
export const FEDERATION_MODES: readonly FederationMode[] = ["A", "B"];
export const RWS_ARTIFACT_KINDS: readonly RwsArtifactKind[] = [
  "cohort_count",
  "condition_prevalence",
  "adverse_event_signal",
  "disproportionality",
  "effect_estimate",
  "hazard_ratio",
  "km_curve",
  "meta_pooled",
  "model_hash",
  "aggregate_metrics",
  "validation_metrics",
];

export type CausalMethod = "psm" | "iptw" | "cox";

export const CAUSAL_METHODS: readonly CausalMethod[] = ["psm", "iptw", "cox"];

// rws-study-protocol-spec §2.5 — closed design-type set (pre-registered in
// EVIDENCE.md §4). System MUST NOT impose any ranking (规范 §2.5).
export type RwsDesignType =
  | "cross-sectional"
  | "cohort"
  | "case-control"
  | "nested-case-control"
  | "case-cohort"
  | "case-crossover";

export const RWS_DESIGN_TYPES: readonly RwsDesignType[] = [
  "cross-sectional",
  "cohort",
  "case-control",
  "nested-case-control",
  "case-cohort",
  "case-crossover",
];

// rws-study-protocol-spec §3.4 — missingness mechanism closed set.
export type MissingnessMechanism = "MCAR" | "MAR" | "MNAR";
export const MISSINGNESS_MECHANISMS: readonly MissingnessMechanism[] = [
  "MCAR",
  "MAR",
  "MNAR",
];

/** §3.1/§3.2 SAP (Phase 1: shape validation only; Phase 2 enforces by level). */
export interface SapPlan {
  significanceLevel: number;
  power?: number;
  sampleSizeAssumption?: number;
  sampleSizeJustification?: string;
  multiplicityAlphaAdjustment?: string;
  // L2-sap-lock (Phase 3): the SAP MUST be version-controlled and frozen
  // before any result lock can happen, and MUST declare a frozen model
  // signature that the main-analysis run log can be checked against.
  /** §1.2 版本控制标识（如 "v1"）。 */
  sapVersion?: string;
  /** 冻结日期戳（ISO 时间戳）。与 dateStamp 二选一。 */
  frozenAt?: string;
  /** 冻结日期戳别名。与 frozenAt 二选一。 */
  dateStamp?: string;
  /** 冻结模型签名（method + covariates + model form 的内容寻址摘要）。 */
  modelSignature?: string;
}

/** §3.4 缺失值声明 (mechanism + strategy MUST be paired). */
export interface MissingnessDeclaration {
  mechanism: MissingnessMechanism;
  imputationStrategy: string;
}

/** §3.5 敏感性分析声明. */
export interface SensitivityAnalysisDeclaration {
  id: string;
  description: string;
}

export type RwsAnalysisType =
  | "adverse-event-signal"
  | "cohort-count"
  | "condition-prevalence"
  | "disproportionality"
  | "comparative-effect"
  | "causal-psm"
  | "causal-survival"
  | "algorithm-validation";

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
  type: RwsAnalysisType | string;
  level?: RwsAnalysisLevel;
  mode?: FederationMode;
  drug?: string;
  outcome?: string;
  outcomeKind?: "adverse_event" | "condition";
  stratifyBy?: Array<"ageBand" | "sex">;
  method?: CausalMethod;
  tte?: TteSpec;
  allowedArtifacts?: RwsArtifactKind[];
  /** rws-algorithm-validation L0 — opaque on the control plane; the connector
   * parses & grammar-validates it. Mirrors connector types.ts for type-safety. */
  algorithm?: {
    id: string;
    version: string;
    expression: unknown;
    assessmentWindowDays?: number | string;
  };
  /** L0: target variable definition id (gold standard key). */
  variableDefinitionId?: string;
  /** L0: version of the gold-standard annotation set the result binds to. */
  goldStandardSetVersion?: string;
  // rws-study-protocol-spec (Phase 1 — all optional).
  /** §2.5 design type (closed set). */
  designType?: RwsDesignType;
  /** §2.5 design rationale — required when designType is present. */
  rationale?: string;
  /** §2.7.4 structured outcome definition ref (independence check target). */
  outcomeAlgorithm?: { id: string; version: string; expression: unknown };
  /** §2.7.4 structured exposure-arm ref. */
  exposureAlgorithm?: { id: string; version: string; expression: unknown };
  /** §2.7.4 structured comparator-arm ref. */
  comparatorAlgorithm?: { id: string; version: string; expression: unknown };
  /** §3.1/§3.2 SAP. */
  sap?: SapPlan;
  /** §3.4 missingness declaration. */
  missingness?: MissingnessDeclaration;
  /** §3.5 sensitivity analyses declared by the protocol. */
  sensitivityAnalyses?: SensitivityAnalysisDeclaration[];
}

export function isRwsAnalysisLevel(v: unknown): v is RwsAnalysisLevel {
  return (
    typeof v === "string" &&
    (RWS_ANALYSIS_LEVELS as readonly string[]).includes(v)
  );
}

export function isFederationMode(v: unknown): v is FederationMode {
  return (
    typeof v === "string" && (FEDERATION_MODES as readonly string[]).includes(v)
  );
}

export function isRwsArtifactKind(v: unknown): v is RwsArtifactKind {
  return (
    typeof v === "string" &&
    (RWS_ARTIFACT_KINDS as readonly string[]).includes(v)
  );
}

export function isCausalMethod(v: unknown): v is CausalMethod {
  return (
    typeof v === "string" && (CAUSAL_METHODS as readonly string[]).includes(v)
  );
}

export function validateTteSpec(tte: TteSpec): string | null {
  if (!tte.timeZeroRule?.trim()) {
    return "TTE timeZeroRule must be a non-empty string";
  }
  if (!tte.exposureArm?.trim() || !tte.comparatorArm?.trim()) {
    return "TTE exposureArm and comparatorArm are required";
  }
  if (!Array.isArray(tte.inclusion)) {
    return "TTE inclusion must be an array";
  }
  if (!Array.isArray(tte.exclusion)) {
    return "TTE exclusion must be an array";
  }
  if (!tte.outcome?.event?.trim()) {
    return "TTE outcome.event must be a non-empty string";
  }
  if (tte.outcome.type !== "time_to_event" && tte.outcome.type !== "binary") {
    return "TTE outcome.type must be time_to_event or binary";
  }
  return null;
}

// ---------------------------------------------------------------------------
// rws-study-protocol-spec — Phase 1 protocol-shape validators.
//
// Phase 1 contract: every new field is OPTIONAL. When present, these helpers
// validate shape / pairing / closed-set membership. They do NOT enforce
// presence-by-level (Phase 2 / task 3.1) nor freeze-on-dispatch (Phase 3 / §2).
// ---------------------------------------------------------------------------

/** §2.5 design type + rationale paired check (rationale required when designType present). */
function validateDesignType(analysis: {
  designType?: unknown;
  rationale?: unknown;
}): string | null {
  if (analysis.designType === undefined) return null;
  if (
    typeof analysis.designType !== "string" ||
    !(RWS_DESIGN_TYPES as readonly string[]).includes(analysis.designType)
  ) {
    return `RWS analysis.designType must be one of ${RWS_DESIGN_TYPES.join(" | ")}`;
  }
  // designType without rationale is meaningless — paired check fires even in
  // Phase 1 (it's a form check, not a "requirement" check).
  if (typeof analysis.rationale !== "string" || !analysis.rationale.trim()) {
    return "RWS analysis.rationale is required when designType is present (§2.5 选型理由)";
  }
  return null;
}

/** §3.1/§3.2 SAP shape validation (Phase 1). Does NOT enforce presence by level. */
function validateSapShape(sap: unknown): string | null {
  if (sap === undefined) return null;
  if (!sap || typeof sap !== "object")
    return "RWS analysis.sap must be an object";
  const s = sap as Record<string, unknown>;
  if (
    typeof s.significanceLevel !== "number" ||
    s.significanceLevel <= 0 ||
    s.significanceLevel >= 1
  ) {
    return "SAP.significanceLevel must be a number in (0, 1)";
  }
  if (s.power !== undefined) {
    if (typeof s.power !== "number" || s.power <= 0 || s.power >= 1) {
      return "SAP.power must be a number in (0, 1)";
    }
  }
  if (s.sampleSizeAssumption !== undefined) {
    if (
      typeof s.sampleSizeAssumption !== "number" ||
      s.sampleSizeAssumption <= 0 ||
      !Number.isFinite(s.sampleSizeAssumption)
    ) {
      return "SAP.sampleSizeAssumption must be a positive finite number";
    }
  }
  if (s.multiplicityAlphaAdjustment !== undefined) {
    if (
      typeof s.multiplicityAlphaAdjustment !== "string" ||
      !s.multiplicityAlphaAdjustment.trim()
    ) {
      return "SAP.multiplicityAlphaAdjustment must be a non-empty string when present";
    }
  }
  return null;
}

/**
 * L2-sap-lock — derive a deterministic, content-addressed model signature from
 * a frozen SAP's model definition (method + covariates + outcome + arms).
 *
 * The result is the value the main-analysis run log MUST reproduce before a
 * result can be locked: any change to the frozen covariate list (or method /
 * outcome / arms) changes the signature, so a run that silently used a
 * different model is detectable by signature mismatch (§3.1 / 附1·2 "预先指明
 * 用于构建倾向评分模型的变量").
 *
 * Deterministic: same model definition always yields the same signature.
 * Covariate-sensitive: dropping / reordering covariates changes the signature.
 */
export function computeSapModelSignature(
  sap: Record<string, unknown>,
): string {
  const method = String(sap.method ?? "none");
  const covariates = Array.isArray(sap.covariates)
    ? [...sap.covariates].map(String).sort()
    : [];
  const outcome = String(sap.outcome ?? "");
  const exposureArm = String(sap.exposureArm ?? "");
  const comparatorArm = String(sap.comparatorArm ?? "");
  return [
    "sap-sig",
    method,
    covariates.join(","),
    outcome,
    exposureArm,
    comparatorArm,
  ].join("|");
}

/**
 * L2-sap-lock — SAP version-control / date-stamp / model-signature freeze
 * check. The SAP MUST carry a version-control identity (`sapVersion`) and a
 * freeze date stamp (`frozenAt` / `dateStamp`) BEFORE any result lock can
 * happen, and MUST declare a frozen model signature (`modelSignature`).
 *
 * Kept as a standalone helper (not hard-wired into `validateRwsAnalysisLadder`)
 * so Phase 1/2 "SAP is optional shape" semantics are preserved for pre-freeze
 * admission while the freeze gate can be enforced by callers that lock results.
 */
export function validateSapLock(sap: unknown): string | null {
  if (sap === undefined || sap === null) return null;
  if (typeof sap !== "object") return "SAP must be an object";
  const s = sap as Record<string, unknown>;
  if (typeof s.sapVersion !== "string" || !s.sapVersion.trim()) {
    return "SAP.sapVersion is required (§1.2 版本控制身份)";
  }
  const hasFrozenAt =
    typeof s.frozenAt === "string" && s.frozenAt.trim().length > 0;
  const hasDateStamp =
    typeof s.dateStamp === "string" && s.dateStamp.trim().length > 0;
  if (!hasFrozenAt && !hasDateStamp) {
    return "SAP.frozenAt (or dateStamp) is required (§3.1 冻结日期戳)";
  }
  if (
    typeof s.modelSignature !== "string" ||
    !s.modelSignature.trim()
  ) {
    return "SAP.modelSignature is required (L2-sap-lock 模型签名冻结)";
  }
  return null;
}

/** §3.4 missingness mechanism + imputation strategy MUST be paired. */
function validateMissingness(missingness: unknown): string | null {
  if (missingness === undefined) return null;
  if (!missingness || typeof missingness !== "object") {
    return "RWS analysis.missingness must be an object";
  }
  const m = missingness as Record<string, unknown>;
  const mechanismOk =
    typeof m.mechanism === "string" &&
    (MISSINGNESS_MECHANISMS as readonly string[]).includes(m.mechanism);
  const strategyOk =
    typeof m.imputationStrategy === "string" &&
    m.imputationStrategy.trim().length > 0;
  if (!mechanismOk && !strategyOk) {
    return "missingness requires both mechanism (MCAR|MAR|MNAR) and imputationStrategy";
  }
  if (!mechanismOk) {
    return `missingness.mechanism must be one of ${MISSINGNESS_MECHANISMS.join(" | ")}`;
  }
  if (!strategyOk) {
    return "missingness.imputationStrategy is required when missingness is declared (§3.4 paired declaration)";
  }
  return null;
}

/** §3.5 sensitivity-analysis declaration shape. */
function validateSensitivityAnalyses(sas: unknown): string | null {
  if (sas === undefined) return null;
  if (!Array.isArray(sas)) {
    return "RWS analysis.sensitivityAnalyses must be an array";
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < sas.length; i++) {
    const sa = sas[i] as Record<string, unknown> | null | undefined;
    if (!sa || typeof sa !== "object") {
      return `sensitivityAnalyses[${i}] must be an object`;
    }
    if (typeof sa.id !== "string" || !sa.id.trim()) {
      return `sensitivityAnalyses[${i}].id must be a non-empty string`;
    }
    if (typeof sa.description !== "string" || !sa.description.trim()) {
      return `sensitivityAnalyses[${i}].description must be a non-empty string`;
    }
    if (seenIds.has(sa.id)) {
      return `sensitivityAnalyses[${i}].id "${sa.id}" duplicates an earlier entry`;
    }
    seenIds.add(sa.id);
  }
  return null;
}

/** Collect all code-set member codes referenced anywhere in a closed-grammar
 * algorithm expression. Used by the outcome-exposure independence check —
 * §2.7.4 red line is code-set *membership*, so we only collect codes, not the
 * code-system identifier (both arms legitimately using ICD-10 is fine).
 * Walks the AST defensively — the connector does the strict grammar check. */
function collectAlgorithmCodes(expr: unknown, acc: Set<string>): void {
  if (!expr || typeof expr !== "object") return;
  const e = expr as Record<string, unknown>;
  if (e.kind === "codeset" && e.codeset && typeof e.codeset === "object") {
    const cs = e.codeset as Record<string, unknown>;
    if (Array.isArray(cs.codes)) {
      for (const c of cs.codes) if (typeof c === "string") acc.add(c);
    }
  }
  if (Array.isArray(e.children)) {
    for (const c of e.children) collectAlgorithmCodes(c, acc);
  }
  if (e.child) collectAlgorithmCodes(e.child, acc);
}

/** §2.7.4 outcome-exposure independence. When BOTH the outcome and (exposure
 * or comparator) are expressed as structured IdentificationAlgorithm refs,
 * intersect their code sets. Non-empty intersection → error (fail-closed).
 *
 * Returns `null` to accept; returns a string to reject. Caller treats the
 * "free text — no algorithm refs" case separately and surfaces a warning
 * (see computeProtocolWarnings). */
function validateOutcomeExposureIndependence(analysis: {
  outcomeAlgorithm?: unknown;
  exposureAlgorithm?: unknown;
  comparatorAlgorithm?: unknown;
}): string | null {
  const has = (v: unknown) => v && typeof v === "object";
  if (!has(analysis.outcomeAlgorithm)) return null;
  if (!has(analysis.exposureAlgorithm) && !has(analysis.comparatorAlgorithm)) {
    return null;
  }
  const outcomeCodes = new Set<string>();
  collectAlgorithmCodes(
    (analysis.outcomeAlgorithm as { expression?: unknown }).expression,
    outcomeCodes,
  );
  const exposureCodes = new Set<string>();
  if (has(analysis.exposureAlgorithm)) {
    collectAlgorithmCodes(
      (analysis.exposureAlgorithm as { expression?: unknown }).expression,
      exposureCodes,
    );
  }
  if (has(analysis.comparatorAlgorithm)) {
    collectAlgorithmCodes(
      (analysis.comparatorAlgorithm as { expression?: unknown }).expression,
      exposureCodes,
    );
  }
  const intersection = [...outcomeCodes].filter((c) => exposureCodes.has(c));
  if (intersection.length > 0) {
    return `结局定义与暴露定义存在编码交集(§2.7.4 硬要求)：${intersection.slice(0, 5).join(", ")}${intersection.length > 5 ? " 等" : ""}`;
  }
  return null;
}

export function validateRwsAnalysisLadder(analysis: {
  type?: unknown;
  level?: unknown;
  mode?: unknown;
  method?: unknown;
  drug?: unknown;
  outcome?: unknown;
  tte?: unknown;
  allowedArtifacts?: unknown;
  algorithm?: unknown;
  variableDefinitionId?: unknown;
  // rws-study-protocol-spec Phase 1 fields
  designType?: unknown;
  rationale?: unknown;
  sap?: unknown;
  missingness?: unknown;
  sensitivityAnalyses?: unknown;
  outcomeAlgorithm?: unknown;
  exposureAlgorithm?: unknown;
  comparatorAlgorithm?: unknown;
}): string | null {
  if (analysis.level !== undefined && !isRwsAnalysisLevel(analysis.level)) {
    return `RWS analysis.level must be one of ${RWS_ANALYSIS_LEVELS.join("/")}`;
  }
  if (analysis.mode !== undefined && !isFederationMode(analysis.mode)) {
    return "RWS analysis.mode must be A or B";
  }
  if (analysis.method !== undefined && !isCausalMethod(analysis.method)) {
    return "RWS analysis.method must be psm, iptw, or cox";
  }
  if (analysis.tte !== undefined) {
    if (!analysis.tte || typeof analysis.tte !== "object") {
      return "RWS analysis.tte must be an object";
    }
    const tteErr = validateTteSpec(analysis.tte as TteSpec);
    if (tteErr) return tteErr;
  }
  if (analysis.allowedArtifacts !== undefined) {
    if (
      !Array.isArray(analysis.allowedArtifacts) ||
      !analysis.allowedArtifacts.every(isRwsArtifactKind)
    ) {
      return "RWS analysis.allowedArtifacts contains an unknown artifact kind";
    }
  }
  // rws-algorithm-validation (L0): the operational definition must be present
  // and reference a target variable. Grammar is enforced inside the connector
  // (the control plane only sees the algorithm as opaque structured data).
  if (analysis.type === "algorithm-validation") {
    if (
      !analysis.algorithm ||
      typeof analysis.algorithm !== "object" ||
      !(analysis.algorithm as { id?: unknown; version?: unknown }).id ||
      !(analysis.algorithm as { id?: unknown; version?: unknown }).version
    ) {
      return "algorithm-validation requires algorithm.id and algorithm.version";
    }
    if (
      !analysis.variableDefinitionId ||
      typeof analysis.variableDefinitionId !== "string"
    ) {
      return "algorithm-validation requires variableDefinitionId";
    }
  }
  // rws-study-protocol-spec Phase 1 protocol-shape validators.
  const designErr = validateDesignType(analysis);
  if (designErr) return designErr;
  const sapErr = validateSapShape(analysis.sap);
  if (sapErr) return sapErr;
  const missingnessErr = validateMissingness(analysis.missingness);
  if (missingnessErr) return missingnessErr;
  const sensErr = validateSensitivityAnalyses(analysis.sensitivityAnalyses);
  if (sensErr) return sensErr;
  const independenceErr = validateOutcomeExposureIndependence(analysis);
  if (independenceErr) return independenceErr;

  // rws-study-protocol-spec Phase 2 — required-by-level enforcement.
  // designType + rationale required for all real study types; L0
  // (algorithm-validation) is exempt because it is a validation procedure,
  // not an epidemiological study.
  const isL0 = analysis.type === "algorithm-validation";
  if (!isL0) {
    if (analysis.designType === undefined) {
      return "RWS analysis.designType is required (§2.5 流行病学设计类型必须声明)";
    }
    // rationale paired-check already done by validateDesignType above.
  }
  // SAP required for L2/L3/L4 (D4). L1.5 single-combo is exempt; L1.5 scanning
  // multiple drug-event combos MUST declare multiplicity α-adjustment.
  const level = analysis.level as string | undefined;
  const requiresSap = level === "L2" || level === "L3" || level === "L4";
  if (requiresSap && analysis.sap === undefined) {
    return `RWS analysis.sap is required for level ${level} (§3.1/§3.2 SAP 必须声明)`;
  }
  // Multiplicity α-adjustment: required when the task involves multiple
  // comparisons. Heuristic — flag the cases where multiplicity is clearly
  // present: multi-arm TTE (stratifyBy > 1 entry), or multi-subgroup scans.
  // Conservative for L1.5: a single drug+outcome pinning keeps it exempt;
  // absence of either is treated as a scan.
  const tte = analysis.tte as
    | {
        matchingCovariates?: unknown[];
        exposureArm?: unknown;
        comparatorArm?: unknown;
      }
    | undefined;
  const multiSubgroup =
    Array.isArray(tte?.matchingCovariates) &&
    tte!.matchingCovariates!.length > 1;
  const l15ScanWithoutPin =
    level === "L1.5" &&
    (!analysis.drug ||
      !(
        analysis.outcome ??
        (analysis.tte as { outcome?: { event?: unknown } } | undefined)?.outcome
          ?.event
      ));
  if (
    (multiSubgroup || l15ScanWithoutPin) &&
    (analysis.sap as { multiplicityAlphaAdjustment?: unknown } | undefined)
      ?.multiplicityAlphaAdjustment === undefined
  ) {
    return "RWS SAP.multiplicityAlphaAdjustment is required when the task involves multiple comparisons (§3.1 多重性 α 校正)";
  }

  return null;
}

/**
 * rws-study-protocol-spec §1.6 / §4.1: admission-time warnings (non-blocking).
 * Surfaced on the task record so the report/UI can label "要素不完备" /
 * "独立性未校验". Returned alongside (not inside) validateRwsAnalysisLadder:
 * the validator is fail-closed for shape errors; warnings are advisory.
 *
 * Phase 2 — designType + SAP rejections moved into the validator; warnings
 * only fire for the elements that remain optional (missingness, sensitivity).
 */
export function computeProtocolWarnings(analysis: {
  designType?: unknown;
  rationale?: unknown;
  sap?: unknown;
  level?: unknown;
  drug?: unknown;
  outcome?: unknown;
  missingness?: unknown;
  sensitivityAnalyses?: unknown;
  outcomeAlgorithm?: unknown;
  exposureAlgorithm?: unknown;
  comparatorAlgorithm?: unknown;
  tte?: unknown;
  type?: unknown;
}): string[] {
  const out: string[] = [];
  // designType/SAP absence is now a hard rejection (Phase 2); only surface
  // warnings for fields that remain optional.
  if (analysis.missingness === undefined) {
    out.push("要素不完备：未声明缺失值处理(§3.4)");
  }
  // §2.7.4 outcome-exposure independence: warn when the structured path
  // COULD have been used but wasn't (i.e. outcome is free text).
  const tte = analysis.tte as { outcome?: { event?: unknown } } | undefined;
  const outcomeIsFreeText =
    analysis.outcomeAlgorithm === undefined &&
    (tte?.outcome?.event !== undefined ||
      analysis.type === "comparative-effect" ||
      analysis.type === "causal-psm" ||
      analysis.type === "causal-survival");
  if (outcomeIsFreeText) {
    out.push("结局-暴露独立性未校验(§2.7.4 自由文本路径，仅警告不阻断)");
  }
  return out;
}
