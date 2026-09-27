import { generateSm2KeyPair, publicKeyFromPrivateKey } from "../crypto/sm2";
import { MdopError } from "../errors";
import {
  LocalDevKms,
  ephemeralKeyDigest,
  verifyReleaseWarrant,
  type KeyReleaseRequest,
} from "./kms";
import {
  createAttestationVerifier,
  mapVendorQuote,
  reportDataBinding,
  type AttestationReport,
  type TrustedRoot,
  type VendorQuote,
} from "./provider";

const NOW = new Date("2026-09-25T10:00:00.000Z");

/** 节点的证明代理在飞地内生成的一次性密钥对（私钥只留在节点实例内存里）。 */
const EPH = generateSm2KeyPair();
const KMS = generateSm2KeyPair();
const NODE = "urn:tds:sh-med:participant:tee-1";
const MEAS = "sm3:" + "a".repeat(64);

function quote(over: Partial<VendorQuote> = {}): VendorQuote {
  const merged = {
    vendor: "tdx" as const,
    measurement: MEAS,
    tcb: "3.1.2",
    quote: "dGR4LXF1b3Rl",
    signed_at: new Date(NOW.getTime() - 30_000).toISOString(),
    valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
    ephemeral_public_key: EPH.publicKey,
    node: NODE,
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
  return { kind: report.kind!, verifyQuoteDigest: (d) => d === report.quote_digest };
}

/** 一台「什么都对」的演练 KMS：密钥表、信任根、KMS 私钥都齐。 */
function kmsWith(input: { dek?: Uint8Array; report?: AttestationReport } = {}) {
  const report = input.report ?? mapVendorQuote(quote());
  const dek = input.dek ?? Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const kms = new LocalDevKms({
    privateKey: KMS.privateKey,
    verifier: createAttestationVerifier([rootFor(report)]),
    keys: new Map([[`k-1`, dek]]),
    now: () => NOW,
  });
  kms.registerKey({ keyId: "k-1", dek, owner: { job_id: "job-1", contract_id: "ctr-1" } });
  return { kms, report, dek };
}

function request(over: Partial<KeyReleaseRequest> = {}): KeyReleaseRequest {
  const { report } = kmsWith();
  return {
    key_id: "k-1",
    key_owner: { job_id: "job-1", contract_id: "ctr-1" },
    context: { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1" },
    report,
    // 生效度量清单 = 注册中心白名单（调用方用 `resolveMeasurementWhitelist` 算好）
    policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" }, allowed_measurements: [MEAS] },
    credential_valid: true,
    contract_active: true,
    now: NOW,
    ...over,
  };
}

describe("数据密钥释放的 KMS 接缝（attestation-provider / D-TEE-1）", () => {
  it("证明合规 → 释放：密钥封给本次证明的一次性公钥，凭据可离线核对", async () => {
    const { kms, report, dek } = kmsWith();
    const warrant = await kms.requestRelease(request({ report }));

    expect(warrant.key_id).toBe("k-1");
    expect(warrant.ephemeral_key_digest).toBe(ephemeralKeyDigest(EPH.publicKey));
    // 只有持有对应一次性私钥的节点实例能解开
    expect(Buffer.from(kms.unwrapKey(warrant, EPH.privateKey)).equals(Buffer.from(dek))).toBe(true);
    let leaked = false;
    try {
      leaked = Buffer.from(kms.unwrapKey(warrant, generateSm2KeyPair().privateKey)).equals(
        Buffer.from(dek),
      );
    } catch {
      leaked = false;
    }
    expect(leaked).toBe(false);

    // 凭据 → 会话凭据（`verifyC2Execution` 的输入）
    const session = verifyReleaseWarrant({
      warrant,
      kmsPublicKey: publicKeyFromPrivateKey(KMS.privateKey),
      report,
      context: { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1", key_id: "k-1" },
      now: NOW,
    });
    expect(session.signature_valid).toBe(true);
    expect(session.quote_digest).toBe(report.quote_digest);
    expect(session.measurement).toBe(MEAS);
  });

  it("引用的密钥不在 KMS 里 → 拒绝（不得凭空释放）", async () => {
    const { kms, report } = kmsWith();
    await expect(kms.requestRelease(request({ report, key_id: "k-404" }))).rejects.toThrow(
      expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }),
    );
  });

  it("请求方自报的密钥归属不算数：以 KMS 登记为准", async () => {
    const { kms, report } = kmsWith();
    // 谎称这把密钥属于别的作业，KMS 仍按**自己的登记**判定，因此照旧释放给本作业
    const warrant = await kms.requestRelease(
      request({ report, key_owner: { job_id: "job-2", contract_id: "ctr-2" } }),
    );
    expect(warrant.key_id).toBe("k-1");
  });

  describe("负例逐条：断言拒绝且不回退", () => {
    const cases: Array<[string, Partial<KeyReleaseRequest>, string]> = [
      [
        "伪造证明（信任根不覆盖该 quote）",
        { report: mapVendorQuote(quote({ quote: "ZmFrZS1xdW90ZQ==" })) },
        "E_ATTESTATION_FAILED",
      ],
      [
        "度量换版",
        { report: mapVendorQuote(quote({ measurement: "sm3:" + "b".repeat(64) })) },
        "E_MEASUREMENT_NOT_ALLOWED",
      ],
      ["TCB 过旧", { report: mapVendorQuote(quote({ tcb: "3.0.0" })) }, "E_TCB_TOO_OLD"],
      [
        "证明过期",
        {
          report: mapVendorQuote(
            quote({
              signed_at: new Date(NOW.getTime() - 600_000).toISOString(),
              valid_until: new Date(NOW.getTime() - 1_000).toISOString(),
            }),
          ),
        },
        "E_ATTESTATION_FAILED",
      ],
      ["凭证过期", { credential_valid: false }, "E_TICKET_INVALID"],
      ["合约已终止", { contract_active: false }, "E_KEY_RELEASE_DENIED"],
      [
        "key_id 串作业（用 B 作业的上下文取 A 作业的密钥）",
        { context: { job_id: "job-2", credential_id: "tkt-1", contract_id: "ctr-1" } },
        "E_KEY_RELEASE_DENIED",
      ],
    ];

    for (const [name, over, code] of cases) {
      it(`${name} → ${code}`, async () => {
        // 信任根按**备案的那份好证明**配置：伪造或过期的报告自然验不过（不得取自消息）
        const { kms } = kmsWith({ report: mapVendorQuote(quote()) });
        await expect(
          kms.requestRelease(request(over)),
        ).rejects.toThrow(expect.objectContaining({ code }));
      });
    }
  });

  it("释放凭据被换 KMS 公钥 / 被改 key_id / 被过期 → 一律拒（D13 的离线核对）", async () => {
    const { kms, report } = kmsWith();
    const warrant = await kms.requestRelease(request({ report }));
    const ctx = { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1", key_id: "k-1" };
    const base = { report, context: ctx, now: NOW };

    // ① 公钥来源必须是部署配置：拿别的公钥核不过
    expect(() =>
      verifyReleaseWarrant({
        ...base,
        warrant,
        kmsPublicKey: publicKeyFromPrivateKey(generateSm2KeyPair().privateKey),
      }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));

    // ② 换成别次会话的凭据（key_id 不同）
    expect(() =>
      verifyReleaseWarrant({
        ...base,
        warrant: { ...warrant, key_id: "k-2" },
        kmsPublicKey: publicKeyFromPrivateKey(KMS.privateKey),
      }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));

    // ③ 过期
    expect(() =>
      verifyReleaseWarrant({
        ...base,
        warrant,
        kmsPublicKey: publicKeyFromPrivateKey(KMS.privateKey),
        now: new Date(NOW.getTime() + 3_600_000),
      }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));
  });

  it("KMS 归属：凭据的 kms 必须与信封指定的保管方一致（签名只证明「配置内某个 KMS」）", async () => {
    const { kms, report } = kmsWith();
    const warrant = await kms.requestRelease(request({ report }));
    const ctx = { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1", key_id: "k-1" };
    const base = {
      report,
      context: ctx,
      warrant,
      kmsPublicKey: publicKeyFromPrivateKey(KMS.privateKey),
      now: NOW,
    };

    // 信封指定的正是这个 KMS → 通过
    expect(verifyReleaseWarrant({ ...base, expectedKms: kms.kmsRef }).digest).toBe(
      warrant.warrant_digest,
    );
    // 旧调用方不给期望值 → 行为不变（向后兼容）
    expect(verifyReleaseWarrant(base).digest).toBe(warrant.warrant_digest);
    // 信封指定的是别家 KMS（D-TEE-1 下各持有方可自建 KMS）→ 拒
    expect(() =>
      verifyReleaseWarrant({ ...base, expectedKms: "kms://holder-self-hosted" }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));
  });

  it("改写后的凭据即便数值自洽也验不过签名（改一处即断）", async () => {
    const { kms, report } = kmsWith();
    const warrant = await kms.requestRelease(request({ report }));
    const tampered = {
      ...warrant,
      ephemeral_key_digest: ephemeralKeyDigest(generateSm2KeyPair().publicKey),
    };
    expect(() =>
      verifyReleaseWarrant({
        warrant: tampered,
        kmsPublicKey: publicKeyFromPrivateKey(KMS.privateKey),
        report,
        context: { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1", key_id: "k-1" },
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));
  });

  it("错误码是 MdopError（可被出口侧统一映射，不是裸 Error）", async () => {
    const { kms } = kmsWith();
    const err = await kms
      .requestRelease(request({ contract_active: false }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MdopError);
  });
});
