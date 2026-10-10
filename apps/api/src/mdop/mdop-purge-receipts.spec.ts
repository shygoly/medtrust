import {
  canonicalSm3,
  generateSm2KeyPair,
  participantUrn,
  publicKeyFromPrivateKey,
  signCanonicalObject,
} from "@medtrust/mdop";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopPurgeService } from "./mdop-purge.service";
import { MdopReceiptChainService } from "./mdop-receipt-chain.service";

const HOSP_A = participantUrn("sh-med", "p-demohospa");
const HOSP_B = participantUrn("sh-med", "p-demohospb");
const PLATFORM = participantUrn("sh-med", "platform");

describe("终态销毁编排与回执链（任务 7.8 / 7.9）", () => {
  let jobs: ReturnType<typeof mockRepo>;
  let fragments: ReturnType<typeof mockRepo>;
  let outbox: ReturnType<typeof mockRepo>;
  let receipts: ReturnType<typeof mockRepo>;
  let purge: MdopPurgeService;
  let chain: MdopReceiptChainService;

  const seedJob = async (status = "FAILED") => {
    await jobs.save(
      jobs.create({
        id: "job-1",
        purpose: "RWS.EFFECTIVENESS",
        applicant: { org: "o", project: "p" },
        contracts: ["c1"],
        status,
        logicalPlan: {},
        createdAt: new Date(),
      }),
    );
    for (const node of [HOSP_A, HOSP_B, PLATFORM]) {
      await fragments.save(
        fragments.create({
          id: `job-1#${node}`,
          jobId: "job-1",
          node,
          fragment: { node },
          fragmentHash: canonicalSm3({ node }),
        }),
      );
    }
  };

  /** 销毁回执同样由**本人**签（平台侧现在验签 + 核对 node 与已认证发送方一致）。 */
  const purgeReceipt = (node: string, over: Record<string, unknown> = {}) => {
    const unsigned = {
      receipt_id: `rcpt-${node}`,
      job_id: "job-1",
      node,
      reason: "purge-order" as const,
      handles: [`art://${node}/job-1/s1/out`],
      destroyed_at: new Date().toISOString(),
      idempotency_key: "purge:job-1",
      ...over,
    };
    const key = keysFor(node);
    return {
      ...unsigned,
      sig: signCanonicalObject(unsigned, key.privateKey, {
        publicKey: key.publicKey,
      }),
    };
  };

  /**
   * 每个参与方一份自己的身份密钥：回执由**本人**签，平台用登记公钥验签并核对 signer
   * （`ingestAuditReceipt` 现在两条都判——形状合法不等于本人签，也不能代别人写链）。
   */
  const keysByNode = new Map<
    string,
    { privateKey: string; publicKey: string }
  >();
  const keysFor = (node: string) => {
    let key = keysByNode.get(node);
    if (!key) {
      const pair = generateSm2KeyPair();
      key = {
        privateKey: pair.privateKey,
        publicKey: publicKeyFromPrivateKey(pair.privateKey),
      };
      keysByNode.set(node, key);
    }
    return key;
  };
  const senderFor = (node: string) => ({
    urn: node,
    publicKey: keysFor(node).publicKey,
  });
  const auditReceipt = (
    node: string,
    prev: string | null,
    over: Record<string, unknown> = {},
  ) => {
    const unsigned = {
      receipt_id: `r-${node}-${Math.random().toString(36).slice(2)}`,
      job_id: "job-1",
      stage: "s1",
      event: "STAGE_SUCCEEDED",
      input_digests: [],
      op_digest: "component:x@1",
      output_digest: canonicalSm3({ n: 1 }),
      label: "C0",
      prev_receipt_hash: prev,
      signer: node,
      at: new Date().toISOString(),
      ...over,
    };
    const key = keysFor(node);
    return {
      ...unsigned,
      sig: signCanonicalObject(unsigned, key.privateKey, {
        publicKey: key.publicKey,
      }),
    };
  };

  beforeEach(() => {
    process.env.SPACE_ID = "sh-med";
    jobs = mockRepo();
    fragments = mockRepo();
    outbox = mockRepo();
    receipts = mockRepo();
    purge = new MdopPurgeService(jobs, fragments, outbox, receipts);
    chain = new MdopReceiptChainService(receipts, jobs);
  });

  afterEach(() => {
    delete process.env.SPACE_ID;
  });

  describe("销毁编排（7.8）", () => {
    it("终态作业：给持制品节点发 PurgeOrder；平台的 C3 交付物不销毁", async () => {
      await seedJob("FAILED");
      const { ordered } = await purge.orchestratePurge("job-1", PLATFORM);
      expect(ordered.sort()).toEqual([HOSP_A, HOSP_B].sort());
      const msgs = await outbox.find();
      expect(msgs.every((m) => m.msg_type === "PurgeOrder")).toBe(true);
      expect(msgs.some((m) => m.receiver === PLATFORM)).toBe(false);
      expect(msgs[0].idempotency_key).toBe("purge:job-1");
    });

    it("非终态作业不触发销毁", async () => {
      await seedJob("RUNNING");
      await expect(
        purge.orchestratePurge("job-1", PLATFORM),
      ).rejects.toMatchObject({
        code: "E_RUNTIME",
      });
    });

    it("缺回执不进 PURGED，并按原幂等键重发", async () => {
      await seedJob("FAILED");
      await purge.orchestratePurge("job-1", PLATFORM);
      const first = await purge.onPurgeReceipt(
        purgeReceipt(HOSP_A),
        senderFor(HOSP_A),
        PLATFORM,
      );
      expect(first).toMatchObject({
        received: 1,
        expected: 2,
        jobStatus: "FAILED",
      });
      const job = await jobs.findOne({ where: { id: "job-1" } });
      expect(job.status).not.toBe("PURGED");

      const { resent } = await purge.resendMissing("job-1", PLATFORM);
      expect(resent).toEqual([HOSP_B]);
      const orders = (await outbox.find()).filter((m) => m.receiver === HOSP_B);
      expect(orders).toHaveLength(1); // 同一幂等键不重复生成指令
    });

    it("收齐全部回执 → PURGED；重复回执幂等", async () => {
      await seedJob("ABORTED");
      await purge.orchestratePurge("job-1", PLATFORM);
      await purge.onPurgeReceipt(
        purgeReceipt(HOSP_A),
        senderFor(HOSP_A),
        PLATFORM,
      );
      const done = await purge.onPurgeReceipt(
        purgeReceipt(HOSP_B),
        senderFor(HOSP_B),
        PLATFORM,
      );
      expect(done.jobStatus).toBe("PURGED");
      const job = await jobs.findOne({ where: { id: "job-1" } });
      expect(job.status).toBe("PURGED");

      const again = await purge.onPurgeReceipt(
        purgeReceipt(HOSP_B),
        senderFor(HOSP_B),
        PLATFORM,
      );
      expect(again).toMatchObject({ received: 2, expected: 2 });
    });

    it("销毁回执不得替别人发：node 与已认证发送方不符 / 签名不是本人签 → 拒（作业不进 PURGED）", async () => {
      await seedJob("FAILED");
      await purge.orchestratePurge("job-1", PLATFORM);

      // ① 已认证发送方是 HOSP_A，回执却声明是 HOSP_B
      await expect(
        purge.onPurgeReceipt(purgeReceipt(HOSP_B), senderFor(HOSP_A), PLATFORM),
      ).rejects.toThrow(/与已认证发送方/);

      // ② 声明对得上，但用**别人的私钥**签（形状合法 ≠ 本人签）
      const attacker = generateSm2KeyPair();
      const forged = purgeReceipt(HOSP_A);
      const { sig: _drop, ...unsigned } = forged;
      const reSigned = {
        ...unsigned,
        sig: signCanonicalObject(unsigned, attacker.privateKey, {
          publicKey: publicKeyFromPrivateKey(attacker.privateKey),
        }),
      };
      await expect(
        purge.onPurgeReceipt(reSigned as never, senderFor(HOSP_A), PLATFORM),
      ).rejects.toThrow(/签名验证失败/);

      // 两条都不得被计入「已收到」→ 作业仍停在原状态
      expect(await receipts.find({ where: { kind: "purge" } })).toHaveLength(0);
      expect((await jobs.findOne({ where: { id: "job-1" } })).status).toBe(
        "FAILED",
      );
    });
  });

  describe("回执链（7.9）", () => {
    it("按节点校验连续性：正常成链通过；删掉/改动一条即报断链并指出位置", async () => {
      const first = auditReceipt(HOSP_A, null);
      expect(await chain.ingestAuditReceipt(first, senderFor(HOSP_A))).toEqual({
        accepted: true,
      });
      const firstHash = canonicalSm3(first);
      const second = auditReceipt(HOSP_A, firstHash);
      expect(await chain.ingestAuditReceipt(second, senderFor(HOSP_A))).toEqual(
        { accepted: true },
      );
      expect(await chain.verifyChain(HOSP_A, "job-1")).toMatchObject({
        valid: true,
        length: 2,
      });

      // 篡改第一条回执 → 链断（第二条的 prev 对不上）
      const rows = await receipts.find({
        where: { node: HOSP_A, kind: "audit" },
      });
      const tampered = { ...rows[0].payload, label: "C3" };
      await receipts.update({ id: rows[0].id }, { payload: tampered });
      const verification = await chain.verifyChain(HOSP_A, "job-1");
      expect(verification.valid).toBe(false);
      expect(verification.brokenAt).toBe(rows[1].payload.receipt_id);
      expect(verification.reason).toMatch(/前序哈希对不上/);
    });

    it("到来顺序不对（前序未到）即拒收并说明原因", async () => {
      const orphan = auditReceipt(HOSP_B, canonicalSm3({ unknown: true }));
      const out = await chain.ingestAuditReceipt(orphan, senderFor(HOSP_B));
      expect(out.accepted).toBe(false);
      expect(out.reason).toMatch(/链上还没有该节点的回执/);
      expect((await receipts.find()).length).toBe(0);
    });

    it("链头锚定：链不可达时记 pending（补偿队列），不伪造交易号", async () => {
      await chain.ingestAuditReceipt(
        auditReceipt(HOSP_A, null),
        senderFor(HOSP_A),
      );
      const head = await chain.chainHead(HOSP_A, "job-1");
      expect(head).toBe(canonicalSm3((await receipts.find())[0].payload));

      // 没有接入 AttestationService（等价于链不可达）→ pending
      const result = await chain.anchorChainHead(HOSP_A, "job-1");
      expect(result).toMatchObject({ status: "pending", chainHead: head });
      expect(result).not.toHaveProperty("txHash");
      const anchors = await chain.pendingAnchors();
      expect(anchors).toHaveLength(1);
      expect(anchors[0].payload).toMatchObject({
        status: "pending",
        chain_head: head,
      });
      expect(JSON.stringify(anchors[0].payload)).not.toMatch(/tx_id/);
    });

    it("作业终态时锚定全部节点链头（每 30 分钟锚定调用同一方法）", async () => {
      await chain.ingestAuditReceipt(
        auditReceipt(HOSP_A, null),
        senderFor(HOSP_A),
      );
      await chain.ingestAuditReceipt(
        auditReceipt(HOSP_B, null),
        senderFor(HOSP_B),
      );
      const results = await chain.anchorJobChainHeads("job-1");
      expect(results.map((r) => r.node).sort()).toEqual(
        [HOSP_A, HOSP_B].sort(),
      );
      expect(results.every((r) => r.status === "pending")).toBe(true);
    });
  });
});
