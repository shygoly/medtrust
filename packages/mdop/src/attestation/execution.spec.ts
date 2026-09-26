import { parseTicketCore } from "../schema/ticket";
import {
  createAttestationVerifier,
  mapVendorQuote,
  type AttestationReport,
  type TrustedRoot,
  type VendorQuote,
} from "./provider";
import { verifyC2Execution, type C2ExecutionCheck, type SessionWarrant } from "./execution";

const NOW = new Date("2026-09-25T10:00:00.000Z");

function quote(over: Partial<VendorQuote> = {}): VendorQuote {
  return {
    vendor: "tdx",
    measurement: "sm3:" + "a".repeat(64),
    tcb: "3.1.2",
    quote: "dGR4LXF1b3Rl",
    signed_at: new Date(NOW.getTime() - 30_000).toISOString(),
    valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
    ephemeral_public_key: "04" + "4".repeat(128),
    node: "urn:tds:sh-med:participant:tee-1",
    ...over,
  };
}

function rootOf(report: AttestationReport): TrustedRoot {
  return { kind: report.kind!, verifyQuoteDigest: (d) => d === report.quote_digest };
}

function warrantFor(report: AttestationReport, over: Partial<SessionWarrant> = {}): SessionWarrant {
  return {
    digest: "sm3:" + "f".repeat(64),
    signature_valid: true,
    job_id: "job-1",
    credential_id: "tkt-1",
    contract_id: "ctr-1",
    key_id: "k-1",
    quote_digest: report.quote_digest!,
    measurement: report.measurement,
    tcb: report.tcb,
    expires_at: new Date(NOW.getTime() + 120_000).toISOString(),
    ...over,
  };
}

