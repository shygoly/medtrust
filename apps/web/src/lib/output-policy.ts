/** Client-side mirrors of control-plane OutputPolicy (for forms / preview). */

export type OutputPreset =
  | "aggregate_only"
  | "model_only"
  | "aggregate_and_model";

export type OutputArtifactClass =
  | "aggregate_stats"
  | "validation_metrics"
  | "model_params"
  | "model_update";

export interface OutputPolicyView {
  preset: OutputPreset;
  allowedArtifacts: OutputArtifactClass[];
  minCell: number;
  dp: { mode: "none" } | { mode: "epsilon"; epsilon: number; budgetScope: "per_task" };
}

export const OUTPUT_PRESET_OPTIONS: { value: OutputPreset; label: string }[] = [
  { value: "aggregate_only", label: "仅聚合统计" },
  { value: "model_only", label: "仅模型增量" },
  { value: "aggregate_and_model", label: "聚合 + 模型参数" },
];

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

export const ARTIFACT_CLASS_LABEL: Record<OutputArtifactClass, string> = {
  aggregate_stats: "聚合统计",
  validation_metrics: "校验指标",
  model_params: "模型参数",
  model_update: "模型增量",
};

export function labelFromPreset(preset: OutputPreset): string {
  return OUTPUT_PRESET_OPTIONS.find((o) => o.value === preset)?.label ?? preset;
}

export function presetFromLabel(output: string): OutputPreset {
  const s = output.trim();
  if (s.includes("模型增量") || s === "仅模型参数") return "model_only";
  if (s.includes("聚合") && s.includes("模型")) return "aggregate_and_model";
  return "aggregate_only";
}

export function buildOutputPolicyView(
  preset: OutputPreset,
  minCell = 5,
): OutputPolicyView {
  return {
    preset,
    allowedArtifacts: [...PRESET_ARTIFACTS[preset]],
    minCell: Math.min(20, Math.max(5, Math.floor(minCell))),
    dp: { mode: "none" },
  };
}

export function resolveOutputPolicyView(contract: {
  output?: string;
  outputPolicy?: Partial<OutputPolicyView> | null;
}): OutputPolicyView {
  if (contract.outputPolicy?.preset) {
    return buildOutputPolicyView(
      contract.outputPolicy.preset,
      contract.outputPolicy.minCell ?? 5,
    );
  }
  return buildOutputPolicyView(presetFromLabel(contract.output ?? "仅聚合统计"), 5);
}
