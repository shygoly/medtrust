import {
  DEID_SPEC_SIGNATURE_PAYLOAD_PREFIX,
  DeidSpecError,
  deidSpecSignaturePayload,
  parseDeidSpec,
} from "./deid";

const base = {
  version: 1,
  id: "mask.v1",
  scope: { product: "urn:tds:space:product", level: "C0_internal" },
  transforms: [
    { field: "subject_id", op: "hmac_pseudonym", params: { saltRef: "org:k1", outLen: 32 } },
    { field: "name", op: "drop" },
    { field: "birth_date", op: "generalize" },
  ],
  denyIfTransformMissing: ["subject_id", "name"],
};

describe("deid spec schema", () => {
  it("parses a closed, parameterized spec", () => {
    const spec = parseDeidSpec(base);
    expect(spec.id).toBe("mask.v1");
    expect(spec.transforms).toHaveLength(3);
  });

  it("rejects unsupported versions and unknown operators", () => {
    expect(() => parseDeidSpec({ ...base, version: 2 })).toThrow(DeidSpecError);
    expect(() => parseDeidSpec({ ...base, transforms: [{ field: "x", op: "python" }] })).toThrow(
      DeidSpecError,
    );
  });

  it("rejects missing mandatory transform and duplicate fields", () => {
    expect(() => parseDeidSpec({ ...base, denyIfTransformMissing: ["phone"] })).toThrow(
      /没有脱敏变换/,
    );
    expect(() =>
      parseDeidSpec({
        ...base,
        transforms: [...base.transforms, { field: "name", op: "drop" }],
      }),
    ).toThrow(/重复字段/);
  });

  it("rejects weak or excessive privacy parameters", () => {
    expect(() =>
      parseDeidSpec({ ...base, quasiIdentifierPolicy: { k: 4, suppressIfBelow: true, columns: ["age"] } }),
    ).toThrow(/k 必须/);
    expect(() =>
      parseDeidSpec({
        ...base,
        transforms: [
          { field: "subject_id", op: "hmac_pseudonym", params: { saltRef: "k", outLen: 65 } },
        ],
        denyIfTransformMissing: ["subject_id"],
      }),
    ).toThrow(/outLen/);
    expect(() =>
      parseDeidSpec({
        ...base,
        transforms: [{ field: "visit_date", op: "date_shift", params: { maxDays: 31 } }],
        denyIfTransformMissing: [],
      }),
    ).toThrow(/maxDays/);
  });

  it("deduplicates policy columns while preserving fail-closed rules", () => {
    const spec = parseDeidSpec({
      ...base,
      quasiIdentifierPolicy: { k: 5, suppressIfBelow: true, columns: ["age", "age", "sex"] },
    });
    expect(spec.quasiIdentifierPolicy?.columns).toEqual(["age", "sex"]);
  });
});

describe("deid spec signature payload", () => {
  it("sig 载荷口径唯一且与模块签名前缀隔离（用途分离）", () => {
    const sm3 = "A".repeat(64);
    expect(deidSpecSignaturePayload(sm3)).toBe(`${DEID_SPEC_SIGNATURE_PAYLOAD_PREFIX}${sm3.toLowerCase()}`);
    expect(DEID_SPEC_SIGNATURE_PAYLOAD_PREFIX).toBe("medtrust.deid-spec.v1:");
    expect(DEID_SPEC_SIGNATURE_PAYLOAD_PREFIX).not.toBe("medtrust.algorithm-module.v1:");
  });
});
