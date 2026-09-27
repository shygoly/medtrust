/**
 * 软件证明测试通道。只演练接口与管线，不构成 C2 可用性证据。
 *
 * 生产判据（`NODE_ENV` 去空白小写 === `production`）下构造即抛——
 * 对照 `apps/connector/src/domain/tee.ts` 的 `assertSoftwareSealedComputeAllowed`。
 * 软件报告的 `level` 恒为 `software`、`isolation` 恒为 `none`（D9 / CTL-09）。
 * 生产硬门槛 `verifyAttestationClaims` 不在本文件、也不得被本通道改写。
 */
import { MdopError, type MdopEdgeRef } from "../errors";
import type { AttestationPolicy } from "../label/lattice";
import { sm3Hex } from "../crypto/sm3";
import {
  compareTcb,
  reportDataBinding,
  type AttestationCheckInput,
  type AttestationProvider,
  type AttestationReport,
  type AttestationVerifier,
  type TeeKind,
  type TrustedRoot,
} from "./provider";
import { evaluateKeyRelease, type ReleaseInput, type ReleaseDecision } from "./release";

export const SOFTWARE_ATTESTATION_TEST_KIT_PRODUCTION_FORBIDDEN =
  "createSoftwareAttestationTestKit 不可在生产环境构造：测试通道只演练接口与管线，不构成 C2 可用性证据。软件实现无隔离、无远程证明，不得作为 C2 目标（D9 / CTL-09）。";

export function isProductionNodeEnv(env: string | undefined = process.env.NODE_ENV): boolean {
  return (env ?? "").trim().toLowerCase() === "production";
}

/** 软件测试通道只许开发/测试。生产构造即失败。 */
export function assertSoftwareAttestationTestKitAllowed(
  env: string | undefined = process.env.NODE_ENV,
): void {
  if (isProductionNodeEnv(env)) {
    throw new Error(SOFTWARE_ATTESTATION_TEST_KIT_PRODUCTION_FORBIDDEN);
  }
}

export interface SoftwareAttestationTestKitOptions {
  measurement: string;
  kind?: TeeKind;
  tcb?: string;
  node?: string;
  ttlMs?: number;
  now?: () => Date;
  ephemeralPublicKey?: string;
  quote?: string;
  /** 覆盖 `NODE_ENV` 判据（负例自检用）。 */
  env?: string;
}

export interface SoftwareAttestationTestKit {
  provider: AttestationProvider;
  verifyAttestationForC2InTestMode(input: AttestationCheckInput): void;
  createVerifier(roots: readonly TrustedRoot[]): AttestationVerifier;
  evaluateKeyRelease(input: Omit<ReleaseInput, "verify">): ReleaseDecision;
}

class SoftwareAttestationTestProvider implements AttestationProvider {
  readonly providerKind = "software" as const;

  constructor(private readonly opts: SoftwareAttestationTestKitOptions) {
    assertSoftwareAttestationTestKitAllowed(opts.env);
  }

  async prove(): Promise<AttestationReport> {
    const now = (this.opts.now ?? (() => new Date()))();
    const ttl = this.opts.ttlMs ?? 10 * 60_000;
    const ephemeral = this.opts.ephemeralPublicKey ?? `04${"d".repeat(128)}`;
    const quote = this.opts.quote ?? `software-test-quote:${this.opts.measurement}`;
    return {
      kind: this.opts.kind ?? "tdx",
      level: "software",
      isolation: "none",
      measurement: this.opts.measurement,
      quote_digest: `sm3:${sm3Hex(quote)}`,
      tcb: this.opts.tcb ?? "3.1.2",
      ephemeral_public_key: ephemeral,
      report_data: reportDataBinding(ephemeral),
      node: this.opts.node ?? "urn:tds:space:participant:tee-test",
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttl).toISOString(),
    };
  }
}

/**
 * 与生产 `createAttestationVerifier` 同形状：验 quote_digest 对信任根。
 * 唯独不要求 `level === "hardware"`（测试替身）。生产调用即抛。
 */
export function createSoftwareAttestationTestVerifier(
  roots: readonly TrustedRoot[],
  env: string | undefined = process.env.NODE_ENV,
): AttestationVerifier {
  assertSoftwareAttestationTestKitAllowed(env);
  return {
    verify(report: AttestationReport): boolean {
      if (!report.kind || !report.quote_digest) return false;
      const root = roots.find((r) => r.kind === report.kind);
      if (!root) return false;
      return root.verifyQuoteDigest(report.quote_digest, report);
    },
  };
}

