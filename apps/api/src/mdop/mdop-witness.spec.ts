import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  LocalDevKms,
  MdopError,
  createAttestationVerifier,
  generateSm2KeyPair,
  mapVendorQuote,
  reportDataBinding,
  parseParticipantUrn,
  participantUrn,
  publicKeyFromPrivateKey,
  signEnvelope,
  sm2Sign,
  type AttestationPolicy,
  type Envelope,
  type KeyReleaseRequest,
  type SessionWitness,
  type UnsignedEnvelope,
} from "@medtrust/mdop";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { CaService } from "../runtime/participant-identity/ca.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopContractService } from "../runtime/digital-contract/mdop-contract.service";
import { MdopMessagesController } from "./mdop-messages.controller";
import { MdopOutboxService } from "./mdop-outbox.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { MdopReceiptChainService } from "./mdop-receipt-chain.service";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopSchedulerService } from "./mdop-scheduler.service";
import { MdopTicketService } from "./mdop-ticket.service";
import { MdopAttestationService } from "./mdop-attestation.service";

/**
 * 节点上报**会话见证**（任务 6.7 / D13）：平台验签 + 存本体 + 转发给持有方。
 *
 * 这条用例要证明的不是「平台验过 quote」（那需要厂商证明根，平台没有），而是：
 * ① 凭据验签只认**部署配置里的 KMS 公钥**；② 本体（报告 + 凭据）**落库**，持有方拿得到可验对象；
 * ③ 同一份见证**逐会话一行的历史**（不是按 quote 去重写覆盖）；④ 平台把见证**转发**给持有方。
 */

const NODE = participantUrn("sh-med", "tee-1");
const HOSP = participantUrn("sh-med", "p-huashan");
const PLATFORM = participantUrn("sh-med", "platform");
const CONTRACT = "ctr-c2";
const JOB = "job-c2";
/** 用**当前时间**（凭据与证明都有短有效期；写死一个过去的时间点会被有效期判据拒掉）。 */
const NOW = new Date();
const MEAS = "sm3:" + "a".repeat(64);
const POLICY: AttestationPolicy = { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } };

