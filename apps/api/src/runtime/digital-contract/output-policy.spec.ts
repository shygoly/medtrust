import {
  buildOutputPolicy,
  expandToPepArtifacts,
  levelsForPreset,
  presetFromOutputLabel,
  resolveOutputPolicy,
} from "@medtrust/database";

describe("output-policy helpers", () => {
  it("maps legacy labels to presets", () => {
    expect(presetFromOutputLabel("仅聚合统计")).toBe("aggregate_only");
    expect(presetFromOutputLabel("仅模型增量")).toBe("model_only");
    expect(presetFromOutputLabel("聚合 + 模型参数")).toBe(
      "aggregate_and_model",
    );
  });

  it("clamps minCell to [5,20]", () => {
    expect(buildOutputPolicy("aggregate_only", { minCell: 3 }).minCell).toBe(5);
    expect(buildOutputPolicy("aggregate_only", { minCell: 99 }).minCell).toBe(
      20,
    );
  });

  it("expands aggregate_only without model_hash", () => {
    const arts = expandToPepArtifacts(buildOutputPolicy("aggregate_only"));
    expect(arts).toContain("validation_metrics");
    expect(arts).toContain("cohort_count");
    expect(arts).not.toContain("model_hash");
  });

  it("levelsForPreset blocks L4 on aggregate_only", () => {
    expect(levelsForPreset("aggregate_only")).not.toContain("L4");
    expect(levelsForPreset("aggregate_and_model")).toContain("L4");
  });

  it("resolveOutputPolicy backfills from output string", () => {
    const p = resolveOutputPolicy({ output: "聚合 + 模型参数" });
    expect(p.preset).toBe("aggregate_and_model");
    expect(p.dp.mode).toBe("none");
  });
});
