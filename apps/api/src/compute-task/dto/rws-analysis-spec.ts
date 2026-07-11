/**
 * RWS 分析分级契约(rws-analytics-ladder,组1 + 组5 TTE).
 */
export type RwsAnalysisLevel = "L1" | "L1.5" | "L2" | "L3" | "L4";

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
  | "aggregate_metrics";

export const RWS_ANALYSIS_LEVELS: readonly RwsAnalysisLevel[] = [
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
];

export type CausalMethod = "psm" | "iptw" | "cox";

export const CAUSAL_METHODS: readonly CausalMethod[] = ["psm", "iptw", "cox"];

export type RwsAnalysisType =
  | "adverse-event-signal"
  | "cohort-count"
  | "condition-prevalence"
  | "disproportionality"
  | "comparative-effect"
  | "causal-psm"
  | "causal-survival";

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

export function validateRwsAnalysisLadder(analysis: {
  level?: unknown;
  mode?: unknown;
  method?: unknown;
  tte?: unknown;
  allowedArtifacts?: unknown;
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
  return null;
}
