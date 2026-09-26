import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  MdopError,
  parseParticipantUrn,
  signEnvelope,
  verifyEnvelope,
  sm2Sign,
  participantUrn,
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

const HOSP = "p-huashan";
const HOSP_URN = participantUrn("sh-med", HOSP);
const PLATFORM_URN = participantUrn("sh-med", "platform");
const CONTRACT = "ctr-msg";

describe("MDOP 消息通道（任务 7.2 / 7.7）", () => {
  let gm: GMCryptoService;
  let ca: CaService;
  let outboxRepo: ReturnType<typeof mockRepo>;
  let nonceRepo: ReturnType<typeof mockRepo>;
  let handleRepo: ReturnType<typeof mockRepo>;
  let deliveryRepo: ReturnType<typeof mockRepo>;
  let jobRepo: ReturnType<typeof mockRepo>;
  let certsRepo: ReturnType<typeof mockRepo>;
  let contractsRepo: ReturnType<typeof mockRepo>;
  let outbox: MdopOutboxService;
  let contracts: MdopContractService;
  let controller: MdopMessagesController;
  let hospKeys: { publicKey: string; privateKey: string };

  const unsigned = (
    over: Partial<UnsignedEnvelope> = {},
  ): UnsignedEnvelope => ({
    mdop: "0.2",
    msg_id: `msg-${Math.random().toString(36).slice(2)}`,
    msg_type: "ContractAgree",
    job_id: "",
    sender: HOSP_URN,
    receiver: PLATFORM_URN,
    timestamp: new Date().toISOString(),
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    idempotency_key: `agree:${CONTRACT}`,
    body: {},
    ...over,
  });

  const signedByHospital = (over: Partial<UnsignedEnvelope> = {}): Envelope =>
    signEnvelope(unsigned(over), hospKeys.privateKey, {
      publicKey: hospKeys.publicKey,
    });

  beforeEach(async () => {
    process.env.SPACE_ID = "sh-med";
    gm = new GMCryptoService();
    ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    await ca.onModuleInit();
    outboxRepo = mockRepo();
    nonceRepo = mockRepo();
    handleRepo = mockRepo();
    deliveryRepo = mockRepo();
    jobRepo = mockRepo();
    certsRepo = mockRepo();
    contractsRepo = mockRepo();

    outbox = new MdopOutboxService(gm, ca, outboxRepo, nonceRepo);
    contracts = new MdopContractService(
      gm,
      ca,
      contractsRepo,
      certsRepo,
      outboxRepo,
      "sh-med",
    );
    // 凭证要约的应答（§7.5）与阶段推进（§7.6）在本用例里只要求可构造：
    // 本用例只走合约签署与数据面投递，不发起片段要约。
    const stageRepo = mockRepo();
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
    const scheduler = new MdopSchedulerService(
      jobRepo,
      stageRepo,
      outboxRepo,
      tickets,
      purge,
    );
    controller = new MdopMessagesController(
      outbox,
      contracts,
      // 销毁编排与回执链（§7.8/§7.9）在本用例中只要求可构造
      purge,
      // 会话见证（§6.7）在本用例中不被触发；本用例只走合约签署与数据面投递
      new MdopAttestationService(mockRepo()),
      new MdopReceiptChainService(mockRepo(), jobRepo),
      // 合并阶段（§9.5）在本用例中不被触发（投递不带载荷）
      new MdopMergeService(jobRepo, deliveryRepo, mockRepo(), stageRepo, purge),
      tickets,
      scheduler,
      certsRepo,
      handleRepo,
      deliveryRepo,
      jobRepo,
      mockRepo(), // 片段（C2 中继的目标校验）
    );

    hospKeys = gm.generateSM2KeyPair();
    await certsRepo.save(
      certsRepo.create({
        sm2Fingerprint: "SM2:HS",
        participantId: HOSP,
        connectorId: "c-huashan",
        spaceId: "sh-med",
        subjectPublicKey: hospKeys.publicKey,
        validUntil: new Date("2027-09-24T00:00:00.000Z"),
        revoked: false,
      }),
    );
  });

  afterEach(() => {
    delete process.env.SPACE_ID;
  });

  describe("控制面 messages", () => {
    it("未登记证书的发送方 → 403", async () => {
      const other = gm.generateSM2KeyPair();
      const envelope = signEnvelope(
        unsigned({ sender: participantUrn("sh-med", "p-unknown") }),
        other.privateKey,
        { publicKey: other.publicKey },
      );
      await expect(controller.messages({ envelope })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("body 夹带制品内容 → 拒收（控制面不携带数据）", async () => {
      const envelope = signedByHospital({
        body: { payload: "base64…" },
      });
      await expect(controller.messages({ envelope })).rejects.toMatchObject({
        code: "E_AUTH_INVALID",
      });
    });

    it("签名与登记公钥不符 → E_AUTH_INVALID", async () => {
      const other = gm.generateSM2KeyPair();
      const envelope = signEnvelope(unsigned(), other.privateKey, {
        publicKey: other.publicKey,
      });
      await expect(controller.messages({ envelope })).rejects.toMatchObject({
        code: "E_AUTH_INVALID",
      });
    });

    it("收件人不是平台 → E_AUTH_INVALID", async () => {
      const envelope = signedByHospital({
        receiver: participantUrn("sh-med", "p-ruijin"),
      });
      await expect(controller.messages({ envelope })).rejects.toMatchObject({
        code: "E_AUTH_INVALID",
      });
    });

    it("时间偏差超出窗口 → E_AUTH_INVALID", async () => {
      const envelope = signedByHospital({
        timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
      });
      await expect(controller.messages({ envelope })).rejects.toMatchObject({
        code: "E_AUTH_INVALID",
      });
    });

    it("nonce 重放 → E_REPLAY（且 nonce 落盘，重启后仍拦得住）", async () => {
      // 用一条能被处理的消息（能力通告），确保第一次就通过
      const envelope = signedByHospital({ msg_type: "CapabilityAdvertise" });
      await expect(controller.messages({ envelope })).resolves.toBeDefined();
      await expect(controller.messages({ envelope })).rejects.toMatchObject({
        code: "E_REPLAY",
      });
      // 「重启」= 换一个 outbox 实例读同一份 nonce 落盘数据
      const restarted = new MdopOutboxService(gm, ca, outboxRepo, nonceRepo);
      await expect(
        restarted.verifyInbound(envelope, hospKeys.publicKey),
      ).rejects.toMatchObject({
        code: "E_REPLAY",
      });
    });

    it("ContractAgree → 验签 + 副署 + 激活（走完整信封通道）", async () => {
      // 先由平台发起要约（拿到 canonical）
      await contractsRepo.save(
        contractsRepo.create({
          id: CONTRACT,
          dataProductId: "dp-1",
          providerId: HOSP,
          consumerId: "p-meddata",
          purpose: "RWS.EFFECTIVENESS",
          retention: "阅后即焚",
          output: "仅聚合统计",
          outputPolicy: { preset: "aggregate-only", minCell: 10 },
          validUntil: "2027-09-24T00:00:00.000Z",
          status: "active",
          pinnedModules: {
            disproportionality: { sm3: "b".repeat(64), tier: "A" },
          },
          createdAt: new Date("2026-09-24T00:00:00.000Z"),
          mdopStatus: "unsigned",
        }),
      );
      const offer = await contracts.offer(CONTRACT);
      const holderSignature = sm2Sign(offer.canonical, hospKeys.privateKey, {
        publicKey: hospKeys.publicKey,
      });

      const envelope = signedByHospital({
        body: {
          contract_id: CONTRACT,
          canonical: offer.canonical,
          holder_signature: holderSignature,
        },
      });
      const out = await controller.messages({ envelope });
      expect(out).toMatchObject({ accepted: true, mdopStatus: "active" });
      const row = await contractsRepo.findOne({ where: { id: CONTRACT } });
      expect(row.mdopStatus).toBe("active");
      expect(
        gm.sm2Verify(
          offer.canonical,
          row.platformCountersignature,
          ca.platformNodePublicKey,
        ),
      ).toBe(true);
    });
  });

  describe("数据面 deliveries（任务 7.7）", () => {
    beforeEach(async () => {
      await jobRepo.save(
        jobRepo.create({
          id: "job-1",
          purpose: "RWS.EFFECTIVENESS",
          applicant: { org: "o", project: "p" },
          contracts: [CONTRACT],
          status: "TICKETED",
          logicalPlan: {},
          createdAt: new Date(),
        }),
      );
      // 合约接收方含平台
      await contractsRepo.save(
        contractsRepo.create({
          id: CONTRACT,
          dataProductId: "dp-1",
          providerId: HOSP,
          consumerId: "p-meddata",
          purpose: "RWS.EFFECTIVENESS",
          retention: "阅后即焚",
          output: "仅聚合统计",
          validUntil: "2027-09-24T00:00:00.000Z",
          status: "active",
          createdAt: new Date("2026-09-24T00:00:00.000Z"),
          mdopStatus: "active",
          holderSignature: "sig",
          platformCountersignature: "sig",
          mdopTerms: {
            recipients: [
              { party: HOSP_URN, role: "final", jurisdiction: "CN" },
              { party: PLATFORM_URN, role: "merger", jurisdiction: "CN" },
            ],
            purposeCode: "RWS.EFFECTIVENESS",
            allowedOpDigests: [],
            review: { mode: "auto", deadlineHours: 72 },
            ethics: { required: false, ref: null, validUntil: null },
            providerPublicKeyKid: "a".repeat(64),
            platformPublicKeyKid: "b".repeat(64),
            preReviewSnapshot: null,
            publication: {},
            dataProductId: "dp-1",
          },
        }),
      );
      await handleRepo.save(
        handleRepo.create({
          handle: "art://p-huashan/job-1/decA/table",
          jobId: "job-1",
          node: HOSP,
          stage: "decA",
          label: "C3",
          schema: "mdop.table/1.0",
          digest: `sm3:${"d".repeat(64)}`,
          producer: {
            stage: "decA",
            op: "declassify.small_cell@1.0.0",
            op_digest: "component:x@1",
          },
          expiresAt: "2026-09-27T00:00:00.000Z",
        }),
      );
    });

    it("非 C3 投递 → 拒收并留痕", async () => {
      const envelope = signedByHospital({
        job_id: "job-1",
        idempotency_key: "deliver:1",
      });
      await expect(
        controller.deliveries({
          envelope,
          handle: {
            handle: "art://p-huashan/job-1/decA/table",
            label: "C0",
            digest: `sm3:${"d".repeat(64)}`,
          },
        }),
      ).rejects.toThrow(ForbiddenException);
      const rows = await deliveryRepo.find();
      expect(rows[0].accepted).toBe(false);
      expect(rows[0].reason).toMatch(/只接受 C3/);
    });

    it("句柄未登记 / 摘要不一致 → 拒收", async () => {
      await expect(
        controller.deliveries({
          envelope: signedByHospital({
            job_id: "job-1",
            idempotency_key: "d1",
          }),
          handle: {
            handle: "art://x",
            label: "C3",
            digest: `sm3:${"d".repeat(64)}`,
          },
        }),
      ).rejects.toThrow(/句柄未登记/);
      await expect(
        controller.deliveries({
          envelope: signedByHospital({
            job_id: "job-1",
            idempotency_key: "d2",
          }),
          handle: {
            handle: "art://p-huashan/job-1/decA/table",
            label: "C3",
            digest: `sm3:${"e".repeat(64)}`,
          },
        }),
      ).rejects.toThrow(/摘要与已登记句柄不一致/);
    });

    it("合约接收方没有平台 → 拒收", async () => {
      const row = await contractsRepo.findOne({ where: { id: CONTRACT } });
      row.mdopTerms.recipients = [
        { party: HOSP_URN, role: "final", jurisdiction: "CN" },
      ];
      await contractsRepo.save(row);
      await expect(
        controller.deliveries({
          envelope: signedByHospital({
            job_id: "job-1",
            idempotency_key: "d3",
          }),
          handle: {
            handle: "art://p-huashan/job-1/decA/table",
            label: "C3",
            digest: `sm3:${"d".repeat(64)}`,
          },
        }),
      ).rejects.toThrow(/没有平台/);
    });

    it("作业没有凭证 → 拒收；条件齐备 → 接受", async () => {
      await jobRepo.update({ id: "job-1" }, { status: "NEGOTIATING" });
      await expect(
        controller.deliveries({
          envelope: signedByHospital({
            job_id: "job-1",
            idempotency_key: "d4",
          }),
          handle: {
            handle: "art://p-huashan/job-1/decA/table",
            label: "C3",
            digest: `sm3:${"d".repeat(64)}`,
          },
        }),
      ).rejects.toThrow(/尚未取得执行凭证/);

      await jobRepo.update({ id: "job-1" }, { status: "TICKETED" });
      await expect(
        controller.deliveries({
          envelope: signedByHospital({
            job_id: "job-1",
            idempotency_key: "d5",
          }),
          handle: {
            handle: "art://p-huashan/job-1/decA/table",
            label: "C3",
            digest: `sm3:${"d".repeat(64)}`,
          },
        }),
      ).resolves.toMatchObject({ accepted: true });
    });
  });

  describe("发件箱（平台 → 连接器，至少一次）", () => {
    it("下发信封由平台节点密钥签名，且重发复用同一 msg_id/nonce", async () => {
      await outboxRepo.save(
        outboxRepo.create({
          id: "ContractOffer:offer:1",
          msg_id: "msg-fixed",
          msg_type: "ContractOffer",
          job_id: null,
          receiver: HOSP_URN,
          sender: PLATFORM_URN,
          idempotency_key: "offer:1",
          body: { offer_id: "offer:1", contract_id: CONTRACT, canonical: "{}" },
        }),
      );
      const first = await outbox.pendingFor(HOSP_URN);
      expect(first).toHaveLength(1);
      expect(first[0].sender).toBe(PLATFORM_URN);
      const parsed = parseParticipantUrn(first[0].receiver);
      expect(parsed?.id).toBe(HOSP);
      // 至少一次：重发复用同一 msg_id 与 nonce，连接器才能按它去重
      const second = await outbox.pendingFor(HOSP_URN);
      expect(second[0].msg_id).toBe("msg-fixed");
      expect(second[0].nonce).toBe(first[0].nonce);
    });

    it("用错用途的密钥验不过（平台节点 vs CA 根钥）", async () => {
      await outboxRepo.save(
        outboxRepo.create({
          id: "x",
          msg_id: "m1",
          msg_type: "ContractOffer",
          job_id: null,
          receiver: HOSP_URN,
          sender: PLATFORM_URN,
          idempotency_key: "k1",
          body: {},
        }),
      );
      const [env] = await outbox.pendingFor(HOSP_URN);
      const { sig, ...unsignedEnv } = env as unknown as Record<string, unknown>;
      expect(ca.verifyObjectWith("platform-node", unsignedEnv, sig)).toBe(true);
      expect(ca.verifyObjectWith("certificate", unsignedEnv, sig)).toBe(false);
      expect(ca.verifyObjectWith("registry", unsignedEnv, sig)).toBe(false);
      expect(MdopError).toBeDefined();
      expect(BadRequestException).toBeDefined();
    });

    /**
     * 回归：至少一次投递必须**每次重新盖时间戳**，否则一条迟迟未确认的消息会带着旧时间戳
     * 重发，超过接收方 ±5 分钟窗口后永远送不达（本机 ali29 演练时实测踩到）。
     */
    it("重发：msg_id 与 nonce 不变（去重身份），时间戳每次都是新的", async () => {
      await outboxRepo.save(
        outboxRepo.create({
          id: "ContractOffer:stale:1",
          msg_id: "msg-stale",
          msg_type: "ContractOffer",
          job_id: null,
          receiver: HOSP_URN,
          sender: PLATFORM_URN,
          idempotency_key: "stale:1",
          body: { contract_id: CONTRACT },
        }),
      );
      const first = (await outbox.pendingFor(HOSP_URN))[0];
      await new Promise((r) => setTimeout(r, 1100));
      const second = (await outbox.pendingFor(HOSP_URN))[0];
      expect(second.msg_id).toBe(first.msg_id);
      expect(second.nonce).toBe(first.nonce);
      expect(Date.parse(second.timestamp)).toBeGreaterThan(
        Date.parse(first.timestamp),
      );
      // 重发的新信封仍能通过**接收方**（连接器）的四步校验——时间窗不再成为死锁
      const seen = new Set<string>();
      expect(() =>
        verifyEnvelope(second, {
          self: HOSP_URN,
          senderPublicKey: ca.platformNodePublicKey,
          nonceStore: {
            seen: (n: string) => seen.has(n),
            remember: (n: string) => seen.add(n),
          },
        }),
      ).not.toThrow();
    });
  });
});
