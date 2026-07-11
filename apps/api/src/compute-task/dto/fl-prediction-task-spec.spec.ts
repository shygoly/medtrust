import {
  ckdEsrdRiskFlPredictionSpec,
  hasRequiredFlFeatures,
  hasRequiredFlParties,
  isFlPredictionTaskSpec,
} from "./fl-prediction-task-spec";

describe("fl-prediction-task-spec", () => {
  it("accepts CKD demo preset", () => {
    expect(isFlPredictionTaskSpec(ckdEsrdRiskFlPredictionSpec())).toBe(true);
  });

  it("requires at least two provider parties", () => {
    const spec = ckdEsrdRiskFlPredictionSpec();
    expect(hasRequiredFlParties({ ...spec, parties: [spec.parties[0]] })).toBe(
      false,
    );
  });

  it("rejects target column duplicated in features", () => {
    const spec = ckdEsrdRiskFlPredictionSpec();
    expect(
      hasRequiredFlFeatures({
        ...spec,
        targetColumn: "egfr",
        featureColumns: [{ name: "egfr", dtype: "numeric" }],
      }),
    ).toBe(false);
  });

  it("rejects non-structured_ehr modality", () => {
    const spec = {
      ...ckdEsrdRiskFlPredictionSpec(),
      modality: "clinical_text",
    };
    expect(isFlPredictionTaskSpec(spec)).toBe(false);
  });
});
