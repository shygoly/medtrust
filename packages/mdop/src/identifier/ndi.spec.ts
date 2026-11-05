import {
  assertNdiId,
  assertSupportedScheme,
  isNdiId,
  NdiIdentifierError,
  NDI_ID_SCHEME_VERSION,
  ndiIdFromInternal,
  ndiOrgCodeFromEnv,
  parseNdiId,
  sequenceFor,
  toNdiId,
} from "./ndi";

const ORG = "91610131MA6U000000";

describe("NDI 标识映射（NDI-TR-2025-04，draft-1）", () => {
  it("生成与解析可往返，同一内部对象得到同一标识", () => {
    const a = toNdiId({ type: "product", orgCode: ORG, internalId: "urn:tds:sp:abc" });
    const b = toNdiId({ type: "product", orgCode: ORG, internalId: "urn:tds:sp:abc" });
    expect(a).toBe(b);
    const parsed = parseNdiId(a);
    expect(parsed.scheme).toBe(NDI_ID_SCHEME_VERSION);
    expect(parsed.type).toBe("product");
    expect(parsed.orgCode).toBe(ORG);
    expect(parsed.seq).toBe(sequenceFor("urn:tds:sp:abc"));
    expect(assertNdiId(a)).toBe(a);
    expect(isNdiId(a)).toBe(true);
  });

  it("不同类型 / 不同对象得到不同标识", () => {
    const p = toNdiId({ type: "product", orgCode: ORG, internalId: "x" });
    const s = toNdiId({ type: "service", orgCode: ORG, internalId: "x" });
    const q = toNdiId({ type: "product", orgCode: ORG, internalId: "y" });
    expect(new Set([p, s, q]).size).toBe(3);
  });

  it("机构码缺失 → NDI_ORG_CODE_MISSING（不猜默认值）", () => {
    expect(() => toNdiId({ type: "product", orgCode: "  ", internalId: "x" })).toThrow(
      NdiIdentifierError,
    );
    try {
      toNdiId({ type: "product", orgCode: "", internalId: "x" });
    } catch (err) {
      expect((err as NdiIdentifierError).code).toBe("NDI_ORG_CODE_MISSING");
    }
  });

  it("机构码非法 → NDI_ORG_CODE_INVALID", () => {
    try {
      toNdiId({ type: "product", orgCode: "机构 一号", internalId: "x" });
      throw new Error("should throw");
    } catch (err) {
      expect((err as NdiIdentifierError).code).toBe("NDI_ORG_CODE_INVALID");
    }
  });

  it("校验位被篡改 → NDI_ID_INVALID", () => {
    const id = toNdiId({ type: "product", orgCode: ORG, internalId: "x" });
    const tampered = id.slice(0, -4) + "0000";
    expect(() => parseNdiId(tampered)).toThrow(NdiIdentifierError);
    expect(isNdiId(tampered)).toBe(false);
  });

  it("未知版本 → NDI_SCHEME_UNSUPPORTED", () => {
    const id = toNdiId({ type: "product", orgCode: ORG, internalId: "x" }).replace(
      `:${NDI_ID_SCHEME_VERSION}:`,
      ":v9:",
    );
    try {
      parseNdiId(id);
      throw new Error("should throw");
    } catch (err) {
      expect((err as NdiIdentifierError).code).toBe("NDI_SCHEME_UNSUPPORTED");
    }
    expect(() => assertSupportedScheme({ NDI_ID_SCHEME_VERSION: "v9" } as NodeJS.ProcessEnv)).toThrow(
      NdiIdentifierError,
    );
  });

  it("段数/前缀/序号格式不符一律拒绝", () => {
    for (const bad of ["", "ndi", "ndi:draft-1:product", `xx:${NDI_ID_SCHEME_VERSION}:product:${ORG}:0123456789ab:0000`]) {
      expect(isNdiId(bad)).toBe(false);
    }
    const good = toNdiId({ type: "product", orgCode: ORG, internalId: "x" });
    expect(isNdiId(good.replace(/:[0-9a-f]{12}:/, ":ZZZ:"))).toBe(false);
  });

  it("ndiIdFromInternal 只做显式映射（不猜类型）", () => {
    const asService = ndiIdFromInternal({ internalId: "urn:tds:sp:p1", orgCode: ORG, type: "service" });
    expect(parseNdiId(asService).type).toBe("service");
    expect(ndiOrgCodeFromEnv({} as NodeJS.ProcessEnv)).toBe("");
    expect(ndiOrgCodeFromEnv({ NDI_ORG_CODE: ` ${ORG} ` } as NodeJS.ProcessEnv)).toBe(ORG);
  });
});
