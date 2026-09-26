import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  MdopError,
  participantUrn,
  signEnvelope,
  sm2Sign,
  sm3Hex,
  type Envelope,
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
 * C2 数据信封的**平台中继**（任务 3.14、design D15）。
 *
 * 平台是**转运方不是接收方**：数据密钥封给节点会话的一次性公钥，平台解不开。
 * 用例覆盖中继的六项可判定检查 + 转发目标（必须是本作业的片段节点）+ 幂等键。
 */

const NODE = participantUrn("sh-med", "tee-1");
const OTHER_NODE = participantUrn("sh-med", "tee-2");
const HOSP = participantUrn("sh-med", "p-huashan");
const PLATFORM = participantUrn("sh-med", "platform");
const CONTRACT = "ctr-relay";
const JOB = "job-relay";
const KEY_ID = "k-relay-1";

describe("C2 数据信封中继（任务 3.14 / D15）", () => {
  let gm: GMCryptoService;
  let controller: MdopMessagesController;
  let outboxRepo: ReturnType<typeof mockRepo>;
  let deliveryRepo: ReturnType<typeof mockRepo>;
  let jobRepo: ReturnType<typeof mockRepo>;
  let fragmentRepo: ReturnType<typeof mockRepo>;
  let certsRepo: ReturnType<typeof mockRepo>;
  let contractsRepo: ReturnType<typeof mockRepo>;
  let hospKeys: { publicKey: string; privateKey: string };
  let sealed: { ciphertext: string; iv: string; tag: string };
  let dataEnvelope: Record<string, unknown>;

  const unsigned = (
    over: Partial<UnsignedEnvelope> = {},
  ): UnsignedEnvelope => ({
    mdop: "0.2",
    msg_id: `msg-${Math.random().toString(36).slice(2)}`,
    msg_type: "ResultDeliver",
    job_id: JOB,
    sender: HOSP,
    receiver: PLATFORM,
    timestamp: new Date().toISOString(),
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    idempotency_key: `relay:${KEY_ID}`,
    body: {},
    ...over,
  });

  const signedByHolder = (over: Partial<UnsignedEnvelope> = {}): Envelope =>
    signEnvelope(unsigned(over), hospKeys.privateKey, {
      publicKey: hospKeys.publicKey,
    });

  beforeEach(async () => {
    process.env.SPACE_ID = "sh-med";
    gm = new GMCryptoService();
    const ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    await ca.onModuleInit();
    outboxRepo = mockRepo();
    deliveryRepo = mockRepo();
    jobRepo = mockRepo();
    fragmentRepo = mockRepo();
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
    controller = new MdopMessagesController(
      outbox,
      contracts,
      purge,
      new MdopAttestationService(mockRepo()),
      new MdopReceiptChainService(mockRepo(), jobRepo),
      new MdopMergeService(jobRepo, mockRepo(), mockRepo(), stageRepo, purge),
      tickets,
      new MdopSchedulerService(jobRepo, stageRepo, outboxRepo, tickets, purge),
      certsRepo as never,
      mockRepo() as never,
      deliveryRepo as never,
      jobRepo as never,
      fragmentRepo as never,
    );

    // 持有方登记证书
    hospKeys = gm.generateSM2KeyPair();
    await certsRepo.save(
      certsRepo.create({
        sm2Fingerprint: "SM2:HOSP",
        participantId: "p-huashan",
        connectorId: "c-huashan",
        spaceId: "sh-med",
        subjectPublicKey: hospKeys.publicKey,
        validUntil: new Date("2027-09-24T00:00:00.000Z"),
        revoked: false,
      }),
    );

    // 作业 + 片段（C2 目标节点必须在片段里）
    await jobRepo.save(
      jobRepo.create({ id: JOB, contracts: [CONTRACT], status: "RUNNING" }),
    );
    await fragmentRepo.save(
      fragmentRepo.create({ jobId: JOB, node: NODE, stages: [] }),
    );

    // 合约：声明证明策略（否则不得中继 C2）。提供方就是同一个持有方（一封证书，避免歧义）
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
      holderSignature: sm2Sign(offer.canonical, hospKeys.privateKey, {
        publicKey: hospKeys.publicKey,
      }),
    });

    // 一封结构合法的 C2 信封（密文任意，摘要按密文字节算）
    sealed = {
      ciphertext: Buffer.from("ciphertext-bytes").toString("base64"),
      iv: "a".repeat(24),
      tag: "b".repeat(32),
    };
    dataEnvelope = {
      envelope: "mdop.env/1.0",
      payload: {
        cipher: "AES-256-GCM",
        ciphertext_ref: `blob://sealed/${KEY_ID}`,
        digest: `sm3:${sm3Hex(Buffer.from(sealed.ciphertext, "base64"))}`,
      },
      wrapped_key: { kms: "kms://hospital", key_id: KEY_ID },
      policy: {
        contract: CONTRACT,
        purpose: ["RWS.EFFECTIVENESS"],
        allowed_ops: [`sm3:${"a".repeat(64)}`],
        attestation_policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
        export: "C3_only",
        not_after: new Date(Date.now() + 3_600_000).toISOString(),
      },
      watermark: "wm:site-a:sh-med:20260925",
      aad: { job_id: JOB, credential_id: "tkt-1", contract_id: CONTRACT },
      origin_sig: { signer: HOSP, alg: "SM2-SM3", value: "3045" },
    };
  });

  afterEach(() => {
    delete process.env.SPACE_ID;
  });

  const send = (over: Record<string, unknown> = {}) =>
    controller.relayEnvelope({
      envelope:
        (over.envelope as Envelope) ??
        signedByHolder({ body: { data_envelope: dataEnvelope } }),
      sealed: (over.sealed as typeof sealed) ?? sealed,
      target: (over.target as string) ?? NODE,
      ...over,
    } as never);

  it("合法信封 → 入发件箱给目标节点（幂等键含密钥与目标），并记一条 C2 审计行", async () => {
    const out = await send();
    expect(out).toMatchObject({ accepted: true, target: NODE });

    const queued = await outboxRepo.find();
    const relay = queued.find(
      (r: { msg_type: string }) => r.msg_type === "C2EnvelopeRelay",
    );
    expect(relay.receiver).toBe(NODE);
    expect(relay.idempotency_key).toBe(`relay:${KEY_ID}:${NODE}`);
    expect(relay.body.sealed.ciphertext).toBe(sealed.ciphertext);
    expect(relay.body.data_envelope.wrapped_key.key_id).toBe(KEY_ID);

    const rows = await deliveryRepo.find();
    const audit = rows.find((r: { label: string }) => r.label === "C2");
    expect(audit).toMatchObject({
      accepted: true,
      node: HOSP,
      reason: `relay→${NODE}`,
    });
    expect(audit.payload).toBeNull(); // 中继表里不存密文
  });

  it("密文摘要与信封声明不符 → 拒（平台不解密也能查完整性）", async () => {
    const tampered = {
      ...sealed,
      ciphertext: Buffer.from("other").toString("base64"),
    };
    await expect(send({ sealed: tampered })).rejects.toThrow(
      /摘要与信封声明不符/,
    );
    expect(
      (await outboxRepo.find()).filter(
        (r: { msg_type: string }) => r.msg_type === "C2EnvelopeRelay",
      ),
    ).toHaveLength(0);
  });

  it("目标不是本作业的片段节点 → 拒（不能借中继送到计划外的节点）", async () => {
    await expect(send({ target: OTHER_NODE })).rejects.toThrow(
      /不是该作业的片段节点/,
    );
  });

  it("AAD 的作业与消息不一致 / 合约不在作业列表 → 拒", async () => {
    const badAad = {
      ...dataEnvelope,
      aad: {
        ...(dataEnvelope.aad as Record<string, unknown>),
        job_id: "job-other",
      },
    };
    await expect(
      send({ envelope: signedByHolder({ body: { data_envelope: badAad } }) }),
    ).rejects.toThrow(/AAD 的作业与消息的作业不一致/);
    const badContract = {
      ...dataEnvelope,
      policy: {
        ...(dataEnvelope.policy as Record<string, unknown>),
        contract: "ctr-other",
      },
      aad: {
        ...(dataEnvelope.aad as Record<string, unknown>),
        contract_id: "ctr-other",
      },
    };
    await expect(
      send({
        envelope: signedByHolder({ body: { data_envelope: badContract } }),
      }),
    ).rejects.toThrow(/不在该作业的合约列表里/);
  });

  it("信封已过期 / 结构非法 / 未登记证书 / 签名无效 → 逐条拒", async () => {
    const expired = {
      ...dataEnvelope,
      policy: {
        ...(dataEnvelope.policy as Record<string, unknown>),
        not_after: new Date(Date.now() - 1000).toISOString(),
      },
    };
    await expect(
      send({ envelope: signedByHolder({ body: { data_envelope: expired } }) }),
    ).rejects.toThrow(/已过期/);

    await expect(
      send({
        envelope: signedByHolder({
          body: { data_envelope: { envelope: "x" } },
        }),
      }),
    ).rejects.toThrow(/结构非法/);

    const stranger = gm.generateSM2KeyPair();
    const strangerEnvelope = signEnvelope(
      unsigned({
        sender: participantUrn("sh-med", "p-unknown"),
        body: { data_envelope: dataEnvelope },
      }),
      stranger.privateKey,
      { publicKey: stranger.publicKey },
    );
    await expect(send({ envelope: strangerEnvelope })).rejects.toThrow(
      ForbiddenException,
    );

    // 签名字段被改（信封验签失败；异常类型由 MdopError 承载）
    const broken = signedByHolder({ body: { data_envelope: dataEnvelope } });
    (broken as { sig: { value: string } }).sig.value = "3045";
    await expect(send({ envelope: broken })).rejects.toBeInstanceOf(MdopError);
  });

  it("缺 sealed / target → 直接拒（不猜）", async () => {
    await expect(
      controller.relayEnvelope({
        envelope: signedByHolder({ body: { data_envelope: dataEnvelope } }),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