function check(over: Partial<C2ExecutionCheck> = {}): C2ExecutionCheck {
  const report = over.report ?? mapVendorQuote(quote());
  return {
    expectation: { tee: "tdx", measurement: report.measurement, min_tcb: "3.1.0" },
    report,
    policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
    verifier: createAttestationVerifier([rootOf(report)]),
    warrant: over.warrant ?? warrantFor(report),
    context: { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1", key_id: "k-1" },
    now: NOW,
    ...over,
  };
}

describe("执行前的证明核对（凭证期望 × 会话证明 × 释放凭据）", () => {
  it("三者一致 → 放行", () => {
    expect(() => verifyC2Execution(check())).not.toThrow();
  });

  it("凭证里冻结的期望结构可被票据解析（C2 作业）", () => {
    const core = parseTicketCore({
      ticket_id: "tkt-1",
      job_id: "job-1",
      plan_hash: "sm3:" + "1".repeat(64),
      fragments: { hospA: "sm3:" + "2".repeat(64) },
      not_before: NOW.toISOString(),
      not_after: new Date(NOW.getTime() + 3_600_000).toISOString(),
      attestation: {
        "urn:tds:sh-med:participant:tee-1": {
          tee: "tdx",
          measurement: "sm3:" + "a".repeat(64),
          min_tcb: "3.1.0",
        },
      },
    });
    expect(core.attestation).toEqual({
      "urn:tds:sh-med:participant:tee-1": {
        tee: "tdx",
        measurement: "sm3:" + "a".repeat(64),
        min_tcb: "3.1.0",
      },
    });
  });

  it("非 C2 作业的票据不含期望（向后兼容）", () => {
    const core = parseTicketCore({
      ticket_id: "tkt-2",
      job_id: "job-2",
      plan_hash: "sm3:" + "1".repeat(64),
      fragments: { hospA: "sm3:" + "2".repeat(64) },
      not_before: NOW.toISOString(),
      not_after: new Date(NOW.getTime() + 3_600_000).toISOString(),
    });
    expect(core.attestation).toBeUndefined();
  });

  it("票据里的期望含未定义字段 → 解析即拒", () => {
    expect(() =>
      parseTicketCore({
        ticket_id: "tkt-3",
        job_id: "job-3",
        plan_hash: "sm3:" + "1".repeat(64),
        fragments: { hospA: "sm3:" + "2".repeat(64) },
        not_before: NOW.toISOString(),
        not_after: new Date(NOW.getTime() + 3_600_000).toISOString(),
        attestation: { tee1: { tee: "tdx", measurement: "sm3:x", extra: 1 } },
      }),
    ).toThrow(/未定义字段/);
  });

  it("两个可信空间节点可以各有各的期望（按节点存放，不共用一份）", () => {
    const core = parseTicketCore({
      ticket_id: "tkt-4",
      job_id: "job-4",
      plan_hash: "sm3:" + "1".repeat(64),
      fragments: { hospA: "sm3:" + "2".repeat(64) },
      not_before: NOW.toISOString(),
      not_after: new Date(NOW.getTime() + 3_600_000).toISOString(),
      attestation: {
        "tee-csv": { tee: "csv", measurement: "sm3:" + "c".repeat(64), min_tcb: "2026-06" },
        "tee-tdx": { tee: "tdx", measurement: "sm3:" + "d".repeat(64), min_tcb: "3.1.2" },
      },
    });
    expect(Object.keys(core.attestation!).sort()).toEqual(["tee-csv", "tee-tdx"]);
    expect(core.attestation!["tee-tdx"].min_tcb).toBe("3.1.2");
    expect(core.attestation!["tee-csv"].tee).toBe("csv");
  });

  it("空的期望映射 / 空节点名 → 解析即拒", () => {
    const base = {
      ticket_id: "tkt-5",
      job_id: "job-5",
      plan_hash: "sm3:" + "1".repeat(64),
      fragments: { hospA: "sm3:" + "2".repeat(64) },
      not_before: NOW.toISOString(),
      not_after: new Date(NOW.getTime() + 3_600_000).toISOString(),
    };
    expect(() => parseTicketCore({ ...base, attestation: {} })).toThrow(/至少给出一个节点/);
    expect(() =>
      parseTicketCore({
        ...base,
        attestation: { "  ": { tee: "tdx", measurement: "sm3:x" } },
      }),
    ).toThrow(/节点标识不得为空/);
  });

  it("代码被换版（度量与凭证期望不符）→ E_MEASUREMENT_NOT_ALLOWED", () => {
    const report = mapVendorQuote(quote({ measurement: "sm3:" + "c".repeat(64) }));
    expect(() =>
      verifyC2Execution(
        check({
          report,
          policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
          expectation: { tee: "tdx", measurement: "sm3:" + "a".repeat(64), min_tcb: "3.1.0" },
          verifier: createAttestationVerifier([rootOf(report)]),
          warrant: warrantFor(report),
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "E_MEASUREMENT_NOT_ALLOWED" }));
  });

  it("链型与凭证期望不符 → E_CAPABILITY_MISMATCH", () => {
    const report = mapVendorQuote(quote({ vendor: "csv", tcb: "2026-06" }));
    expect(() =>
      verifyC2Execution(
        check({
          report,
          policy: { tee: ["csv"], min_tcb: { csv: "2026-01" } },
          expectation: { tee: "tdx", measurement: report.measurement },
          verifier: createAttestationVerifier([rootOf(report)]),
          warrant: warrantFor(report),
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
  });

  it("释放凭据签名无效 / 归属别的作业 / 与本次证明不同源 / 已过期 → 逐条拒绝", () => {
    const report = mapVendorQuote(quote());
    const base = check({ report, verifier: createAttestationVerifier([rootOf(report)]) });

    expect(() =>
      verifyC2Execution({ ...base, warrant: warrantFor(report, { signature_valid: false }) }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));

    expect(() =>
      verifyC2Execution({ ...base, warrant: warrantFor(report, { job_id: "job-2" }) }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));

    expect(() =>
      verifyC2Execution({
        ...base,
        warrant: warrantFor(report, { quote_digest: "sm3:" + "9".repeat(64) }),
      }),
    ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));

    expect(() =>
      verifyC2Execution({
        ...base,
        warrant: warrantFor(report, { expires_at: new Date(NOW.getTime() - 1).toISOString() }),
      }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));
  });

  it("凭证里的下限比实际 TCB 高 → E_TCB_TOO_OLD", () => {
    const report = mapVendorQuote(quote({ tcb: "3.1.2" }));
    expect(() =>
      verifyC2Execution(
        check({
          report,
          expectation: { tee: "tdx", measurement: report.measurement, min_tcb: "3.2.0" },
          verifier: createAttestationVerifier([rootOf(report)]),
          warrant: warrantFor(report),
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "E_TCB_TOO_OLD" }));
  });

  describe("无厂商证明根的一方（如数据持有方连接器）：靠已签名的释放凭据背书", () => {
    it("不给 verifier 时，凭据签名有效即放行（quote 由 KMS 验过、凭据为证）", () => {
      const report = mapVendorQuote(quote());
      expect(() =>
        verifyC2Execution(check({ report, verifier: undefined })),
      ).not.toThrow();
    });

    it("不给 verifier 且凭据没有有效签名 → 拒（等于既没验 quote 也没背书）", () => {
      const report = mapVendorQuote(quote());
      expect(() =>
        verifyC2Execution(
          check({
            report,
            verifier: undefined,
            warrant: warrantFor(report, { signature_valid: false }),
          }),
        ),
      ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
    });

    it("声明层面的问题照旧拦：软件级证明 / 链型不符 / 过期", () => {
      const software = {
        kind: null,
        level: "software" as const,
        isolation: "none" as const,
        measurement: "sm3:" + "s".repeat(64),
        quote_digest: null,
        tcb: null,
        ephemeral_public_key: null,
        issued_at: NOW.toISOString(),
        expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
      };
      expect(() =>
        verifyC2Execution(
          check({
            report: software,
            verifier: undefined,
            expectation: { tee: "tdx", measurement: software.measurement },
            warrant: warrantFor(software as never),
          }),
        ),
      ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
    });
  });
});
