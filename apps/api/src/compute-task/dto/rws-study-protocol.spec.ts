import {
  validateRwsAnalysisLadder,
  validateSapLock,
  computeProtocolWarnings,
} from "./rws-analysis-spec";

// rws-study-protocol-spec Phase 2 validator tests.
// Phase 2 contract: designType + rationale required globally (L0 exempt);
// SAP required for L2/L3/L4; multiplicity α required for multi-comparison
// tasks. Shape validators from Phase 1 remain (closed sets, paired checks).
describe("rws-study-protocol-spec — protocol validators (Phase 2)", () => {
  // A complete L2 base fixture that passes every Phase-2 check. Individual
  // tests spread from here by deleting fields.
  const base = {
    type: "comparative-effect",
    level: "L2",
    drug: "drug:A",
    outcome: "MI",
    designType: "cohort" as const,
    rationale: "New-user cohort design fits the acute-onset question.",
    sap: {
      significanceLevel: 0.05,
      power: 0.8,
      sampleSizeAssumption: 1200,
      sampleSizeJustification: "powered for HR=0.7",
    },
  };

  describe("designType + rationale (§2.5)", () => {
    it("accepts a valid designType with rationale", () => {
      expect(validateRwsAnalysisLadder({ ...base })).toBeNull();
    });
    it("rejects missing designType (Phase 2 required)", () => {
      const { designType: _drop, ...rest } = base;
      void _drop;
      expect(validateRwsAnalysisLadder(rest)).toMatch(/designType is required/);
    });
    it("rejects an unknown designType value", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          designType: "factorial" as never,
        }),
      ).toMatch(/designType must be one of/);
    });
    it("rejects designType without rationale (paired check)", () => {
      const { rationale: _drop, ...rest } = base;
      void _drop;
      expect(validateRwsAnalysisLadder(rest)).toMatch(
        /rationale is required when designType/,
      );
    });
    it("rejects empty-string rationale even when designType present", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          rationale: "   ",
        }),
      ).toMatch(/rationale is required/);
    });
    it("L0 (algorithm-validation) is EXEMPT from designType", () => {
      // L0 is a validation procedure, not an epidemiological study — forcing
      // designType on it would be meaningless.
      expect(
        validateRwsAnalysisLadder({
          type: "algorithm-validation",
          algorithm: { id: "a", version: "1", expression: {} },
          variableDefinitionId: "dm2",
        }),
      ).toBeNull();
    });
  });

  describe("SAP required by level (§3.1/§3.2 D4)", () => {
    it("rejects L2 without SAP", () => {
      const { sap: _drop, ...rest } = base;
      void _drop;
      expect(validateRwsAnalysisLadder(rest)).toMatch(
        /sap is required for level L2/,
      );
    });
    it("rejects L3 without SAP", () => {
      const { sap: _drop, ...rest } = base;
      void _drop;
      expect(
        validateRwsAnalysisLadder({
          ...rest,
          level: "L3",
          type: "causal-survival",
          tte: {
            exposureArm: "drug:A",
            comparatorArm: "drug:B",
            timeZeroRule: "index_date",
            inclusion: [],
            exclusion: [],
            outcome: { type: "time_to_event", event: "esrd" },
          },
        }),
      ).toMatch(/sap is required for level L3/);
    });
    it("rejects L3 causal without tte", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          level: "L3",
          type: "causal-survival",
        }),
      ).toMatch(/tte is required/);
    });
    it("rejects L2 comparative-effect without outcome", () => {
      const { outcome: _drop, ...rest } = base;
      void _drop;
      expect(
        validateRwsAnalysisLadder({
          ...rest,
          level: "L2",
          type: "comparative-effect",
          drug: "目标药",
        }),
      ).toMatch(/outcome is required/);
    });
    it("rejects L4 without SAP", () => {
      expect(
        validateRwsAnalysisLadder({
          type: "cohort-count",
          level: "L4",
          designType: "cohort",
          rationale: "predictive modeling",
        }),
      ).toMatch(/sap is required for level L4/);
    });
    it("L1.5 single-combo is EXEMPT from SAP", () => {
      // Single drug + single outcome pinning → exempt per D4.
      expect(
        validateRwsAnalysisLadder({
          type: "disproportionality",
          level: "L1.5",
          drug: "drug:A",
          outcome: "MI",
          designType: "nested-case-control",
          rationale: "signal scanning",
        }),
      ).toBeNull();
    });
    it("L1.5 multi-combo scan requires multiplicity α-adjustment", () => {
      // No drug/outcome pinning → treated as a scan → multiplicity required.
      expect(
        validateRwsAnalysisLadder({
          type: "disproportionality",
          level: "L1.5",
          designType: "nested-case-control",
          rationale: "multi-signal scan",
          sap: { significanceLevel: 0.05 }, // no multiplicity adjustment
        }),
      ).toMatch(/multiplicityAlphaAdjustment is required/);
    });
    it("multi-subgroup TTE requires multiplicity α-adjustment", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          tte: {
            exposureArm: "drug:A",
            comparatorArm: "drug:B",
            timeZeroRule: "index",
            inclusion: [],
            exclusion: [],
            outcome: { type: "binary", event: "MI" },
            matchingCovariates: ["age", "sex", "stage"], // >1 → multi-subgroup
          },
        }),
      ).toMatch(/multiplicityAlphaAdjustment is required/);
    });
    it("multi-subgroup with declared multiplicity adjustment passes", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          sap: { ...base.sap, multiplicityAlphaAdjustment: "Benferroni α/3" },
          tte: {
            exposureArm: "drug:A",
            comparatorArm: "drug:B",
            timeZeroRule: "index",
            inclusion: [],
            exclusion: [],
            outcome: { type: "binary", event: "MI" },
            matchingCovariates: ["age", "sex"],
          },
        }),
      ).toBeNull();
    });
  });

  describe("SAP shape validation (Phase 1, still applies)", () => {
    it("rejects significanceLevel outside (0, 1)", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          sap: { significanceLevel: 0 },
        }),
      ).toMatch(/significanceLevel must be a number in \(0, 1\)/);
    });
    it("rejects power outside (0, 1)", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          sap: { ...base.sap, power: 1.2 },
        }),
      ).toMatch(/power must be a number/);
    });
    it("rejects non-positive sampleSizeAssumption", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          sap: { ...base.sap, sampleSizeAssumption: -100 },
        }),
      ).toMatch(/sampleSizeAssumption must be a positive finite number/);
    });
  });

  describe("L2-sap-lock — SAP 版本控制 / 日期戳 / 模型签名 (Phase 3)", () => {
    // L2-sap-lock acceptance:
    //   1) SAP 纳入版本控制并带日期戳 —— the SAP must carry a version-control
    //      identity (sapVersion) and a freeze date stamp (frozenAt / dateStamp)
    //      BEFORE any result lock can happen.
    //   2) SAP 定义的模型签名与主分析运行日志中的实际模型签名一致 —— the SAP must
    //      declare a frozen model signature (method + covariates + model form)
    //      that the run log can be compared against.
    // The freeze gate lives in `validateSapLock` — the orchestrator enforces it
    // at result-lock time (`completeAssignment`), NOT in admission-time
    // `validateRwsAnalysisLadder`, which deliberately keeps pre-freeze SAPs
    // admissible (progressive freeze). These tests drive the freeze-gate helper.
    it("rejects L2 SAP that lacks version-control identity and a date stamp", () => {
      const r = validateSapLock({ significanceLevel: 0.05, power: 0.8 });
      expect(r).not.toBeNull();
      expect(r).toMatch(/sapVersion|frozenAt|dateStamp/);
    });
    it("rejects L2 SAP that lacks a frozen model signature", () => {
      const r = validateSapLock({
        significanceLevel: 0.05,
        power: 0.8,
        sapVersion: "v1",
        frozenAt: "2026-08-01T00:00:00.000Z",
      });
      expect(r).not.toBeNull();
      expect(r).toMatch(/modelSignature|model signature/);
    });
  });

  describe("missingness paired declaration (§3.4)", () => {
    it("accepts absent missingness (not required by level)", () => {
      expect(validateRwsAnalysisLadder({ ...base })).toBeNull();
    });
    it("accepts both mechanism + strategy declared together", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          missingness: {
            mechanism: "MAR",
            imputationStrategy: "multiple imputation",
          },
        }),
      ).toBeNull();
    });
    it("rejects mechanism without strategy", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          missingness: { mechanism: "MAR", imputationStrategy: "" },
        }),
      ).toMatch(/imputationStrategy is required/);
    });
    it("rejects unknown mechanism value", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          missingness: { mechanism: "NMAR-X", imputationStrategy: "x" },
        }),
      ).toMatch(/mechanism must be one of/);
    });
  });

  describe("sensitivityAnalyses shape (§3.5)", () => {
    it("accepts absent sensitivity analyses", () => {
      expect(validateRwsAnalysisLadder({ ...base })).toBeNull();
    });
    it("rejects declared sensitivity analyses until connector executor is wired", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          sensitivityAnalyses: [
            { id: "on-treatment", description: "On-treatment analysis" },
            { id: "younger-only", description: "Restrict to <65" },
          ],
        }),
      ).toMatch(/敏感性分析执行器尚未接线/);
    });
    it("rejects duplicate ids", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          sensitivityAnalyses: [
            { id: "x", description: "a" },
            { id: "x", description: "b" },
          ],
        }),
      ).toMatch(/duplicates an earlier entry/);
    });
  });

  describe("outcome-exposure independence (§2.7.4)", () => {
    const algo = (codes: string[]) => ({
      id: `algo-${codes.join("-")}`,
      version: "1.0.0",
      expression: {
        kind: "codeset",
        codeset: {
          codeSystem: "ICD-10",
          codeSystemVersion: "2023",
          codes,
          valueSource: "discharge_dx",
          diagnosisOrder: "any",
        },
      },
    });

    it("structured refs with disjoint codes — passes", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          outcomeAlgorithm: algo(["I21"]),
          exposureAlgorithm: algo(["E11.9"]),
        }),
      ).toBeNull();
    });

    it("structured refs with intersecting codes — rejected (fail-closed)", () => {
      const r = validateRwsAnalysisLadder({
        ...base,
        outcomeAlgorithm: algo(["I21", "E11.9"]),
        exposureAlgorithm: algo(["E11.9"]),
      });
      expect(r).toMatch(/编码交集/);
      expect(r).toMatch(/E11\.9/);
    });

    it("comparator intersection also triggers rejection", () => {
      expect(
        validateRwsAnalysisLadder({
          ...base,
          outcomeAlgorithm: algo(["I21"]),
          comparatorAlgorithm: algo(["I21"]),
        }),
      ).toMatch(/编码交集/);
    });
  });
});

