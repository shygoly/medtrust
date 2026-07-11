import {
  buildMockFlPartyRunResult,
  buildMockFlRunResult,
  filterFlRunResultByPolicy,
  isFlRunResult,
  mergeFlPartyResults,
} from "./fl-run-result";
import { projectFlRunResultToTaskSummary } from "./fl-result-projection";
import { ckdEsrdRiskFlPredictionSpec } from "./fl-prediction-task-spec";

describe("fl-run-result", () => {
  const spec = ckdEsrdRiskFlPredictionSpec();

  it("builds mock party and merged run results", () => {
    const party = buildMockFlPartyRunResult("fl-1", "p-huashan", 59, 5);
    expect(party.localMetrics.auc).toBeGreaterThan(0);

    const merged = buildMockFlRunResult("fl-1", spec);
    expect(merged.workloadType).toBe("federated_learning");
    expect(merged.partyContributions).toHaveLength(2);
    expect(isFlRunResult(merged)).toBe(true);
  });

  it("merges party metrics weighted by sample count", () => {
    const parties = [
      buildMockFlPartyRunResult("fl-2", "p-huashan", 100, 3),
      buildMockFlPartyRunResult("fl-2", "p-ruijin", 50, 3),
    ];
    const merged = mergeFlPartyResults(parties, spec);
    expect(merged.aggregateMetrics.auc).toBeDefined();
    expect(merged.featureImportance?.length).toBe(spec.featureColumns.length);
  });

  it("filters optional artifacts by output policy", () => {
    const full = buildMockFlRunResult("fl-3", spec);
    const filtered = filterFlRunResultByPolicy(full, ["auc", "model_hash"]);
    expect(filtered.featureImportance).toBeUndefined();
    expect(filtered.attestation).toBeUndefined();
    expect(filtered.aggregateMetrics.f1).toBeUndefined();
    expect(filtered.aggregateMetrics.auc).toBeDefined();
  });

  it("projects to task summary for UI", () => {
    const result = buildMockFlRunResult("fl-4", spec);
    const summary = projectFlRunResultToTaskSummary(result);
    expect(summary.workloadType).toBe("federated_learning");
    expect(summary.flRunResult).toBe(result);
    expect(summary.auc).toBe(result.aggregateMetrics.auc);
    expect(summary.partyCount).toBe(2);
  });

  it("projects per-party DP flags into contributions", () => {
    const parties = [
      buildMockFlPartyRunResult("fl-5", "p-huashan", 59, 3),
      buildMockFlPartyRunResult("fl-5", "p-ruijin", 59, 3),
    ];
    const merged = mergeFlPartyResults(parties, spec);
    expect(merged.partyContributions[0].dpApplied).toBe(true);
    expect(merged.partyContributions[0].dpEpsilon).toBe(1);
  });

  it("flags insufficient statistical power for small merged cohorts", () => {
    const parties = [
      buildMockFlPartyRunResult("fl-6", "p-huashan", 59, 3),
      buildMockFlPartyRunResult("fl-6", "p-ruijin", 59, 3),
    ];
    const merged = mergeFlPartyResults(parties, spec);
    expect(merged.warnings?.map((w) => w.code)).toContain("insufficient_power");
  });

  it("flags a model whose AUC is below random", () => {
    const lowAuc = (id: string) => ({
      taskId: "fl-7",
      participantId: id,
      roundsCompleted: 3,
      sampleCount: 300, // ≥ power threshold, isolates the AUC warning
      localModelHash: `LOCAL:${id}`,
      trainingMode: "mock" as const,
      dpApplied: true,
      dpEpsilon: 1,
      localMetrics: { auc: 0.2, f1: 0.9, precision: 0.9, recall: 0.4 },
    });
    const merged = mergeFlPartyResults([lowAuc("p-a"), lowAuc("p-b")], spec);
    expect(merged.aggregateMetrics.auc).toBeLessThan(0.5);
    const codes = merged.warnings?.map((w) => w.code);
    expect(codes).toContain("invalid_model_auc");
    expect(codes).not.toContain("insufficient_power");
  });

  it("exposes a top-level attestation object in the projection", () => {
    const result = buildMockFlRunResult("fl-8", spec);
    const summary = projectFlRunResultToTaskSummary(result);
    expect(summary.attestation).toBe(result.attestation);
  });
});