describe("会话见证的登记与转发（任务 6.7 / D13）", () => {
  let gm: GMCryptoService;
  let controller: MdopMessagesController;
  let attestationRepo: ReturnType<typeof mockRepo>;
  let outboxRepo: ReturnType<typeof mockRepo>;
  let jobRepo: ReturnType<typeof mockRepo>;
  let certsRepo: ReturnType<typeof mockRepo>;
  let contractsRepo: ReturnType<typeof mockRepo>;
  let attestations: MdopAttestationService;
  let nodeKeys: { publicKey: string; privateKey: string };
  const KMS_KEY = generateSm2KeyPair();
  const EPH = generateSm2KeyPair();

  const unsigned = (
    over: Partial<UnsignedEnvelope> = {},
  ): UnsignedEnvelope => ({
    mdop: "0.2",
    msg_id: `msg-${Math.random().toString(36).slice(2)}`,
    msg_type: "AttestationReport",
    job_id: JOB,
    sender: NODE,
    receiver: PLATFORM,
    timestamp: new Date().toISOString(),
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    idempotency_key: `witness:${JOB}:${NODE}`,
    body: {},
    ...over,
  });

  /** 一份真凭据：硬件替身出证明 → 演练 KMS 按判据释放。 */
  async function makeWitness(
    over: { quote?: string; kmsPublicKey?: string } = {},
  ) {
    const report = mapVendorQuote({
      vendor: "tdx",
      measurement: MEAS,
      tcb: "3.1.2",
      quote: over.quote ?? "dGR4LXF1b3Rl",
      signed_at: new Date(NOW.getTime() - 30_000).toISOString(),
      valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
      ephemeral_public_key: EPH.publicKey,
      report_data: reportDataBinding(EPH.publicKey),
      node: NODE,
    });
    const kms = new LocalDevKms({
      privateKey: KMS_KEY.privateKey,
      verifier: createAttestationVerifier([
        { kind: "tdx", verifyQuoteDigest: (d) => d === report.quote_digest },
      ]),
      keys: new Map([["k-1", new Uint8Array(32).fill(9)]]),
      now: () => NOW,
    });
    kms.registerKey({
      keyId: "k-1",
      dek: new Uint8Array(32).fill(9),
      owner: { job_id: JOB, contract_id: CONTRACT },
    });
    const req: KeyReleaseRequest = {
      key_id: "k-1",
      key_owner: { job_id: JOB, contract_id: CONTRACT },
      context: { job_id: JOB, credential_id: "tkt-1", contract_id: CONTRACT },
      report,
      policy: POLICY,
      credential_valid: true,
      contract_active: true,
      now: NOW,
    };
    const warrant = await kms.requestRelease(req);
    const witness: SessionWitness = {
      job_id: JOB,
      credential_id: "tkt-1",
      contract_id: CONTRACT,
      key_id: "k-1",
      node: NODE,
      report,
      warrant,
    };
    return { witness, kms, report };
  }

  beforeEach(async () => {
    process.env.SPACE_ID = "sh-med";
    process.env.MDOP_KMS_PUBKEY = publicKeyFromPrivateKey(KMS_KEY.privateKey);
    // 部署配置：谁算可信校验方（KMS 标识）与注册中心认可的度量白名单
    process.env.MDOP_ATTESTATION_VERIFIERS = "kms://local-dev";
    process.env.MDOP_ATTESTATION_MEASUREMENTS = MEAS;
    gm = new GMCryptoService();
    const ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    await ca.onModuleInit();
    attestationRepo = mockRepo();
    outboxRepo = mockRepo();
    jobRepo = mockRepo();
    certsRepo = mockRepo();
    contractsRepo = mockRepo();
    const stageRepo = mockRepo();

    const outbox = new MdopOutboxService(gm, ca, outboxRepo, mockRepo());
    const contracts = new MdopContractService(
      gm,
      ca,
      contractsRepo,
      certsRepo,
      outboxRepo,
      "sh-med",
    );
    const purge = new MdopPurgeService(
      jobRepo,
      mockRepo(),
      outboxRepo,
      mockRepo(),
    );
    const tickets = new MdopTicketService(
      gm,
      ca,
      jobRepo,
      mockRepo(),
      stageRepo,
      mockRepo(),
      mockRepo(),
      outboxRepo,
      certsRepo,
    );
    attestations = new MdopAttestationService(attestationRepo);
    controller = new MdopMessagesController(
      outbox,
      contracts,
      purge,
      attestations,
      new MdopReceiptChainService(mockRepo(), jobRepo),
      new MdopMergeService(jobRepo, mockRepo(), mockRepo(), stageRepo, purge),
      tickets,
      new MdopSchedulerService(jobRepo, stageRepo, outboxRepo, tickets, purge),
      certsRepo as never,
      mockRepo() as never,
      mockRepo() as never,
      jobRepo as never,
      mockRepo() as never, // 片段（C2 中继的目标校验）
    );

    nodeKeys = gm.generateSM2KeyPair();
    await certsRepo.save(
      certsRepo.create({
        sm2Fingerprint: "SM2:NODE",
        participantId: parseParticipantUrn(NODE)!.id,
        connectorId: "tee-1",
        spaceId: "sh-med",
        subjectPublicKey: nodeKeys.publicKey,
        validUntil: new Date("2027-09-24T00:00:00.000Z"),
        revoked: false,
      }),
    );
    // 作业 + 合约：见证必须落在作业的合约列表里，且合约要声明证明策略
    await jobRepo.save(
      jobRepo.create({ id: JOB, contracts: [CONTRACT], status: "RUNNING" }),
    );
    // 合约：走真实的要约 + 持有方签署路径（条款里的 `attestation_policy` 由要约选项声明）
    const providerKeys = gm.generateSM2KeyPair();
    await certsRepo.save(
      certsRepo.create({
        sm2Fingerprint: "SM2:HOSP",
        participantId: "p-huashan",
        connectorId: "c-huashan",
        spaceId: "sh-med",
        subjectPublicKey: providerKeys.publicKey,
        validUntil: new Date("2027-09-24T00:00:00.000Z"),
        revoked: false,
      }),
    );
    await contractsRepo.save(
      contractsRepo.create({
        id: CONTRACT,
        dataProductId: "dp-1",
        providerId: "p-huashan",
        consumerId: "p-meddata",
        purpose: "RWS.EFFECTIVENESS",
        retention: "阅后即焚",
        output: "仅聚合统计",
        outputPolicy: { preset: "aggregate-only", minCell: 10 },
        validUntil: "2027-09-24T00:00:00.000Z",
        status: "active",
        pinnedModules: {},
        createdAt: new Date("2026-09-24T00:00:00.000Z"),
        mdopStatus: "unsigned",
      }),
    );
    const offer = await contracts.offer(CONTRACT, {
      attestationPolicy: { tee: ["tdx"], minTcb: { tdx: "3.1.0" } },
      extraRecipients: [{ party: HOSP, role: "final", jurisdiction: "CN" }],
    });
    await contracts.agree({
      contractId: CONTRACT,
      canonical: offer.canonical,
      holderSignature: sm2Sign(offer.canonical, providerKeys.privateKey, {
        publicKey: providerKeys.publicKey,
      }),
    });
  });

  afterEach(() => {
    delete process.env.SPACE_ID;
    delete process.env.MDOP_KMS_PUBKEY;
    delete process.env.MDOP_ATTESTATION_VERIFIERS;
    delete process.env.MDOP_ATTESTATION_MEASUREMENTS;
  });

  it("完整见证 → 登记本体并转发给持有方（平台不代替持有方下结论）", async () => {
    const { witness } = await makeWitness();
    const envelope = signEnvelope(
      unsigned({ body: { witness } }),
      nodeKeys.privateKey,
      {
        publicKey: nodeKeys.publicKey,
      },
    );
    const out = await controller.messages({ envelope });
    expect(out).toMatchObject({
      accepted: true,
      msg_type: "AttestationReport",
      node: NODE,
      forwarded: 1,
    });

    // 本体落库（持有方据此独立核验，而不是信平台的结论）
    const row = await attestationRepo.findOne({ where: { node: NODE } });
    expect(row.warrant.warrant_digest).toBe(witness.warrant.warrant_digest);
    expect(row.report.measurement).toBe(MEAS);
    expect(row.verifiedBy).toBe(witness.warrant.kms);

    // 转发：一条 AttestationWitness 发给持有方（平台自己与上报节点除外）
    const queued = await outboxRepo.find();
    const forwarded = queued.filter(
      (r: { msg_type: string }) => r.msg_type === "AttestationWitness",
    );
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].receiver).toBe(HOSP);
    expect(forwarded[0].body.witness.warrant.warrant_digest).toBe(
      witness.warrant.warrant_digest,
    );
  });

  it("逐会话一行历史：同一份证明的第二次会话不被覆盖，且转发幂等", async () => {
    const first = await makeWitness();
    const env1 = signEnvelope(
      unsigned({ body: { witness: first.witness } }),
      nodeKeys.privateKey,
      {
        publicKey: nodeKeys.publicKey,
      },
    );
    await controller.messages({ envelope: env1 });

    // 第二次会话：同一段代码（quote 相同）、新的一次性公钥 → 新的凭据
    const eph2 = generateSm2KeyPair();
    const report2 = {
      ...first.report,
      ephemeral_public_key: eph2.publicKey,
      report_data: reportDataBinding(eph2.publicKey),
    };
    const kms2 = new LocalDevKms({
      privateKey: KMS_KEY.privateKey,
      verifier: createAttestationVerifier([
        { kind: "tdx", verifyQuoteDigest: () => true },
      ]),
      keys: new Map([["k-1", new Uint8Array(32).fill(9)]]),
      now: () => NOW,
    });
    kms2.registerKey({
      keyId: "k-1",
      dek: new Uint8Array(32).fill(9),
      owner: { job_id: JOB, contract_id: CONTRACT },
    });
    const warrant2 = await kms2.requestRelease({
      key_id: "k-1",
      key_owner: { job_id: JOB, contract_id: CONTRACT },
      context: { job_id: JOB, credential_id: "tkt-1", contract_id: CONTRACT },
      report: report2,
      policy: POLICY,
      credential_valid: true,
      contract_active: true,
      now: NOW,
    });
    const env2 = signEnvelope(
      unsigned({
        body: {
          witness: { ...first.witness, report: report2, warrant: warrant2 },
        },
      }),
      nodeKeys.privateKey,
      { publicKey: nodeKeys.publicKey },
    );
    await controller.messages({ envelope: env2 });

    const rows = await attestationRepo.find({ where: { node: NODE } });
    expect(rows).toHaveLength(2); // 一次会话一条，历史保留
    expect(
      new Set(rows.map((r: { warrantDigest: string }) => r.warrantDigest)).size,
    ).toBe(2);

    // 重发同一份见证（新信封、新 nonce，同一 idempotency_key）不会再多一行、多一条转发
    const resend = signEnvelope(
      unsigned({
        body: {
          witness: { ...first.witness, report: report2, warrant: warrant2 },
        },
      }),
      nodeKeys.privateKey,
      { publicKey: nodeKeys.publicKey },
    );
    const before = (await outboxRepo.find()).length;
    await controller.messages({ envelope: resend });
    expect(await attestationRepo.find({ where: { node: NODE } })).toHaveLength(
      2,
    );
    expect((await outboxRepo.find()).length).toBe(before);
  });

  it("KMS 公钥不对（别的 KMS 签的凭据）→ 拒，且不落库、不转发", async () => {
    const other = generateSm2KeyPair();
    const { witness } = await makeWitness();
    process.env.MDOP_KMS_PUBKEY = publicKeyFromPrivateKey(other.privateKey);
    const envelope = signEnvelope(
      unsigned({ body: { witness } }),
      nodeKeys.privateKey,
      {
        publicKey: nodeKeys.publicKey,
      },
    );
    await expect(controller.messages({ envelope })).rejects.toThrow(MdopError);
    expect(await attestationRepo.find()).toHaveLength(0);
    expect(
      (await outboxRepo.find()).filter(
        (r: { msg_type: string }) => r.msg_type === "AttestationWitness",
      ),
    ).toHaveLength(0);
  });

  it("见证声明的节点 ≠ 信封发送方 / 作业不符 / 未登记证书 → 拒（先认证再验签）", async () => {
    const { witness } = await makeWitness();
    // ① 用**别的**节点身份发（信封签名是它的，但见证声称是 tee-1）
    const otherKeys = gm.generateSM2KeyPair();
    await certsRepo.save(
      certsRepo.create({
        sm2Fingerprint: "SM2:OTHER",
        participantId: "tee-2",
        connectorId: "tee-2",
        spaceId: "sh-med",
        subjectPublicKey: otherKeys.publicKey,
        validUntil: new Date("2027-09-24T00:00:00.000Z"),
        revoked: false,
      }),
    );
    const spoof = signEnvelope(
      unsigned({
        sender: participantUrn("sh-med", "tee-2"),
        body: { witness },
      }),
      otherKeys.privateKey,
      { publicKey: otherKeys.publicKey },
    );
    await expect(controller.messages({ envelope: spoof })).rejects.toThrow(
      BadRequestException,
    );

    // ② 信封 job_id 与见证不符
    const mismatch = signEnvelope(
      unsigned({ job_id: "job-other", body: { witness } }),
      nodeKeys.privateKey,
      { publicKey: nodeKeys.publicKey },
    );
    await expect(controller.messages({ envelope: mismatch })).rejects.toThrow(
      BadRequestException,
    );

    // ③ 未登记证书的发送方
    const strangerKeys = gm.generateSM2KeyPair();
    const stranger = signEnvelope(
      unsigned({
        sender: participantUrn("sh-med", "tee-9"),
        body: { witness },
      }),
      strangerKeys.privateKey,
      { publicKey: strangerKeys.publicKey },
    );
    await expect(controller.messages({ envelope: stranger })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("未配置 KMS 公钥 → 拒（不得在没有验签凭据的情况下登记见证）", async () => {
    const { witness } = await makeWitness();
    delete process.env.MDOP_KMS_PUBKEY;
    const envelope = signEnvelope(
      unsigned({ body: { witness } }),
      nodeKeys.privateKey,
      {
        publicKey: nodeKeys.publicKey,
      },
    );
    await expect(controller.messages({ envelope })).rejects.toThrow(
      /未配置 KMS 公钥/,
    );
  });
});
