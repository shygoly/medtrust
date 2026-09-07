import {
  flResultHint,
  flWorkloadLabel,
  latestProgress,
  rwsResultHint,
  rwsWorkloadLabel,
} from "./provider-inbox";

describe("provider-inbox helpers", () => {
  it("labels L0 analysis", () => {
    expect(rwsWorkloadLabel({ type: "algorithm-validation" })).toBe(
      "L0 算法核验",
    );
  });

  it("summarizes L0 metrics without exposing full aggregate", () => {
    expect(
      rwsResultHint({
        validationResult: {
          metrics: {
            sensitivity: { point: 0.896 },
            specificity: { point: 0.981 },
          },
        },
      }),
    ).toBe("Se 89.6% · Sp 98.1%");
  });

  it("labels FL model type", () => {
    expect(flWorkloadLabel({ modelType: "xgboost" })).toBe("L4 · xgboost");
  });

  it("summarizes FL party result", () => {
    expect(
      flResultHint({
        sampleCount: 5000,
        localMetrics: { auc: 0.812 },
      }),
    ).toBe("n=5000 · AUC 0.812");
  });

  it("reads latest progress event", () => {
    expect(
      latestProgress([
        { at: "t1", stage: "pep-check" },
        { at: "t2", stage: "tee-exec", detail: "L0" },
      ]),
    ).toEqual({ at: "t2", stage: "tee-exec", detail: "L0" });
  });
});
