import {
  canonicalSm3,
  generateSm2KeyPair,
  parseAuditReceipt,
  publicKeyFromPrivateKey,
  signCanonicalObject,
  type AuditReceipt,
} from "@medtrust/mdop";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopReceiptChainService } from "./mdop-receipt-chain.service";

/**
 * **可信空间节点**的回执链在平台侧的完整流程（任务 3.9 / 8.5 的锚定那一半）。
 *
 * 与医院连接器的回执走**完全相同的通道与判据**：节点回执就是协议 `AuditReceipt`
 * （`UNSEALED`/`EXECUTED`/`EXITED`/`PURGED` 四类，解封与执行带本次证明摘要），
 * 因此平台不必为它另写一套收链/校链/锚定逻辑——这正是把回执形状统一的目的。
 */

const JOB = "job-node-chain";
const TEE = "urn:tds:sh-med:participant:tee-1";
/** 节点自持身份密钥：回执由它签，平台用登记证书里的公钥验（部署时来自证书目录）。 */
const NODE_KEYS = generateSm2KeyPair();
const SENDER = {
  urn: TEE,
  publicKey: publicKeyFromPrivateKey(NODE_KEYS.privateKey),
};
const AT_BASE = Date.parse("2026-09-25T10:00:00.000Z");
const QUOTE = `sm3:${"a".repeat(64)}`;
const MEAS = `sm3:${"b".repeat(64)}`;

/** 造一条**与节点侧产出同形**的回执（字段集与 `NodeReceiptChain.append` 一致）。 */
function nodeReceipt(
  event: AuditReceipt["event"],
  stage: string,
  prev: string | null,
  extra: Partial<AuditReceipt> = {},
  index = 0,
): AuditReceipt {
  const payload = {
    receipt_id: `${JOB}:${event}:${index}`,
    job_id: JOB,
    stage,
    event,
    input_digests: [],
    op_digest:
      event === "EXITED" ? "component:node-exit@1" : "component:node@1",
    output_digest: null,
    label: event === "EXITED" ? "C3" : null,
    prev_receipt_hash: prev,
    signer: TEE,
    at: new Date(AT_BASE + index * 1000).toISOString(),
    ...extra,
  };
  // 真的用节点私钥签（平台侧现在会验签：形状对不代表是本人签的）
  const sig = signCanonicalObject(payload, NODE_KEYS.privateKey, {
    publicKey: SENDER.publicKey,
  });
  // 自检：平台侧 `ingestAuditReceipt` 的第一步就是 parseAuditReceipt，节点产出必须能被它读回
  return parseAuditReceipt({ ...payload, sig });
}

function service(attestation?: {
  anchor: (
    d: string,
    meta: unknown,
  ) => Promise<{ txHash: string; block: number }>;
}) {
  const receiptsRepo = mockRepo();
  const jobsRepo = mockRepo();
  const svc = new MdopReceiptChainService(
    receiptsRepo as never,
    jobsRepo as never,
    attestation as never,
  );
  return { svc, receiptsRepo, jobsRepo };
}

