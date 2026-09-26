import {
  canonicalSm3,
  generateSm2KeyPair,
  participantUrn,
  parseFragment,
  parseAuditReceipt,
  publicKeyFromPrivateKey,
  signCanonicalObject,
  signEnvelope,
  validateEdge,
  type NodeCapability,
  type PlanEdge,
} from "@medtrust/mdop";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { CaService } from "../runtime/participant-identity/ca.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopOutboxService } from "./mdop-outbox.service";
import { MdopReceiptChainService } from "./mdop-receipt-chain.service";
import { MdopTicketService } from "./mdop-ticket.service";
import { MdopSchedulerService } from "./mdop-scheduler.service";
import { MdopPurgeService } from "./mdop-purge.service";

/**
 * MDOP 一致性测试（openspec `mdop-kernel` §10 中平台侧适用项）。
 *
 *   10.1 信封印证与防重放（平台接收侧）· 10.3 编译期 C0 出节点负例 ·
 *   10.4 C2 边本期编译拒绝 · 10.7 平台侧检出回执断链 ·
 *   10.8 拒签/超时 → REJECTED 且零 StageDispatch
 */

const SPACE = "sh-med";
const HOSP_A = "p-huashan";
const HOSP_B = "p-ruijin";
const NODE_A = participantUrn(SPACE, HOSP_A);
const NODE_B = participantUrn(SPACE, HOSP_B);
const PLATFORM = participantUrn(SPACE, "platform");

