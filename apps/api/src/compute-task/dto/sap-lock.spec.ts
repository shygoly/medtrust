/**
 * L2-sap-lock — SAP 冻结与模型签名一致性 (Phase 3).
 *
 * TDD RED phase: these tests encode the L2-sap-lock task card acceptance and
 * currently FAIL because the module does not yet expose
 * `computeSapModelSignature`.
 *
 * Acceptance:
 *   1) SAP 纳入版本控制并带日期戳（sapVersion + frozenAt/dateStamp）。
 *   2) SAP 定义的模型签名与主分析运行日志中的实际模型签名一致 —— the SAP's model
 *      definition (method + covariates + model form) must collapse to a
 *      deterministic, content-addressed signature that the run log can be
 *      checked against.
 *
 * The helper is probed lazily via `require` so a missing export surfaces as an
 * assertion-level failure today instead of a module-import error, keeping the
 * rest of this file compilable.
 */

function loadModule(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("./rws-analysis-spec") as Record<string, unknown>;
}

function computeSapModelSignature(sap: Record<string, unknown>): string {
  const fn = loadModule().computeSapModelSignature as
    ((s: Record<string, unknown>) => string) | undefined;
  if (typeof fn !== "function") {
    throw new Error(
      "computeSapModelSignature is not implemented yet (L2-sap-lock)",
    );
  }
  return fn(sap);
}

describe("L2-sap-lock — SAP model signature (Phase 3)", () => {
  it("exposes computeSapModelSignature in the SAP module", () => {
    // Acceptance 2 primitive: the SAP must be able to derive its own model
    // signature from the frozen model definition.
    expect(typeof loadModule().computeSapModelSignature).toBe("function");
  });

  it("derives a deterministic signature and is sensitive to the covariate list", () => {
    const sap = {
      method: "cox",
      covariates: ["age", "sex"],
      outcome: "renal_failure",
      exposureArm: "drug:A",
      comparatorArm: "drug:B",
    };
    const sigA1 = computeSapModelSignature(sap);
    const sigA2 = computeSapModelSignature({ ...sap });
    expect(sigA1).toBe(sigA2);
    // Dropping a covariate MUST change the model signature — otherwise the
    // SAP's frozen covariate list could never be verified against the log.
    const sigB = computeSapModelSignature({ ...sap, covariates: ["age"] });
    expect(sigA1).not.toBe(sigB);
  });
});
