import {
  createAttestationVerifier,
  mapVendorQuote,
  reportDataBinding,
  type AttestationReport,
  type TrustedRoot,
  type VendorQuote,
} from "./provider";
import { evaluateKeyRelease, warrantDigest, type ReleaseInput } from "./release";

const NOW = new Date("2026-09-25T10:00:00.000Z");

function tdxQuote(over: Partial<VendorQuote> = {}): VendorQuote {
  const merged = {
    vendor: "tdx" as const,
    measurement: "sm3:" + "a".repeat(64),
    tcb: "3.1.2",
    quote: "dGR4LXF1b3Rl",
    signed_at: new Date(NOW.getTime() - 60_000).toISOString(),
    valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
    ephemeral_public_key: "04" + "5".repeat(128),
    node: "urn:tds:sh-med:participant:tee-1",
    ...over,
  };
  let report_data = merged.report_data;
  if (report_data === undefined && merged.ephemeral_public_key) {
    try {
      report_data = reportDataBinding(merged.ephemeral_public_key);
    } catch {
      report_data = "";
    }
  }
  return { ...merged, report_data: report_data ?? "" };
}

function rootFor(report: AttestationReport): TrustedRoot {
  return { kind: report.kind!, verifyQuoteDigest: (digest) => digest === report.quote_digest };
}

function releaseInput(over: Partial<ReleaseInput> = {}): ReleaseInput {
  const report = over.report ?? mapVendorQuote(tdxQuote());
  return {
    job_id: "job-1",
    credential_id: "tkt-1",
    contract_id: "ctr-1",
    key_id: "k-1",
    key_owner: { job_id: "job-1", contract_id: "ctr-1" },
    credential_valid: true,
    contract_active: true,
    now: NOW,
    report,
    policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
    verifier: createAttestationVerifier([rootFor(report)]),
    ...over,
  };
}

describe("数据密钥释放判定（D-TEE-1 的七条判据）", () => {
  it("证明可用、凭证有效、合约未终止、密钥归属正确 → 释放并给出凭据摘要", () => {
    const out = evaluateKeyRelease(releaseInput());
    expect(out.released).toBe(true);
    expect(out.key_id).toBe("k-1");
    expect(out.warrant_digest).toMatch(/^sm3:[0-9a-f]{64}$/);
  });

  it("凭据摘要稳定且随证明变化（换代码/换作业即变，可用于持有方离线复核）", () => {
    const base = warrantDigest(releaseInput());
    expect(warrantDigest(releaseInput())).toBe(base);

    const otherMeasurement = mapVendorQuote(tdxQuote({ measurement: "sm3:" + "b".repeat(64) }));
    expect(warrantDigest(releaseInput({ report: otherMeasurement, verifier: createAttestationVerifier([rootFor(otherMeasurement)]) }))).not.toBe(
      base,
    );
  });

  it("凭证无效 → E_TICKET_INVALID（不释放）", () => {
    expect(() => evaluateKeyRelease(releaseInput({ credential_valid: false }))).toThrow(
      expect.objectContaining({ code: "E_TICKET_INVALID" }),
    );
  });

  it("合约已终止 → E_KEY_RELEASE_DENIED", () => {
    expect(() => evaluateKeyRelease(releaseInput({ contract_active: false }))).toThrow(
      expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }),
    );
  });

  it("拿别的作业/别的合约的密钥 → E_KEY_RELEASE_DENIED", () => {
    expect(() =>
      evaluateKeyRelease(releaseInput({ key_owner: { job_id: "job-2", contract_id: "ctr-1" } })),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));
    expect(() =>
      evaluateKeyRelease(releaseInput({ key_owner: { job_id: "job-1", contract_id: "ctr-2" } })),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));
  });

  it("证明过期 → E_ATTESTATION_FAILED（先于凭证与合约判定）", () => {
    const expired = mapVendorQuote(
      tdxQuote({
        signed_at: new Date(NOW.getTime() - 900_000).toISOString(),
        valid_until: new Date(NOW.getTime() - 1).toISOString(),
      }),
    );
    expect(() =>
      evaluateKeyRelease(
        releaseInput({ report: expired, verifier: createAttestationVerifier([rootFor(expired)]) }),
      ),
    ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
  });

  it("度量不在允许清单 → E_MEASUREMENT_NOT_ALLOWED", () => {
    expect(() =>
      evaluateKeyRelease(
        releaseInput({ policy: { tee: ["tdx"], allowed_measurements: ["sm3:" + "9".repeat(64)] } }),
      ),
    ).toThrow(expect.objectContaining({ code: "E_MEASUREMENT_NOT_ALLOWED" }));
  });

  it("TCB 低于按链给出的下限 → E_TCB_TOO_OLD", () => {
    expect(() =>
      evaluateKeyRelease(releaseInput({ policy: { tee: ["tdx"], min_tcb: { tdx: "3.2.0" } } })),
    ).toThrow(expect.objectContaining({ code: "E_TCB_TOO_OLD" }));
  });

  it("一次性公钥未进 report_data → 不释放（fail-closed，不回退）", () => {
    const bound = mapVendorQuote(tdxQuote({ report_data: reportDataBinding("04" + "5".repeat(128)) }));
    const unbound = { ...bound, report_data: null };
    expect(() => evaluateKeyRelease(releaseInput({ report: unbound }))).toThrow(
      expect.objectContaining({
        code: "E_ATTESTATION_FAILED",
        message: expect.stringContaining("不得产生半份证明"),
      }),
    );
  });

  it("report_data 与公钥派生值不符 → 不释放（fail-closed，不回退）", () => {
    const key = "04" + "5".repeat(128);
    const bound = mapVendorQuote(tdxQuote({ report_data: reportDataBinding(key) }));
    const mismatched = { ...bound, report_data: reportDataBinding("04" + "9".repeat(128)) };
    expect(() => evaluateKeyRelease(releaseInput({ report: mismatched }))).toThrow(
      expect.objectContaining({
        code: "E_ATTESTATION_FAILED",
        message: expect.stringContaining("不得产生半份证明"),
      }),
    );
  });

  it("一次性公钥已绑定进 report_data → 释放", () => {
    const key = "04" + "5".repeat(128);
    const report = mapVendorQuote(tdxQuote({ ephemeral_public_key: key, report_data: reportDataBinding(key) }));
    expect(report.report_data).toBe(reportDataBinding(key));
    const out = evaluateKeyRelease(
      releaseInput({ report, verifier: createAttestationVerifier([rootFor(report)]) }),
    );
    expect(out.released).toBe(true);
  });
});
