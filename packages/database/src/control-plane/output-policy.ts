/**
 * Contract egress policy — coarse preset + structured gate knobs (D5 / INV-PEP-01).
 * Red lines (no row-level) are never configurable; minCell + artifact allow-list are.
 */

export type OutputPreset =
  | "aggregate_only"
  | "model_only"
  | "aggregate_and_model";

/** Coarse egress product classes shown in contracts / compliance UI. */
export type OutputArtifactClass =
  | "aggregate_stats"
  | "validation_metrics"
  | "model_params"
  | "model_update";

export type OutputDpPolicy =
  | { mode: "none" }
  | { mode: "epsilon"; epsilon: number; budgetScope: "per_task" };

export interface OutputPolicy {
  preset: OutputPreset;
  allowedArtifacts: OutputArtifactClass[];
  /** Small-cell suppression threshold; hard floor 5. */
  minCell: number;
  dp: OutputDpPolicy;
}

export const OUTPUT_PRESET_LABEL: Record<OutputPreset, string> = {
  aggregate_only: "仅聚合统计",
  model_only: "仅模型增量",
  aggregate_and_model: "聚合 + 模型参数",
};

const PRESET_ARTIFACTS: Record<OutputPreset, OutputArtifactClass[]> = {
  aggregate_only: ["aggregate_stats", "validation_metrics"],
  model_only: ["model_params", "model_update"],
  aggregate_and_model: [
    "aggregate_stats",
    "validation_metrics",
    "model_params",
    "model_update",
  ],
};

/** Map legacy free-text `output` → preset. */
export function presetFromOutputLabel(output: string): OutputPreset {
  const s = output.trim();
  if (s === "仅模型增量" || s.includes("模型增量") || s === "仅模型参数") {
    return "model_only";
  }
  if (
    s === "聚合 + 模型参数" ||
    s.includes("聚合") && s.includes("模型")
  ) {
    return "aggregate_and_model";
  }
  // "仅聚合" / "仅聚合统计" / unknown → safest aggregate-only
  return "aggregate_only";
}

export function outputLabelFromPreset(preset: OutputPreset): string {
  return OUTPUT_PRESET_LABEL[preset];
}

export const MIN_CELL_FLOOR = 5;
export const MIN_CELL_CEILING = 20;
export const DEFAULT_MIN_CELL = 5;

export function clampMinCell(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : DEFAULT_MIN_CELL;
  return Math.min(MIN_CELL_CEILING, Math.max(MIN_CELL_FLOOR, v));
}

/** Build a full policy from preset (+ optional minCell override). */
export function buildOutputPolicy(
  preset: OutputPreset,
  opts?: { minCell?: number; dp?: OutputDpPolicy },
): OutputPolicy {
  return {
    preset,
    allowedArtifacts: [...PRESET_ARTIFACTS[preset]],
    minCell: clampMinCell(opts?.minCell ?? DEFAULT_MIN_CELL),
    dp: opts?.dp ?? { mode: "none" },
  };
}

/** Resolve policy from contract fields; backfill from legacy `output` string. */
export function resolveOutputPolicy(input: {
  output?: string;
  outputPolicy?: Partial<OutputPolicy> | null;
}): OutputPolicy {
  const partial = input.outputPolicy;
  if (partial?.preset && PRESET_ARTIFACTS[partial.preset]) {
    return buildOutputPolicy(partial.preset, {
      minCell: partial.minCell,
      dp: partial.dp?.mode === "epsilon" ? partial.dp : { mode: "none" },
    });
  }
  const preset = presetFromOutputLabel(input.output ?? "仅聚合统计");
  return buildOutputPolicy(preset, { minCell: partial?.minCell });
}

/**
 * Expand coarse artifact classes → connector PEP `RwsArtifactKind` strings.
 * Kept as string[] so @medtrust/database does not depend on connector types.
 */
export function expandToPepArtifacts(policy: OutputPolicy): string[] {
  const out = new Set<string>();
  for (const c of policy.allowedArtifacts) {
    switch (c) {
      case "aggregate_stats":
        for (const a of [
          "cohort_count",
          "condition_prevalence",
          "adverse_event_signal",
          "disproportionality",
          "effect_estimate",
          "hazard_ratio",
          "km_curve",
          "meta_pooled",
          "aggregate_metrics",
        ]) {
          out.add(a);
        }
        break;
      case "validation_metrics":
        out.add("validation_metrics");
        break;
      case "model_params":
        out.add("model_hash");
        out.add("aggregate_metrics");
        break;
      case "model_update":
        out.add("model_hash");
        break;
    }
  }
  return [...out];
}

/** Analysis levels implied by preset (for optional PEP level checks). */
export function levelsForPreset(preset: OutputPreset): string[] {
  switch (preset) {
    case "aggregate_only":
      return ["L0", "L1", "L1.5", "L2", "L3"];
    case "model_only":
      return ["L4"];
    case "aggregate_and_model":
      return ["L0", "L1", "L1.5", "L2", "L3", "L4"];
  }
}
