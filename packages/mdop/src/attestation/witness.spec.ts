import { generateSm2KeyPair, publicKeyFromPrivateKey } from "../crypto/sm2";
import type { AttestationPolicy } from "../label/lattice";
import { LocalDevKms, type KeyReleaseRequest } from "./kms";
import { createAttestationVerifier, mapVendorQuote, reportDataBinding, type AttestationReport, type TrustedRoot } from "./provider";
import { parseSessionWitness, verifySessionWitness, type SessionWitness } from "./witness";

const NOW = new Date("2026-09-25T10:00:00.000Z");
const NODE = "urn:tds:sh-med:participant:tee-1";
const MEAS = "sm3:" + "a".repeat(64);
const EPH = generateSm2KeyPair();
const KMS_KEY = generateSm2KeyPair();

function report(over: Partial<AttestationReport> = {}): AttestationReport {
  return {
    ...mapVendorQuote({
      vendor: "tdx",
      measurement: MEAS,
      tcb: "3.1.2",
      quote: "dGR4LXF1b3Rl",
      signed_at: new Date(NOW.getTime() - 30_000).toISOString(),
      valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
      ephemeral_public_key: EPH.publicKey,
      report_data: reportDataBinding(EPH.publicKey),
      node: NODE,
    }),
    ...over,
  };
}

const POLICY: AttestationPolicy = {
  tee: ["tdx"],
  min_tcb: { tdx: "3.1.0" },
  allowed_measurements: [MEAS],
};
const KMS_PUB = publicKeyFromPrivateKey(KMS_KEY.privateKey);

async function witness(over: Partial<SessionWitness> = {}): Promise<SessionWitness> {
  const rep = over.report ?? report();
  const root: TrustedRoot = { kind: rep.kind!, verifyQuoteDigest: (d) => d === rep.quote_digest };
  const kms = new LocalDevKms({
    privateKey: KMS_KEY.privateKey,
    verifier: createAttestationVerifier([root]),
    keys: new Map([["k-1", Uint8Array.from({ length: 32 }, (_, i) => i + 1)]]),
    now: () => NOW,
  });
  kms.registerKey({ keyId: "k-1", dek: new Uint8Array(32).fill(7), owner: { job_id: "job-1", contract_id: "ctr-1" } });
  const req: KeyReleaseRequest = {
    key_id: "k-1",
    key_owner: { job_id: "job-1", contract_id: "ctr-1" },
    context: { job_id: "job-1", credential_id: "tkt-1", contract_id: "ctr-1" },
    report: rep,
    policy: POLICY,
    credential_valid: true,
    contract_active: true,
    now: NOW,
  };
  const warrant = await kms.requestRelease(req);
  return {
    job_id: "job-1",
    credential_id: "tkt-1",
    contract_id: "ctr-1",
    key_id: "k-1",
    node: NODE,
    report: rep,
    warrant,
    ...over,
  };
}