describe("MDOP 一致性测试（§10 平台侧）", () => {
  const gm = new GMCryptoService();

  describe("10.1 平台接收侧：信封印证与防重放", () => {
    let ca: CaService;
    let outbox: MdopOutboxService;
    let connectorKeys: { publicKey: string; privateKey: string };

    beforeEach(async () => {
      process.env.SPACE_ID = SPACE;
      ca = new CaService(new GMCryptoService(), mockRepo(), mockRepo(), SPACE);
      await ca.onModuleInit();
      outbox = new MdopOutboxService(gm, ca, mockRepo(), mockRepo());
      connectorKeys = gm.generateSM2KeyPair();
    });

    afterEach(() => {
      delete process.env.SPACE_ID;
    });

    const envelope = (over: Record<string, unknown> = {}) =>
      signEnvelope(
        {
          mdop: "0.2",
          msg_id: "m-1",
          msg_type: "CapabilityAdvertise",
          job_id: "",
          sender: NODE_A,
          receiver: PLATFORM,
          timestamp: new Date().toISOString(),
          nonce: `n-${Math.random().toString(36).slice(2)}`,
          idempotency_key: "k",
          body: {},
          ...over,
        } as never,
        connectorKeys.privateKey,
        { publicKey: connectorKeys.publicKey },
      );

    it("篡改 body / 时间超窗 / 收件人不是平台 → E_AUTH_INVALID", async () => {
      const good = envelope();
      await expect(
        outbox.verifyInbound(
          { ...good, body: { evil: 1 } } as never,
          connectorKeys.publicKey,
        ),
      ).rejects.toMatchObject({ code: "E_AUTH_INVALID" });
      await expect(
        outbox.verifyInbound(
          envelope({
            timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
          }),
          connectorKeys.publicKey,
        ),
      ).rejects.toMatchObject({ code: "E_AUTH_INVALID" });
      await expect(
        outbox.verifyInbound(
          envelope({ receiver: NODE_B }),
          connectorKeys.publicKey,
        ),
      ).rejects.toMatchObject({ code: "E_AUTH_INVALID" });
    });

    it("nonce 重放 → E_REPLAY（落盘，重启后仍拦得住）", async () => {
      const msg = envelope();
      await expect(
        outbox.verifyInbound(msg, connectorKeys.publicKey),
      ).resolves.toBeDefined();
      await expect(
        outbox.verifyInbound(msg, connectorKeys.publicKey),
      ).rejects.toMatchObject({
        code: "E_REPLAY",
      });
      // 「重启」：新实例读同一份落盘 nonce 表
      const nonceRepo = (outbox as unknown as { nonces: unknown }).nonces;
      const restarted = new MdopOutboxService(
        gm,
        ca,
        mockRepo(),
        nonceRepo as never,
      );
      await expect(
        restarted.verifyInbound(msg, connectorKeys.publicKey),
      ).rejects.toMatchObject({
        code: "E_REPLAY",
      });
    });
  });

  describe("10.3 编译期：C0 不得跨节点", () => {
    it("C0 边连接两个节点 → E_LABEL_VIOLATION 并指出该边", () => {
      const capabilities = new Map<string, NodeCapability>([
        [NODE_A, capability(NODE_A)],
        [PLATFORM, capability(PLATFORM)],
      ]);
      try {
        validateEdge(
          {
            from_stage: "l15A",
            to_stage: "merge",
            label: "C0",
            from_node: NODE_A,
            to_node: PLATFORM,
          } as PlanEdge,
          { contract_recipients: [NODE_A, PLATFORM], capabilities },
        );
        throw new Error("应当抛错");
      } catch (err) {
        expect(err).toMatchObject({ code: "E_LABEL_VIOLATION" });
        expect((err as { where?: { edge?: string } }).where?.edge).toBe(
          "l15A->merge",
        );
      }
    });
  });

  describe("10.4 编译期：C2 边本期一律拒（暂代 KMS 度量不符时不放行密钥）", () => {
    it("任何节点都没有 TEE 能力 → E_CAPABILITY_MISMATCH", () => {
      const capabilities = new Map<string, NodeCapability>([
        [NODE_A, capability(NODE_A)],
        [PLATFORM, capability(PLATFORM)],
      ]);
      expect(() =>
        validateEdge(
          {
            from_stage: "s",
            to_stage: "enclave",
            label: "C2",
            from_node: NODE_A,
            to_node: PLATFORM,
          } as PlanEdge,
          {
            contract_recipients: [NODE_A, PLATFORM],
            capabilities,
            attestation_policy: { tee: ["tdx"] },
          },
        ),
      ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
    });
  });

  describe("10.7 平台侧检出回执链断链", () => {
    it("删掉/篡改一条回执 → ingest 拒收；verifyChain 指出断链位置", async () => {
      const receipts = mockRepo();
      const jobs = mockRepo();
      process.env.SPACE_ID = SPACE;
      const chain = new MdopReceiptChainService(receipts, jobs);
      // 平台侧现在**验签 + 核对 signer**：夹具必须真的用该节点私钥签（形状对不等于本人签）
      const keys = generateSm2KeyPair();
      const sender = {
        urn: NODE_A,
        publicKey: publicKeyFromPrivateKey(keys.privateKey),
      };
      const make = (id: string, prev: string | null, label = "C3") => {
        const unsigned = {
          receipt_id: id,
          job_id: "job-1",
          stage: "decA",
          event: "STAGE_SUCCEEDED" as const,
          input_digests: [] as string[],
          op_digest: "component:x@1",
          output_digest: canonicalSm3({ n: 1 }),
          label,
          prev_receipt_hash: prev,
          signer: NODE_A,
          at: new Date().toISOString(),
        };
        return parseAuditReceipt({
          ...unsigned,
          sig: signCanonicalObject(unsigned, keys.privateKey, {
            publicKey: sender.publicKey,
          }),
        });
      };
      const first = make("r1", null);
      expect(await chain.ingestAuditReceipt(first, sender)).toEqual({
        accepted: true,
      });
      const second = make("r2", canonicalSm3(first));
      expect(await chain.ingestAuditReceipt(second, sender)).toEqual({
        accepted: true,
      });
      expect(await chain.verifyChain(NODE_A, "job-1")).toMatchObject({
        valid: true,
        length: 2,
      });

      // 篡改第一条 → 连续性断言失败
      const rows = await receipts.find({
        where: { node: NODE_A, kind: "audit" },
      });
      await receipts.update(
        { id: rows[0].id },
        { payload: { ...rows[0].payload, label: "C0" } },
      );
      const broken = await chain.verifyChain(NODE_A, "job-1");
      expect(broken.valid).toBe(false);
      expect(broken.brokenAt).toBe("r2");

      // 迟到/跳号回执直接被拒收
      const orphan = make("r9", canonicalSm3({ nope: true }));
      const out = await chain.ingestAuditReceipt(orphan, sender);
      expect(out.accepted).toBe(false);
      delete process.env.SPACE_ID;
    });
  });

  describe("10.8 任一院拒签/复核超时 → REJECTED 且零 StageDispatch", () => {
    let ca: CaService;
    let jobs: ReturnType<typeof mockRepo>;
    let fragments: ReturnType<typeof mockRepo>;
    let stages: ReturnType<typeof mockRepo>;
    let tickets: ReturnType<typeof mockRepo>;
    let outbox: ReturnType<typeof mockRepo>;
    let ticketSvc: MdopTicketService;
    let scheduler: MdopSchedulerService;
    let keysA: { publicKey: string; privateKey: string };
    let keysB: { publicKey: string; privateKey: string };

    const seed = async () => {
      process.env.SPACE_ID = SPACE;
      ca = new CaService(new GMCryptoService(), mockRepo(), mockRepo(), SPACE);
      await ca.onModuleInit();
      jobs = mockRepo();
      fragments = mockRepo();
      stages = mockRepo();
      tickets = mockRepo();
      outbox = mockRepo();
      const certs = mockRepo();
      keysA = gm.generateSM2KeyPair();
      keysB = gm.generateSM2KeyPair();
      for (const [node, keys, id] of [
        [NODE_A, keysA, HOSP_A],
        [NODE_B, keysB, HOSP_B],
      ] as const) {
        await certs.save(
          certs.create({
            sm2Fingerprint: `SM2:${id}`,
            participantId: id,
            connectorId: `c-${id}`,
            spaceId: SPACE,
            subjectPublicKey: keys.publicKey,
            validUntil: new Date("2027-09-24T00:00:00.000Z"),
            revoked: false,
          }),
        );
      }
      await jobs.save(
        jobs.create({
          id: "job-1",
          purpose: "RWS.EFFECTIVENESS",
          applicant: { org: "o", project: "p" },
          contracts: ["ctr-1"],
          status: "COMPILED",
          planHash: `sm3:${"a".repeat(64)}`,
          logicalPlan: {
            stages: [
              { op: "rws.disproportionality@1.0.0", params: { drug: "x" } },
            ],
          },
          createdAt: new Date(),
        }),
      );
      for (const node of [NODE_A, NODE_B]) {
        await fragments.save(
          fragments.create({
            id: `job-1#${node}`,
            jobId: "job-1",
            node,
            fragment: parseFragment({
              node,
              stages: [
                {
                  id: `s-${node.slice(-6)}`,
                  node,
                  op: "rws.disproportionality@1.0.0",
                  op_digest: "component:x@1",
                  params: {},
                  inputs: [],
                  input_labels: [],
                  output_label: "C0",
                  output_schema: "mdop.table/1.0",
                },
              ],
              edges: [],
            }),
            fragmentHash: canonicalSm3({ node }),
          }),
        );
        await stages.save(
          stages.create({
            id: `job-1#s-${node.slice(-6)}`,
            jobId: "job-1",
            stageId: `s-${node.slice(-6)}`,
            node,
            opRef: "rws.disproportionality@1.0.0",
            opDigest: "component:x@1",
            params: {},
            inputs: [],
            outputLabel: "C0",
            outputSchema: "mdop.table/1.0",
            status: "PENDING",
            attempt: 0,
          }),
        );
      }
      const purge = new MdopPurgeService(jobs, fragments, outbox, mockRepo());
      ticketSvc = new MdopTicketService(
        gm,
        ca,
        jobs,
        fragments,
        stages,
        tickets,
        mockRepo(),
        outbox,
        certs,
      );
      scheduler = new MdopSchedulerService(
        jobs,
        stages,
        outbox,
        ticketSvc,
        purge,
      );
    };

    afterEach(() => {
      delete process.env.SPACE_ID;
    });

    it("两院中一院拒签 → REJECTED、通知他方、且没有任何 StageDispatch", async () => {
      await seed();
      const { ticketId } = await ticketSvc.offerTickets({
        jobId: "job-1",
        notBefore: "2026-09-24T00:00:00.000Z",
        notAfter: "2026-10-24T00:00:00.000Z",
      });
      await ticketSvc.reject(
        {
          jobId: "job-1",
          ticketId,
          signer: NODE_B,
          code: "E_PURPOSE_MISMATCH",
          message: "用途不符",
        },
        { urn: NODE_B },
      );
      const job = await jobs.findOne({ where: { id: "job-1" } });
      expect(job.status).toBe("REJECTED");
      const msgs = await outbox.find();
      expect(
        msgs.some((m: { msg_type: string }) => m.msg_type === "StageDispatch"),
      ).toBe(false);
      expect(
        msgs.some(
          (m: { msg_type: string; receiver: string }) =>
            m.msg_type === "JobAbort" && m.receiver === NODE_A,
        ),
      ).toBe(true);
      // 且此时不允许调度
      await expect(
        scheduler.dispatchReadyStages("job-1"),
      ).rejects.toBeDefined();
    });

    it("复核超时 → REJECTED，同样零 StageDispatch", async () => {
      await seed();
      await ticketSvc.offerTickets({
        jobId: "job-1",
        notBefore: "2026-09-24T00:00:00.000Z",
        notAfter: "2026-10-24T00:00:00.000Z",
      });
      await ticketSvc.expireNegotiation("job-1");
      const job = await jobs.findOne({ where: { id: "job-1" } });
      expect(job.status).toBe("REJECTED");
      const msgs = await outbox.find();
      expect(
        msgs.some((m: { msg_type: string }) => m.msg_type === "StageDispatch"),
      ).toBe(false);
    });
  });
});

function capability(node: string): NodeCapability {
  return {
    node,
    runtime: ["native", "wasm"],
    system_ops: [],
    whitelist_digests: [],
    tee: null,
    protocols: [],
  };
}

void signCanonicalObject;
void generateSm2KeyPair;
