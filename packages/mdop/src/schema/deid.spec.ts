import {
  DEID_DICTIONARY_SIGNATURE_PAYLOAD_PREFIX,
  DEID_SPEC_SIGNATURE_PAYLOAD_PREFIX,
  DeidSpecError,
  deidDictionarySignaturePayload,
  deidSpecSignaturePayload,
  dictionaryManifestRef,
  parseDeidDictionaryManifest,
  parseDeidDictionaryRef,
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

describe("dictionaryRef / 词表清单", () => {
  const textSpec = (params: Record<string, unknown>) => ({
    ...base,
    transforms: [
      base.transforms[0],
      base.transforms[1], // name: drop（denyIfTransformMissing 要求它在场）
      { field: "note_text", op: "text_rules", params },
    ],
  });

  it("person_name 必须绑定版本化词表（没有 dictionaryRef 即拒）", () => {
    expect(() => parseDeidSpec(textSpec({ rules: ["person_name"] }))).toThrow(/dictionaryRef 必填/);
    // 只做正则类规则时不需要词表
    expect(() => parseDeidSpec(textSpec({ rules: ["phone", "id_card"] }))).not.toThrow();
  });

  it("dictionaryRef 形态必须是 <id>:v<version>", () => {
    expect(parseDeidDictionaryRef("deid:cn-names:v2")).toEqual({
      ref: "deid:cn-names:v2",
      dictionaryId: "deid:cn-names",
      version: 2,
    });
    for (const bad of ["deid:cn-names", "deid:cn-names:v0", "deid:cn-names:v2x", "", "Deid:cn:v2"]) {
      expect(() => parseDeidDictionaryRef(bad)).toThrow(DeidSpecError);
    }
    expect(() =>
      parseDeidSpec(textSpec({ rules: ["person_name"], dictionaryRef: "cn-names@2" })),
    ).toThrow(/dictionaryRef/);
  });

  it("词表清单只认摘要与版本，形状非法即拒", () => {
    const manifest = {
      dictionaryId: "deid:cn-names",
      version: 2,
      sm3: "a".repeat(64),
      byteSize: 4096,
      keyId: "b".repeat(64),
      issuedAt: new Date().toISOString(),
      notAfter: new Date(Date.now() + 86_400_000).toISOString(),
      signature: "sig",
    };
    const parsed = parseDeidDictionaryManifest(manifest);
    expect(parsed.signaturePayload).toBe(`${DEID_DICTIONARY_SIGNATURE_PAYLOAD_PREFIX}${"a".repeat(64)}`);
    expect(dictionaryManifestRef(parsed)).toBe("deid:cn-names:v2");
    expect(() => parseDeidDictionaryManifest({ ...manifest, sm3: "zz" })).toThrow(DeidSpecError);
    expect(() => parseDeidDictionaryManifest({ ...manifest, byteSize: 0 })).toThrow(/byteSize/);
    expect(() => parseDeidDictionaryManifest({ ...manifest, version: 0 })).toThrow(/version/);
    expect(
      parseDeidDictionaryManifest({ ...manifest, signaturePayload: deidDictionarySignaturePayload("a".repeat(64)) })
        .signaturePayload,
    ).toContain("deid-dictionary");
  });

  it("词表签名前缀与规格前缀隔离", () => {
    expect(DEID_DICTIONARY_SIGNATURE_PAYLOAD_PREFIX).not.toBe(DEID_SPEC_SIGNATURE_PAYLOAD_PREFIX);
  });
});
