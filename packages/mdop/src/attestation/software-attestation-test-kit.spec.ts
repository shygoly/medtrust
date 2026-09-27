import type { AttestationPolicy } from "../label/lattice";
import {
  createAttestationVerifier,
  reportDataBinding,
  SoftwareAttestationProvider,
  verifyAttestationForC2,
  type AttestationReport,
  type TrustedRoot,
} from "./provider";
import { evaluateKeyRelease } from "./release";
import {
  createSoftwareAttestationTestKit,
  SOFTWARE_ATTESTATION_TEST_KIT_PRODUCTION_FORBIDDEN,
  verifyAttestationForC2InTestMode,
} from "./software-attestation-test-kit";

const NOW = new Date("2026-09-27T10:00:00.000Z");
const MEASUREMENT = "sm3:" + "a".repeat(64);

function withNodeEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
}

function policyFor(report: AttestationReport): AttestationPolicy {
  return {
    tee: [report.kind!],
    min_tcb: { [report.kind!]: "3.1.0" },
    allowed_measurements: [report.measurement],
  };
}

function rootFor(report: AttestationReport): TrustedRoot {
  return {
    kind: report.kind!,
    verifyQuoteDigest: (digest) => digest === report.quote_digest,
  };
}

describe("软件证明测试通道（只演练接口，不构成 C2 证据）", () => {
  it("测试期产出与硬件同形状的 software 报告，且 report_data 绑定一次性公钥", async () => {
    const kit = createSoftwareAttestationTestKit({
      measurement: MEASUREMENT,
      now: () => NOW,
    });
    const report = await kit.provider.prove();

    expect(report.level).toBe("software");
    expect(report.isolation).toBe("none");
    expect(report.kind).toBe("tdx");
    expect(report.measurement).toBe(MEASUREMENT);
    expect(report.quote_digest).toMatch(/^sm3:[0-9a-f]{64}$/);
    expect(report.tcb).toBe("3.1.2");
    expect(report.ephemeral_public_key).toMatch(/^04[0-9a-f]{128}$/);
    expect(report.report_data).toBe(reportDataBinding(report.ephemeral_public_key!));
    expect(report.node).toBeTruthy();
    expect(report.issued_at).toBe(NOW.toISOString());
    expect(Date.parse(report.expires_at)).toBeGreaterThan(NOW.getTime());
  });

  it("正：测试通道下软件报告走通判定，且 evaluateKeyRelease 释放", async () => {
    const kit = createSoftwareAttestationTestKit({
      measurement: MEASUREMENT,
      now: () => NOW,
    });
    const report = await kit.provider.prove();
    const policy = policyFor(report);
    const verifier = kit.createVerifier([rootFor(report)]);

    expect(() =>
      kit.verifyAttestationForC2InTestMode({ report, policy, verifier, now: NOW }),
    ).not.toThrow();

    const decision = kit.evaluateKeyRelease({
      job_id: "job-1",
      credential_id: "tkt-1",
      contract_id: "ctr-1",
      key_id: "k-1",
      key_owner: { job_id: "job-1", contract_id: "ctr-1" },
      credential_valid: true,
      contract_active: true,
      report,
      policy,
      verifier,
      now: NOW,
    });
    expect(decision.released).toBe(true);
    expect(decision.key_id).toBe("k-1");
    expect(decision.warrant_digest).toMatch(/^sm3:[0-9a-f]{64}$/);
  });

  it("反 1：生产判据下构造测试通道必须抛错，并写明不构成 C2 证据与 D9/CTL-09", () => {
    withNodeEnv("production", () => {
      expect(() => createSoftwareAttestationTestKit({ measurement: MEASUREMENT })).toThrow(
        SOFTWARE_ATTESTATION_TEST_KIT_PRODUCTION_FORBIDDEN,
      );
      expect(() => createSoftwareAttestationTestKit({ measurement: MEASUREMENT })).toThrow(/D9/);
      expect(() => createSoftwareAttestationTestKit({ measurement: MEASUREMENT })).toThrow(/CTL-09/);
      expect(() => createSoftwareAttestationTestKit({ measurement: MEASUREMENT })).toThrow(/不构成 C2/);
    });
    withNodeEnv(" Production ", () => {
      expect(() => createSoftwareAttestationTestKit({ measurement: MEASUREMENT })).toThrow(/D9/);
    });
  });

  it("反 1b：显式传入 production 判据同样构造即抛（不依赖进程环境）", () => {
    expect(() =>
      createSoftwareAttestationTestKit({ measurement: MEASUREMENT, env: "production" }),
    ).toThrow(SOFTWARE_ATTESTATION_TEST_KIT_PRODUCTION_FORBIDDEN);
  });

  it("反 2：生产判据（无测试通道）软件报告仍拒 E_CAPABILITY_MISMATCH", async () => {
    const software = await new SoftwareAttestationProvider({
      measurement: MEASUREMENT,
      now: () => NOW,
    }).prove();
    const verifier = createAttestationVerifier([
      { kind: "tdx", verifyQuoteDigest: () => true },
    ]);
    const policy: AttestationPolicy = { tee: ["tdx"] };

    expect(() => verifyAttestationForC2({ report: software, policy, verifier, now: NOW })).toThrow(
      expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }),
    );
    expect(() =>
      evaluateKeyRelease({
        job_id: "job-1",
        credential_id: "tkt-1",
        contract_id: "ctr-1",
        key_id: "k-1",
        key_owner: { job_id: "job-1", contract_id: "ctr-1" },
        credential_valid: true,
        contract_active: true,
        report: software,
        policy,
        verifier,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
  });

  it("反 3：测试通道里 report_data 未绑定 / 不符仍拒（T1 仍生效）", async () => {
    const kit = createSoftwareAttestationTestKit({
      measurement: MEASUREMENT,
      now: () => NOW,
    });
    const bound = await kit.provider.prove();
    const policy = policyFor(bound);
    const verifier = kit.createVerifier([rootFor(bound)]);

    expect(() =>
      kit.verifyAttestationForC2InTestMode({
        report: { ...bound, report_data: undefined },
        policy,
        verifier,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));

    expect(() =>
      kit.verifyAttestationForC2InTestMode({
        report: { ...bound, report_data: "sm3:" + "f".repeat(64) },
        policy,
        verifier,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
  });

  it("测试通道仍执行度量白名单与 TCB 下限（只放行硬件来源这一条）", async () => {
    const kit = createSoftwareAttestationTestKit({
      measurement: MEASUREMENT,
      now: () => NOW,
    });
    const report = await kit.provider.prove();
    const verifier = kit.createVerifier([rootFor(report)]);

    expect(() =>
      kit.verifyAttestationForC2InTestMode({
        report,
        policy: { tee: ["tdx"], allowed_measurements: ["sm3:" + "b".repeat(64)] },
        verifier,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_MEASUREMENT_NOT_ALLOWED" }));

    expect(() =>
      kit.verifyAttestationForC2InTestMode({
        report,
        policy: { tee: ["tdx"], min_tcb: { tdx: "9.9.9" } },
        verifier,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_TCB_TOO_OLD" }));
  });

  it("生产判据下调用测试校验入口同样抛错", () => {
    withNodeEnv("production", () => {
      expect(() =>
        verifyAttestationForC2InTestMode({
          report: {
            kind: "tdx",
            level: "software",
            isolation: "none",
            measurement: MEASUREMENT,
            quote_digest: "sm3:" + "b".repeat(64),
            tcb: "3.1.2",
            ephemeral_public_key: "04" + "d".repeat(128),
            report_data: reportDataBinding("04" + "d".repeat(128)),
            issued_at: NOW.toISOString(),
            expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
          },
          policy: { tee: ["tdx"] },
          verifier: { verify: () => true },
          now: NOW,
        }),
      ).toThrow(/D9/);
    });
  });

  it("开发判据下可构造（Jest 默认 NODE_ENV=test）", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(() => createSoftwareAttestationTestKit({ measurement: MEASUREMENT })).not.toThrow();
  });
});
