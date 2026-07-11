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
});