function tcbThresholdFor(policy: AttestationPolicy, kind: TeeKind | null): string | undefined {
  const min = policy.min_tcb;
  if (min === undefined) return undefined;
  if (typeof min === "string") return min;
  if (!kind) return undefined;
  return min[kind];
}

function assertEphemeralBoundToReportData(
  ephemeralPublicKey: string,
  reportData: string | null | undefined,
  where: MdopEdgeRef = {},
): void {
  if (!reportData) {
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      where,
      "证明缺 report_data（一次性公钥未绑定进硬件签名，不得产生半份证明）",
    );
  }
  let expected: string;
  try {
    expected = reportDataBinding(ephemeralPublicKey);
  } catch {
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      where,
      "一次性公钥未绑定进 report_data，不得产生半份证明",
    );
  }
  if (reportData !== expected) {
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      where,
      "一次性公钥未绑定进 report_data，不得产生半份证明",
    );
  }
}

/**
 * 与 `verifyAttestationClaims` + 节点绑定 + 信任根验签同一套判据，
 * 唯独把「硬件来源」这一步换成测试替身（level/isolation 显式放行）。
 * 生产判据下调用即抛。不得改写 `verifyAttestationClaims`。
 */
export function verifyAttestationForC2InTestMode(input: AttestationCheckInput): void {
  assertSoftwareAttestationTestKitAllowed();
  const { report, policy, verifier, node, where = {}, now = new Date() } = input;

  // 硬件来源：测试替身——显式放行 level/isolation，链型仍按合约清单。
  if (!report.kind || !policy.tee.includes(report.kind)) {
    throw new MdopError("E_CAPABILITY_MISMATCH", where, "C2 目标的证明链型不在合约允许范围内");
  }

  if (!report.ephemeral_public_key) {
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      where,
      "证明报告未包含一次性公钥——数据密钥无处可释，不得当作 C2 证明",
    );
  }
  assertEphemeralBoundToReportData(report.ephemeral_public_key, report.report_data, where);

  const issued = Date.parse(report.issued_at);
  const expires = Date.parse(report.expires_at);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) {
    throw new MdopError("E_ATTESTATION_FAILED", where, "证明的时间字段非法");
  }
  if (expires <= now.getTime()) {
    throw new MdopError("E_ATTESTATION_FAILED", where, "证明已过期，必须重新证明");
  }

  if (policy.allowed_measurements && !policy.allowed_measurements.includes(report.measurement)) {
    throw new MdopError("E_MEASUREMENT_NOT_ALLOWED", where, "执行环境度量不在允许范围内");
  }

  const threshold = tcbThresholdFor(policy, report.kind);
  if (threshold !== undefined) {
    if (!report.tcb) {
      throw new MdopError("E_TCB_TOO_OLD", where, "证明未给出可信基版本，无法满足下限要求");
    }
    const cmp = compareTcb(report.tcb, threshold);
    if (cmp === null) {
      throw new MdopError(
        "E_TCB_TOO_OLD",
        where,
        "可信基版本无法与该链的下限比较（不同链的版本体系不可互比，请按链给出阈值）",
      );
    }
    if (cmp < 0) throw new MdopError("E_TCB_TOO_OLD", where, "执行环境可信基版本低于要求");
  }

  if (node !== undefined && report.node !== node) {
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      where,
      "证明未绑定到本节点身份（不得用别处的证明顶替本节点）",
    );
  }
  if (!verifier.verify(report)) {
    throw new MdopError("E_ATTESTATION_FAILED", where, "执行环境证明未通过校验");
  }
}

export function createSoftwareAttestationTestKit(
  opts: SoftwareAttestationTestKitOptions,
): SoftwareAttestationTestKit {
  assertSoftwareAttestationTestKitAllowed(opts.env);
  const provider = new SoftwareAttestationTestProvider(opts);
  return {
    provider,
    verifyAttestationForC2InTestMode,
    createVerifier: (roots) => createSoftwareAttestationTestVerifier(roots, opts.env),
    evaluateKeyRelease(input) {
      return evaluateKeyRelease({
        ...input,
        verify: verifyAttestationForC2InTestMode,
      });
    },
  };
}
