import { validateTteSpec, type TteSpec } from "./rws-analysis-spec";

describe("validateTteSpec", () => {
  const valid: TteSpec = {
    exposureArm: "drug:A",
    comparatorArm: "drug:B",
    timeZeroRule: "index_date",
    inclusion: ["age>=18", "ckd_stage>=2"],
    exclusion: ["pregnancy"],
    outcome: {
      type: "time_to_event",
      event: "renal_failure",
      censoring: "administrative",
    },
  };

  it("accepts a complete TTE block", () => {
    expect(validateTteSpec(valid)).toBeNull();
  });

  it("rejects missing time zero", () => {
    expect(validateTteSpec({ ...valid, timeZeroRule: "" })).toMatch(/timeZero/);
  });

  it("rejects missing outcome event", () => {
    expect(
      validateTteSpec({
        ...valid,
        outcome: { type: "binary", event: "" },
      }),
    ).toMatch(/outcome/);
  });

  it("rejects non-array inclusion", () => {
    expect(
      validateTteSpec({ ...valid, inclusion: "bad" as unknown as string[] }),
    ).toMatch(/inclusion/);
  });
});