describe("rws-study-protocol-spec — computeProtocolWarnings (§1.6 / §4.1)", () => {
  it("no longer warns about missing designType/SAP (Phase 2 hard-rejects them)", () => {
    // computeProtocolWarnings is now only for the OPTIONAL fields. Hard
    // rejections happen in the validator.
    const w = computeProtocolWarnings({
      type: "comparative-effect",
      level: "L2",
      designType: "cohort",
      rationale: "x",
      sap: { significanceLevel: 0.05 },
    });
    expect(w).not.toContain(expect.stringContaining("designType"));
    expect(w).not.toContain(expect.stringContaining("SAP"));
  });

  it("warns about missing optional missingness", () => {
    const w = computeProtocolWarnings({
      type: "comparative-effect",
      level: "L2",
      designType: "cohort",
      rationale: "x",
      sap: { significanceLevel: 0.05 },
    });
    expect(w).toContain("要素不完备：未声明缺失值处理(§3.4)");
  });

  it("emits the independence warning for free-text outcome (§4.1)", () => {
    const w = computeProtocolWarnings({
      type: "comparative-effect",
      tte: {
        exposureArm: "drug:A",
        comparatorArm: "drug:B",
        timeZeroRule: "x",
        inclusion: [],
        exclusion: [],
        outcome: { type: "binary", event: "MI" },
      },
    });
    expect(w).toContain(
      "结局-暴露独立性未校验(§2.7.4 自由文本路径，仅警告不阻断)",
    );
  });

  it("does NOT emit the independence warning when outcome is structured", () => {
    const w = computeProtocolWarnings({
      type: "comparative-effect",
      outcomeAlgorithm: { id: "a", version: "1", expression: {} },
    });
    expect(w.some((x) => x.includes("独立性未校验"))).toBe(false);
  });

  it("returns no warnings when all optional fields are declared", () => {
    const w = computeProtocolWarnings({
      type: "comparative-effect",
      designType: "cohort",
      rationale: "new-user",
      sap: { significanceLevel: 0.05 },
      missingness: { mechanism: "MAR", imputationStrategy: "MI" },
      outcomeAlgorithm: { id: "a", version: "1", expression: {} },
    });
    expect(w).toEqual([]);
  });
});
