import { ConfigService } from "@nestjs/config";
import {
  createAttestationVerifier,
  evaluateKeyRelease,
  mapVendorQuote,
  reportDataBinding,
  SoftwareAttestationProvider,
  type AttestationPolicy,
  type AttestationReport,
  type TrustedRoot,
  type VendorQuote,
} from "@medtrust/mdop";
import { ConfidentialComputeAttestationAdapter } from "./confidential-compute-attestation.adapter";
import type { ControlPlaneAttestationRegistry } from "./attestation-registry";

function tdxQuote(): VendorQuote {
  const now = Date.now();
  const ephemeral_public_key = "04" + "5".repeat(128);
  return {
    vendor: "tdx",
    measurement: "sm3:" + "a".repeat(64),
    tcb: "3.1.2",
    quote: "dGR4LXF1b3Rl",
    signed_at: new Date(now - 60_000).toISOString(),
    valid_until: new Date(now + 300_000).toISOString(),
    ephemeral_public_key,
    report_data: reportDataBinding(ephemeral_public_key),
    node: "urn:tds:sh-med:participant:tee-1",
  };
}

function rootFor(report: AttestationReport): TrustedRoot {
  return {
    kind: report.kind!,
    verifyQuoteDigest: (digest) => digest === report.quote_digest,
  };
}

function hardwareFixture(): {
  report: AttestationReport;
  registry: ControlPlaneAttestationRegistry;
} {
  const report = mapVendorQuote(tdxQuote());
  const policy: AttestationPolicy = {
    tee: ["tdx"],
    min_tcb: { tdx: "3.1.0" },
    allowed_measurements: [report.measurement],
  };
  return { report, registry: { roots: [rootFor(report)], policy } };
}

function adapterOf(
  registry?: ControlPlaneAttestationRegistry | null,
): ConfidentialComputeAttestationAdapter {
  const config = {
    get: jest.fn((_key: string, fallback?: string) => fallback),
  };
  return new ConfidentialComputeAttestationAdapter(
    config as unknown as ConfigService,
    registry ?? null,
  );
}

describe("ConfidentialComputeAttestationAdapter — 接到 mdop 证明契约", () => {
  it("未注入 TrustedRoot → E_ATTESTATION_FAILED（拒绝理由来自接缝，不是写死 false）", () => {
    const { report } = hardwareFixture();
    expect(() => adapterOf().verifyAttestation(report)).toThrow(
      expect.objectContaining({
        code: "E_ATTESTATION_FAILED",
        message: expect.stringContaining("未注入 TrustedRoot"),
      }),
    );
  });

  it("注入空 roots → 同样按无信任根拒绝", () => {
    const { report, registry } = hardwareFixture();
    expect(() =>
      adapterOf({ ...registry, roots: [] }).verifyAttestation(report),
    ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
  });

  it("注入信任根但未给 AttestationPolicy → E_ATTESTATION_FAILED", () => {
    const { report, registry } = hardwareFixture();
    expect(() =>
      adapterOf({ roots: registry.roots }).verifyAttestation(report),
    ).toThrow(
      expect.objectContaining({
        code: "E_ATTESTATION_FAILED",
        message: expect.stringContaining("未注入 AttestationPolicy"),
      }),
    );
  });

  it("注入测试 TrustedRoot + 硬件级报告 → 校验通过，且 evaluateKeyRelease 放行", () => {
    const { report, registry } = hardwareFixture();
    expect(() => adapterOf(registry).verifyAttestation(report)).not.toThrow();

    const decision = evaluateKeyRelease({
      job_id: "job-1",
      credential_id: "tkt-1",
      contract_id: "ctr-1",
      key_id: "k-1",
      key_owner: { job_id: "job-1", contract_id: "ctr-1" },
      credential_valid: true,
      contract_active: true,
      report,
      policy: registry.policy!,
      verifier: createAttestationVerifier(registry.roots!),
    });
    expect(decision.released).toBe(true);
    expect(decision.key_id).toBe("k-1");
    expect(decision.warrant_digest).toMatch(/^sm3:[0-9a-f]{64}$/);
  });

  it("软件级报告（即使已注入信任根）→ E_CAPABILITY_MISMATCH", async () => {
    const { registry } = hardwareFixture();
    const software = await new SoftwareAttestationProvider({
      measurement: `sm3:${"0".repeat(64)}`,
    }).prove();
    expect(() => adapterOf(registry).verifyAttestation(software)).toThrow(
      expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }),
    );
  });

  it("未注入时 getAttestationReport 只产出 software 级占位，校验仍拒", async () => {
    const { registry } = hardwareFixture();
    const placeholder = await adapterOf().getAttestationReport("i-cc-test");
    expect(placeholder.level).toBe("software");
    expect(placeholder.kind).toBeNull();
    expect(() => adapterOf(registry).verifyAttestation(placeholder)).toThrow(
      expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }),
    );
  });
});