describe("会话见证：把释放凭据送到持有方，让它自己验（任务 6.7 / D13）", () => {
  it("完整见证 → 通过；返回的会话凭据与节点侧同形", async () => {
    const w = await witness();
    const { session } = verifySessionWitness({ witness: w, kmsPublicKey: KMS_PUB, policy: POLICY, now: NOW });
    expect(session.signature_valid).toBe(true);
    expect(session.quote_digest).toBe(w.report.quote_digest);
    expect(session.measurement).toBe(MEAS);

    // 给了凭证里的期望：同链型同度量即通过
    expect(() =>
      verifySessionWitness({
        witness: w,
        kmsPublicKey: KMS_PUB,
        policy: POLICY,
        expectation: { tee: "tdx", measurement: MEAS, min_tcb: "3.1.0" },
        now: NOW,
      }),
    ).not.toThrow();
  });

  it("严格解析：未知字段 / 缺字段 / 非法链型 / 非法 kid → 拒（跨网络输入不得宽松）", async () => {
    const w = await witness();
    expect(() => parseSessionWitness({ ...w, extra: 1 })).toThrow(/未定义字段/);
    expect(() => parseSessionWitness({ ...w, node: undefined })).toThrow(/缺少必填字段/);
    expect(() =>
      parseSessionWitness({ ...w, report: { ...w.report, kind: "sgx" } }),
    ).toThrow(/未定义的证明链型/);
    expect(() =>
      parseSessionWitness({ ...w, warrant: { ...w.warrant, sig: { ...w.warrant.sig, kid: "short" } } }),
    ).toThrow(/kid/);
    expect(() =>
      parseSessionWitness({ ...w, warrant: { ...w.warrant, wrapped_key_encoding: "hex", wrapped_key: "zz" } }),
    ).toThrow(/编码不符/);
  });

  it("证明里绑定的节点与见证声明的节点不一致 → 拒（防张冠李戴）", async () => {
    const w = await witness();
    expect(() =>
      parseSessionWitness({ ...w, node: "urn:tds:sh-med:participant:tee-2" }),
    ).toThrow(/不一致/);
  });

  it("换 KMS 公钥 / 换作业上下文 / 过期 → 逐条拒（部署配置才是信任来源）", async () => {
    const w = await witness();
    // ① 别的 KMS 公钥核不过
    expect(() =>
      verifySessionWitness({
        witness: w,
        kmsPublicKey: publicKeyFromPrivateKey(generateSm2KeyPair().privateKey),
        policy: POLICY,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));

    // ② 凭据被挪到别的作业（上下文不符 → 摘要重算不一致）
    expect(() =>
      verifySessionWitness({
        witness: { ...w, job_id: "job-2" },
        kmsPublicKey: KMS_PUB,
        policy: POLICY,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));

    // ③ 证明过期（凭据还没过期）→ 由证明声明的有效期拦下
    expect(() =>
      verifySessionWitness({
        witness: w,
        kmsPublicKey: KMS_PUB,
        policy: POLICY,
        // 证明 5 分钟、凭据 10 分钟：取 400 秒，证明先过期
        now: new Date(NOW.getTime() + 400_000),
      }),
    ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));

    // ④ 凭据过期 → 由释放凭据的有效期拦下（两条有效期都在，谁先过谁先拦）
    expect(() =>
      verifySessionWitness({
        witness: w,
        kmsPublicKey: KMS_PUB,
        policy: POLICY,
        now: new Date(NOW.getTime() + 3_600_000),
      }),
    ).toThrow(expect.objectContaining({ code: "E_KEY_RELEASE_DENIED" }));
  });

  it("软件级证明 / 度量不在白名单 / TCB 过旧 → 拒（哪怕 KMS 签名有效）", async () => {
    // 软件级：直接拿一份 level=software 的报告（KMS 也签不出这种凭据，这里直接造）
    const w = await witness();
    const software = {
      ...w,
      report: { ...w.report, level: "software" as const, isolation: "none" as const },
    };
    expect(() =>
      verifySessionWitness({ witness: software, kmsPublicKey: KMS_PUB, policy: POLICY, now: NOW }),
    ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));

    // 度量不在白名单
    expect(() =>
      verifySessionWitness({
        witness: w,
        kmsPublicKey: KMS_PUB,
        policy: { ...POLICY, allowed_measurements: ["sm3:" + "b".repeat(64)] },
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_MEASUREMENT_NOT_ALLOWED" }));

    // TCB 下限抬高
    expect(() =>
      verifySessionWitness({
        witness: w,
        kmsPublicKey: KMS_PUB,
        policy: { ...POLICY, min_tcb: { tdx: "9.9.9" } },
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_TCB_TOO_OLD" }));
  });

  it("与凭证冻结的期望不符（换了代码/换了链型）→ 拒", async () => {
    const w = await witness();
    expect(() =>
      verifySessionWitness({
        witness: w,
        kmsPublicKey: KMS_PUB,
        policy: POLICY,
        expectation: { tee: "tdx", measurement: "sm3:" + "c".repeat(64), min_tcb: "3.1.0" },
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_MEASUREMENT_NOT_ALLOWED" }));
  });
});
