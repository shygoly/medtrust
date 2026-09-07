import {
  buildMockFlPartyRunResult,
  buildMockFlRunResult,
  filterFlRunResultByPolicy,
  fedAvgWeightBundle,
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

describe("fedAvgWeightBundle", () => {
  it("sample-weights theta and intercept", () => {
    const a = buildMockFlPartyRunResult("t-w", "p-huashan", 100, 1);
    a.modelParams = {
      featureSchemaVersion: "pancreatitis-risk-v1",
      featureNames: ["exposed_insulin"],
      theta: [1],
      intercept: -1,
      trainedOnSynthetic: true,
    };
    const b = buildMockFlPartyRunResult("t-w", "p-ruijin", 300, 1);
    b.modelParams = {
      featureSchemaVersion: "pancreatitis-risk-v1",
      featureNames: ["exposed_insulin"],
      theta: [3],
      intercept: 1,
      trainedOnSynthetic: true,
    };
    const bundle = fedAvgWeightBundle([a, b], "t-w", "FL:x");
    expect(bundle).toBeDefined();
    expect(bundle!.theta[0]).toBeCloseTo((100 * 1 + 300 * 3) / 400, 5);
    expect(bundle!.intercept).toBeCloseTo((-1 * 100 + 1 * 300) / 400, 5);
    expect(bundle!.trainedOnSynthetic).toBe(true);
    expect(bundle!.sampleCount).toBe(400);
  });

  it("filterFlRunResultByPolicy strips weightBundle without model_weights", () => {
    const spec = {
      purpose: "x",
      federationMode: "horizontal" as const,
      modality: "structured_ehr" as const,
      parties: [],
      modelType: "logistic_regression" as const,
      objective: "binary" as const,
      targetColumn: "pancreatitis_event",
      featureColumns: [{ name: "exposed_insulin", dtype: "boolean" as const }],
      aggregation: "fedavg" as const,
      rounds: 1,
      outputPolicy: {
        allowedArtifacts: ["auc", "model_hash", "aggregate_metrics"] as const,
      },
    };
    const party = buildMockFlPartyRunResult("t2", "p-huashan", 50, 1);
    party.modelParams = {
      featureSchemaVersion: "v",
      featureNames: ["exposed_insulin"],
      theta: [1],
      intercept: 0,
      trainedOnSynthetic: true,
    };
    // Force merge with model_weights then filter without it
    const withWeights = {
      ...buildMockFlRunResult("t2", {
        ...spec,
        parties: [
          {
            participantId: "p-huashan",
            role: "provider" as const,
            dataProductId: "dp",
          },
        ],
        outputPolicy: {
          allowedArtifacts: [
            "auc",
            "model_hash",
            "aggregate_metrics",
            "model_weights",
          ],
        },
      } as any),
    };
    // Manually attach bundle
    withWeights.weightBundle = fedAvgWeightBundle(
      [party],
      "t2",
      withWeights.modelHash,
    );
    const filtered = filterFlRunResultByPolicy(withWeights, [
      "auc",
      "model_hash",
      "aggregate_metrics",
    ]);
    expect(filtered.weightBundle).toBeUndefined();
  });
});
