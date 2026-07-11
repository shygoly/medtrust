import {
  ckdEsrdRiskFlPredictionSpec,
  hasRequiredFlFeatures,
  hasRequiredFlParties,
  isFlPredictionTaskSpec,
  validateFlPrivacyPolicy,
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

  describe("validateFlPrivacyPolicy", () => {
    it("passes the CKD preset (ε=1.0)", () => {
      expect(validateFlPrivacyPolicy(ckdEsrdRiskFlPredictionSpec())).toBeNull();
    });

    it("rejects ε above the medical ceiling", () => {
      const spec = ckdEsrdRiskFlPredictionSpec();
      spec.privacy = { ...spec.privacy, dpEpsilon: 4.0 };
      expect(validateFlPrivacyPolicy(spec)).toMatch(/超出医疗数据隐私预算上限/);
    });

    it("rejects non-positive ε", () => {
      const spec = ckdEsrdRiskFlPredictionSpec();
      spec.privacy = { ...spec.privacy, dpEpsilon: 0 };
      expect(validateFlPrivacyPolicy(spec)).toMatch(/必须为正数/);
    });

    it("does not enforce when ε is undeclared (DP optional)", () => {
      const spec = ckdEsrdRiskFlPredictionSpec();
      spec.privacy = { minCohortSize: 5 };
      expect(validateFlPrivacyPolicy(spec)).toBeNull();
    });
  });
});