describe("节点回执链在平台侧（任务 3.9 / 8.5）", () => {
  it("四类事件按序 ingest → 校链通过 → 链头用真实交易号锚定", async () => {
    const { svc, receiptsRepo } = service({
      anchor: async (digest) => ({
        txHash: `0xnode-${digest.slice(5, 13)}`,
        block: 77,
      }),
    });
    const chain: AuditReceipt[] = [];
    const push = (
      event: AuditReceipt["event"],
      stage: string,
      extra: Partial<AuditReceipt> = {},
    ) => {
      const prev = chain.length ? canonicalSm3(chain[chain.length - 1]) : null;
      const receipt = nodeReceipt(event, stage, prev, extra, chain.length);
      chain.push(receipt);
      return receipt;
    };
    push("UNSEALED", "st-1", {
      attestation: { quote_digest: QUOTE, measurement: MEAS, tcb: "3.1.2" },
    });
    push("EXECUTED", "st-1", {
      attestation: { quote_digest: QUOTE, measurement: MEAS, tcb: "3.1.2" },
    });
    push("EXITED", "st-1", {
      detail: { handle: "art://tee-1/job-node-chain/st-1" },
    });
    push("PURGED", "__node__", {
      detail: { handles: ["art://tee-1/job-node-chain/st-1"] },
    });

    for (const receipt of chain)
      expect(await svc.ingestAuditReceipt(receipt, SENDER)).toEqual({
        accepted: true,
      });
    expect(await svc.verifyChain(TEE, JOB)).toMatchObject({
      valid: true,
      length: 4,
    });

    const head = await svc.chainHead(TEE, JOB);
    expect(head).toBe(canonicalSm3(chain[chain.length - 1]));
    const anchor = await svc.anchorChainHead(TEE, JOB);
    expect(anchor).toMatchObject({
      node: TEE,
      status: "anchored",
      chainHead: head,
      block: 77,
    });
    expect(anchor?.txHash).toMatch(/^0xnode-/);

    // 锚定记录里是**真实交易号**（不是 pending 占位）
    const rows = await receiptsRepo.find({ where: { kind: "anchor" } });
    expect(rows[0].payload).toMatchObject({
      status: "anchored",
      tx_id: anchor?.txHash,
      block: 77,
    });
    expect(await svc.pendingAnchors()).toHaveLength(0);
  });

  it("节点回执被改 → 校链报断链并指出位置（与连接器同一判据）", async () => {
    const { svc, receiptsRepo } = service();
    const first = nodeReceipt(
      "UNSEALED",
      "st-1",
      null,
      {
        attestation: { quote_digest: QUOTE, measurement: MEAS, tcb: "3.1.2" },
      },
      0,
    );
    const second = nodeReceipt("EXECUTED", "st-1", canonicalSm3(first), {}, 1);
    await svc.ingestAuditReceipt(first, SENDER);
    await svc.ingestAuditReceipt(second, SENDER);

    const rows = await receiptsRepo.find({
      where: { node: TEE, kind: "audit" },
    });
    await receiptsRepo.update(
      { id: rows[0].id },
      { payload: { ...rows[0].payload, measurement: MEAS } },
    );
    const verification = await svc.verifyChain(TEE, JOB);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAt).toBe(second.receipt_id);
  });

  it("回执的 signer 被冒充 / 签名不是本人签 → 一律拒（不得把记录塞进别人的链）", async () => {
    const { svc, receiptsRepo } = service();

    // ① 已认证发送方是 TEE，但回执自称是**另一家**（把记录塞进别人的链 → 对方后续诚实回执会判断链）
    const impostor = nodeReceipt(
      "UNSEALED",
      "st-1",
      null,
      { signer: "urn:tds:sh-med:participant:other" },
      0,
    );
    const rejected = await svc.ingestAuditReceipt(impostor, SENDER);
    expect(rejected.accepted).toBe(false);
    expect(rejected.reason).toContain("与已认证发送方");
    expect(await receiptsRepo.find({ where: { kind: "audit" } })).toHaveLength(
      0,
    );

    // ② signer 对得上，但签名是用**别人的私钥**做的（形状合法 ≠ 本人签）
    const forged = nodeReceipt("UNSEALED", "st-1", null, {}, 0);
    const attacker = generateSm2KeyPair();
    const reSigned = {
      ...forged,
      sig: signCanonicalObject(
        // 用回执本身的字段重签（去掉 sig），签名者却是攻击者的私钥
        (({ sig: _drop, ...rest }) => rest)(forged),
        attacker.privateKey,
        { publicKey: publicKeyFromPrivateKey(attacker.privateKey) },
      ),
    };
    const forgedOut = await svc.ingestAuditReceipt(reSigned, SENDER);
    expect(forgedOut.accepted).toBe(false);
    expect(forgedOut.reason).toContain("签名验证失败");
    expect(await receiptsRepo.find({ where: { kind: "audit" } })).toHaveLength(
      0,
    );
  });

  it("链不可达（0xLOCAL 降级回执）→ 记 pending 且不写假交易号", async () => {
    const { svc, receiptsRepo } = service({
      anchor: async () => ({ txHash: `0xLOCAL:${"0".repeat(8)}`, block: 0 }),
    });
    const first = nodeReceipt("UNSEALED", "st-1", null, {}, 0);
    await svc.ingestAuditReceipt(first, SENDER);
    expect(await svc.anchorChainHead(TEE, JOB)).toMatchObject({
      status: "pending",
    });
    const rows = await receiptsRepo.find({ where: { kind: "anchor" } });
    expect(rows[0].payload).toMatchObject({ status: "pending" });
    expect(JSON.stringify(rows[0].payload)).not.toMatch(/tx_id/);
    expect(await svc.pendingAnchors()).toHaveLength(1);
  });
});
