import test from "node:test";
import assert from "node:assert/strict";
import {
  rwsAnalysisSchema,
  rwsReviseFormSchema,
  RWS_DESIGN_TYPES,
  FROZEN_FIELDS,
} from "./rws-protocol-schema";

// rws-study-protocol-spec §6 — zod schema mirrors the backend validator.
// These tests lock in the client-side validation contract so the form gives
// instant UX feedback matching the backend's fail-closed rejections.

const validL2 = {
  type: "comparative-effect",
  level: "L2",
  drug: "drug:A",
  outcome: "MI",
  designType: "cohort",
  rationale: "New-user cohort for acute-onset AE.",
  sap: {
    significanceLevel: 0.05,
    power: 0.8,
    sampleSizeAssumption: 1200,
    sampleSizeJustification: "powered for HR=0.7",
  },
};

test("accepts a complete L2 protocol with designType + SAP", () => {
  const r = rwsAnalysisSchema.safeParse(validL2);
  assert.ok(r.success, `Expected success, got: ${JSON.stringify(r.error?.issues ?? [])}`);
});

test("rejects missing designType (Phase 2 required)", () => {
  const { designType: _drop, ...rest } = validL2;
  void _drop;
  const r = rwsAnalysisSchema.safeParse(rest);
  assert.ok(!r.success);
  assert.ok(
    r.error!.issues.some((i) => i.path.includes("designType")),
    "Should flag designType",
  );
});

test("rejects designType without rationale (paired check)", () => {
  const { rationale: _drop, ...rest } = validL2;
  void _drop;
  const r = rwsAnalysisSchema.safeParse(rest);
  assert.ok(!r.success);
  assert.ok(
    r.error!.issues.some((i) => i.path.includes("rationale")),
    "Should flag rationale",
  );
});

test("rejects L2 without SAP", () => {
  const { sap: _drop, ...rest } = validL2;
  void _drop;
  const r = rwsAnalysisSchema.safeParse(rest);
  assert.ok(!r.success);
  assert.ok(
    r.error!.issues.some((i) => i.path.includes("sap")),
    "Should flag sap",
  );
});

test("L0 algorithm-validation is EXEMPT from designType", () => {
  const r = rwsAnalysisSchema.safeParse({
    type: "algorithm-validation",
    algorithm: { id: "a", version: "1", expression: {} },
    variableDefinitionId: "dm2",
  });
  assert.ok(r.success, `L0 should be exempt: ${JSON.stringify(r.error?.issues ?? [])}`);
});

test("L1.5 single-combo is EXEMPT from SAP", () => {
  const r = rwsAnalysisSchema.safeParse({
    type: "disproportionality",
    level: "L1.5",
    drug: "drug:A",
    outcome: "MI",
    designType: "nested-case-control",
    rationale: "signal scanning",
  });
  assert.ok(r.success);
});

test("L1.5 multi-combo scan requires multiplicity α-adjustment", () => {
  const r = rwsAnalysisSchema.safeParse({
    type: "disproportionality",
    level: "L1.5",
    designType: "nested-case-control",
    rationale: "multi-signal scan",
    sap: { significanceLevel: 0.05 }, // no multiplicityAlphaAdjustment
  });
  assert.ok(!r.success);
  assert.ok(
    r.error!.issues.some((i) => i.path.includes("multiplicityAlphaAdjustment")),
    "Should flag multiplicity",
  );
});

test("rejects missingness with only mechanism (paired check)", () => {
  const r = rwsAnalysisSchema.safeParse({
    ...validL2,
    missingness: { mechanism: "MAR" }, // missing imputationStrategy
  });
  assert.ok(!r.success);
});

test("rejects sensitivityAnalyses while executor is unwired (EVD-10)", () => {
  const r = rwsAnalysisSchema.safeParse({
    ...validL2,
    sensitivityAnalyses: [
      { id: "on-treatment", description: "On-treatment analysis" },
      { id: "per-protocol", description: "Per-protocol analysis" },
    ],
  });
  assert.ok(!r.success);
  assert.ok(
    r.error!.issues.some((i) =>
      String(i.message).includes("敏感性分析执行器尚未接线"),
    ),
    "Should reject undeclared SA executor",
  );
});

test("rejects L2 comparative-effect without outcome", () => {
  const { outcome: _drop, ...rest } = validL2;
  void _drop;
  const r = rwsAnalysisSchema.safeParse(rest);
  assert.ok(!r.success);
  assert.ok(
    r.error!.issues.some((i) => i.path.includes("outcome")),
    "Should flag outcome",
  );
});

test("rejects L3 causal without tte", () => {
  const r = rwsAnalysisSchema.safeParse({
    type: "causal-survival",
    level: "L3",
    designType: "cohort",
    rationale: "new-user TTE",
    sap: validL2.sap,
  });
  assert.ok(!r.success);
  assert.ok(
    r.error!.issues.some((i) => i.path.includes("tte")),
    "Should flag tte",
  );
});

test("rejects outcome-exposure code-set intersection (fail-closed)", () => {
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
  const r = rwsAnalysisSchema.safeParse({
    ...validL2,
    outcomeAlgorithm: algo(["I21", "E11.9"]),
    exposureAlgorithm: algo(["E11.9"]), // intersection
  });
  assert.ok(!r.success);
  assert.ok(
    r.error!.issues.some((i) => i.message.includes("编码交集")),
    "Should flag intersection",
  );
});

test("revise form requires revisionReason", () => {
  const r = rwsReviseFormSchema.safeParse({
    analysis: validL2,
    revisionReason: "",
  });
  assert.ok(!r.success);
  assert.ok(
    r.error!.issues.some((i) => i.path.includes("revisionReason")),
    "Should flag revisionReason",
  );
});

test("revise form accepts valid protocol + reason", () => {
  const r = rwsReviseFormSchema.safeParse({
    analysis: validL2,
    revisionReason: "chart review suggested refining inclusion",
  });
  assert.ok(r.success);
});

test("RWS_DESIGN_TYPES has exactly 6 values", () => {
  assert.equal(RWS_DESIGN_TYPES.length, 6);
});

test("FROZEN_FIELDS includes the Phase 3 freeze set", () => {
  for (const f of ["designType", "rationale", "tte", "matchingCovariates", "sap", "missingness", "sensitivityAnalyses"]) {
    assert.ok((FROZEN_FIELDS as readonly string[]).includes(f), `FROZEN_FIELDS should include ${f}`);
  }
});
