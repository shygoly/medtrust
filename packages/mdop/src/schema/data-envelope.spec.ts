import {
  DATA_ENVELOPE_VERSION,
  assertEnvelopeBinding,
  parseDataEnvelope,
  type DataEnvelope,
} from "./data-envelope";
import { SchemaError } from "./strict";

function validEnvelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    envelope: DATA_ENVELOPE_VERSION,
    payload: {
      cipher: "SM4-GCM",
      ciphertext_ref: "blob://pilot/1",
      digest: "sm3:" + "b".repeat(64),
    },
    wrapped_key: { kms: "kms://space.example.cn", key_id: "k-7781" },
    policy: {
      contract: "ctr-1",
      purpose: ["RWS.EFFECTIVENESS"],
      allowed_ops: ["sm3:" + "9".repeat(64)],
      attestation_policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.2" } },
      export: "C3_only",
      not_after: "2027-09-30T00:00:00.000Z",
    },
    watermark: "wm:site-a:0912:space",
    origin_sig: { signer: "urn:tds:sp:participant:hospA", alg: "SM2-SM3", value: "3045..." },
    aad: { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1" },
    ...over,
  };
}

describe("数据信封 mdop.env/1.0（协议 §9.3）", () => {
  it("合法信封解析成功，字段原样保留", () => {
    const env = parseDataEnvelope(validEnvelope());
    expect(env.envelope).toBe(DATA_ENVELOPE_VERSION);
    expect(env.payload.cipher).toBe("SM4-GCM");
    expect(env.wrapped_key.key_id).toBe("k-7781");
    expect(env.policy.export).toBe("C3_only");
    expect(env.policy.attestation_policy.tee).toEqual(["tdx"]);
    expect(env.policy.attestation_policy.min_tcb).toEqual({ tdx: "3.1.2" });
    expect(env.aad).toEqual({ job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1" });
  });

  it("出现未定义字段即拒（严格解析，不静默忽略）", () => {
    expect(() => parseDataEnvelope(validEnvelope({ extra: 1 }))).toThrow(SchemaError);
    expect(() =>
      parseDataEnvelope({
        ...validEnvelope(),
        policy: { ...(validEnvelope().policy as object), export_extra: true },
      }),
    ).toThrow(SchemaError);
  });

  it("缺必填字段即拒（aad 是硬要求：没有它密文可被跨作业重放）", () => {
    const noAad = validEnvelope();
    delete (noAad as Record<string, unknown>).aad;
    expect(() => parseDataEnvelope(noAad)).toThrow(SchemaError);
  });

  it("出口不是 C3_only → 拒（本期未开放导出副本）", () => {
    expect(() =>
      parseDataEnvelope({
        ...validEnvelope(),
        policy: { ...(validEnvelope().policy as object), export: "raw_copy" },
      }),
    ).toThrow(/只允许 C3_only/);
  });

  it("版本不符 → 拒", () => {
    expect(() => parseDataEnvelope(validEnvelope({ envelope: "mdop.env/0.9" }))).toThrow(
      /只接受 mdop.env\/1.0/,
    );
  });

  it("密文摘要必须形如 sm3:<64hex>", () => {
    expect(() =>
      parseDataEnvelope({
        ...validEnvelope(),
        payload: { cipher: "SM4-GCM", ciphertext_ref: "blob://x", digest: "sha256:abc" },
      }),
    ).toThrow(SchemaError);
  });

  it("证明策略的 TCB 阈值支持单值与按链两种写法，非法写法被拒", () => {
    const single = parseDataEnvelope({
      ...validEnvelope(),
      policy: {
        ...(validEnvelope().policy as object),
        attestation_policy: { tee: ["csv"], min_tcb: "2026-06" },
      },
    });
    expect(single.policy.attestation_policy.min_tcb).toBe("2026-06");

    const perChain = parseDataEnvelope({
      ...validEnvelope(),
      policy: {
        ...(validEnvelope().policy as object),
        attestation_policy: { tee: ["csv", "tdx"], min_tcb: { csv: "2026-06", tdx: "3.1.2" } },
      },
    });
    expect(perChain.policy.attestation_policy.min_tcb).toEqual({ csv: "2026-06", tdx: "3.1.2" });

    expect(() =>
      parseDataEnvelope({
        ...validEnvelope(),
        policy: {
          ...(validEnvelope().policy as object),
          attestation_policy: { tee: ["tdx"], min_tcb: 202606 },
        },
      }),
    ).toThrow(SchemaError);
  });

  it("绑定核对：换作业 / 换凭证 / 换合约都拒（解封前先拒，不等解密失败）", () => {
    const env: DataEnvelope = parseDataEnvelope(validEnvelope());
    expect(() =>
      assertEnvelopeBinding(env, { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1" }),
    ).not.toThrow();

    expect(() =>
      assertEnvelopeBinding(env, { job_id: "job-2", credential_id: "tkt-1", contract_id: "ctr-1" }),
    ).toThrow(expect.objectContaining({ code: "E_ENVELOPE_POLICY" }));
    expect(() =>
      assertEnvelopeBinding(env, { job_id: "job-1", credential_id: "tkt-9", contract_id: "ctr-1" }),
    ).toThrow(expect.objectContaining({ code: "E_ENVELOPE_POLICY" }));
    expect(() =>
      assertEnvelopeBinding(env, { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-9" }),
    ).toThrow(expect.objectContaining({ code: "E_ENVELOPE_POLICY" }));
  });

  it("策略里的合约与绑定不一致 → 拒（防改策略字段绕过）", () => {
    const env = parseDataEnvelope({
      ...validEnvelope(),
      policy: { ...(validEnvelope().policy as object), contract: "ctr-other" },
    });
    expect(() =>
      assertEnvelopeBinding(env, { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1" }),
    ).toThrow(expect.objectContaining({ code: "E_ENVELOPE_POLICY" }));
  });
});
