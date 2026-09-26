import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MdopJobEntity, MdopReceiptEntity } from "@medtrust/database";
import {
  canonicalSm3,
  parseAuditReceipt,
  verifyCanonicalObject,
  type AuditReceipt,
} from "@medtrust/mdop";
import { AttestationService } from "../runtime/digital-contract/attestation.service";

/**
 * 审计回执链（任务 7.9 / 协议 §10.3、规格「审计回执链」「回执链头锚定」）。
 *
 * 每个节点的回执在本地成链（`prev_receipt_hash`）；平台**逐节点**校验连续性 ——
 * 断链 MUST 被检测到并指出位置。
 *
 * 链头在作业进入终态时、以及每 30 分钟锚定一次（复用 `AttestationService`）。
 * **链不可达时进补偿队列（标记待上链），MUST NOT 伪造交易号**。
 */

export interface ChainVerification {
  node: string;
  valid: boolean;
  length: number;
  brokenAt?: string;
  reason?: string;
}

export interface AnchorResult {
  node: string;
  chainHead: string;
  status: "anchored" | "pending";
  txHash?: string;
  block?: number;
}

@Injectable()
export class MdopReceiptChainService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MdopReceiptChainService.name);
  private anchorTimer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(MdopReceiptEntity, "controlplane")
    private readonly receipts: Repository<MdopReceiptEntity>,
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly jobs: Repository<MdopJobEntity>,
    @Optional() private readonly attestation?: AttestationService,
  ) {}

  /**
   * 周期锚定（协议 §10.3：终态时 + 每 30 分钟一次）。
   * 这一步必须有定时器：没有它，回执链头只会留在平台库里，**永远不上链**，
   * 「核验锚定」也就无从核起。
   */
  onModuleInit(): void {
    this.anchorTimer = setInterval(() => {
      void this.anchorTerminalJobs().catch((err) =>
        this.logger.warn(`周期锚定失败：${(err as Error).message}`),
      );
    }, 30 * 60_000);
    this.anchorTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.anchorTimer) clearInterval(this.anchorTimer);
  }

  /** 给「已有审计回执、但还没有锚定记录」的作业补锚（幂等：已锚的跳过）。 */
  async anchorTerminalJobs(): Promise<number> {
    const audits = await this.receipts.find({ where: { kind: "audit" } });
    const anchors = await this.receipts.find({ where: { kind: "anchor" } });
    const anchored = new Set(anchors.map((a) => `${a.jobId}#${a.node}`));
    const jobIds = [...new Set(audits.map((a) => a.jobId))];
    let count = 0;
    for (const jobId of jobIds) {
      // 逐作业判：全节点都已锚过就跳过（避免重复上链）；否则只补没锚过的节点。
      const nodes = [
        ...new Set(audits.filter((a) => a.jobId === jobId).map((a) => a.node)),
      ];
      const missing = nodes.filter((node) => !anchored.has(`${jobId}#${node}`));
      if (missing.length === 0) continue;
      for (const result of await this.anchorJobChainHeads(jobId))
        if (missing.includes(result.node)) count += 1;
    }
    return count;
  }

  /** 某作业的锚定记录（控制台/核验用）。 */
  async anchorsOf(jobId: string): Promise<MdopReceiptEntity[]> {
    return this.receipts.find({
      where: { jobId, kind: "anchor" },
      order: { receivedAt: "ASC" },
    });
  }

  /**
   * 收下一条审计回执：**先认身份，再认签名，最后认连续性**。
   *
   * 三条顺序不能换：
   *  ① `receipt.signer` 必须**就是**这条消息已验证过的发送方——否则任何已认证参与方都能
   *     把记录塞进**别人**的回执链（受害方随后自己的诚实回执会被判「断链」，等于把证据链打成 DoS）；
   *  ② 回执签名必须能被该参与方证书公钥验过（`parseAuditReceipt` 只验形状，不验密码学签名）；
   *  ③ 连续性：本条 `prev_receipt_hash` 必须等于该节点上一条的哈希（第一条允许为 null）。
   * 任一不过即拒收并留痕（`accepted: false`，带原因）。
   *
   * 入参 `sender` 来自**消息层已认证的上下文**（证书目录里的公钥），MUST NOT 取自回执正文或信封自述。
   */
  async ingestAuditReceipt(
    raw: unknown,
    sender: { urn: string; publicKey: string },
  ): Promise<{ accepted: boolean; reason?: string }> {
    const receipt = parseAuditReceipt(raw);

    if (receipt.signer !== sender.urn) {
      const reason = `回执 signer（${receipt.signer}）与已认证发送方（${sender.urn}）不符——不得代别人写链`;
      this.logger.warn(`回执被拒：${reason}`);
      return { accepted: false, reason };
    }

    const { sig, ...signed } = receipt;
    if (
      sig.alg !== "SM2-SM3" ||
      !verifyCanonicalObject(signed, sig, sender.publicKey)
    ) {
      const reason = "回执签名验证失败（不是该参与方签发）";
      this.logger.warn(`节点 ${receipt.signer} 的回执被拒：${reason}`);
      return { accepted: false, reason };
    }

    const previous = await this.lastReceipt(receipt.signer, receipt.job_id);
    const expectedPrev = previous ? canonicalSm3(previous.payload) : null;
    if ((receipt.prev_receipt_hash ?? null) !== expectedPrev) {
      const reason = previous
        ? `断链：声明 prev=${receipt.prev_receipt_hash ?? "null"}，实际上一条哈希=${expectedPrev}`
        : `断链：链上还没有该节点的回执，但本条声明了 prev=${receipt.prev_receipt_hash}`;
      this.logger.warn(`节点 ${receipt.signer} 的回执被拒：${reason}`);
      return { accepted: false, reason };
    }
    await this.receipts.save(
      this.receipts.create({
        id: `${receipt.job_id}#${receipt.signer}#${receipt.receipt_id}`,
        jobId: receipt.job_id,
        node: receipt.signer,
        kind: "audit",
        payload: receipt as unknown as Record<string, unknown>,
        prevHash: receipt.prev_receipt_hash,
      }),
    );
    return { accepted: true };
  }

  /** 逐节点校验链的连续性（平台侧与离线工具同判据）。 */
  async verifyChain(node: string, jobId?: string): Promise<ChainVerification> {
    const rows = await this.receipts.find({
      where: jobId ? { node, jobId, kind: "audit" } : { node, kind: "audit" },
      order: { receivedAt: "ASC" },
    });
    let prev: string | null = null;
    for (const [index, row] of rows.entries()) {
      const declared =
        (row.payload as { prev_receipt_hash?: string | null })
          .prev_receipt_hash ?? null;
      if (declared !== prev) {
        return {
          node,
          valid: false,
          length: rows.length,
          brokenAt: (row.payload as { receipt_id?: string }).receipt_id,
          reason: `第 ${index + 1} 条回执的前序哈希对不上（声明 ${declared ?? "null"}，实际 ${prev ?? "null"}）`,
        };
      }
      prev = canonicalSm3(row.payload);
    }
    return { node, valid: true, length: rows.length };
  }

  /** 某节点的链头（最后一条回执的哈希）。 */
  async chainHead(node: string, jobId?: string): Promise<string | null> {
    const last = await this.lastReceipt(node, jobId);
    return last ? canonicalSm3(last.payload) : null;
  }

  /**
   * 锚定链头。链不可达（`AttestationService` 返回本地降级回执）时记 `pending`
   * 并保留在补偿队列里 —— **不返回伪造的交易号**。
   */
  async anchorChainHead(
    node: string,
    jobId: string,
  ): Promise<AnchorResult | null> {
    const head = await this.chainHead(node, jobId);
    if (!head) return null;
    if (!this.attestation) {
      await this.recordAnchor(jobId, node, head, { status: "pending" });
      return { node, chainHead: head, status: "pending" };
    }
    const receipt = await this.attestation.anchor(head, {
      source: "mdop-receipt-chain",
    });
    // `0xLOCAL:` 前缀 = 链不可达时的本地降级回执（见 AttestationService）→ 待上链，不是已锚
    if (receipt.txHash.startsWith("0xLOCAL:")) {
      await this.recordAnchor(jobId, node, head, { status: "pending" });
      this.logger.warn(
        `链不可达，作业 ${jobId} 节点 ${node} 的链头进入补偿队列（待上链）`,
      );
      return { node, chainHead: head, status: "pending" };
    }
    await this.recordAnchor(jobId, node, head, {
      status: "anchored",
      tx_id: receipt.txHash,
      block: receipt.block,
    });
    return {
      node,
      chainHead: head,
      status: "anchored",
      txHash: receipt.txHash,
      block: receipt.block,
    };
  }

  /** 作业终态时锚定全部节点的链头（每 30 分钟的周期锚定由调度方调用同一方法）。 */
  async anchorJobChainHeads(jobId: string): Promise<AnchorResult[]> {
    const rows = await this.receipts.find({ where: { jobId, kind: "audit" } });
    const nodes = [...new Set(rows.map((r) => r.node))];
    const out: AnchorResult[] = [];
    for (const node of nodes) {
      const result = await this.anchorChainHead(node, jobId);
      if (result) out.push(result);
    }
    return out;
  }

  /** 补偿队列内容（待上链的链头，链恢复后可补锚）。 */
  async pendingAnchors(): Promise<MdopReceiptEntity[]> {
    const rows = await this.receipts.find({ where: { kind: "anchor" } });
    return rows.filter(
      (r) => (r.payload as { status?: string }).status === "pending",
    );
  }

  private async lastReceipt(
    node: string,
    jobId?: string,
  ): Promise<MdopReceiptEntity | null> {
    const rows = await this.receipts.find({
      where: jobId ? { node, jobId, kind: "audit" } : { node, kind: "audit" },
      order: { receivedAt: "ASC" },
    });
    return rows.length ? rows[rows.length - 1] : null;
  }

  private async recordAnchor(
    jobId: string,
    node: string,
    chainHead: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.receipts.save(
      this.receipts.create({
        id: `${jobId}#${node}#anchor`,
        jobId,
        node,
        kind: "anchor",
        payload: {
          node,
          chain_head: chainHead,
          at: new Date().toISOString(),
          ...payload,
        },
        prevHash: null,
      }),
    );
  }

  /** 便于离线工具复用：一条回执的哈希口径。 */
  static receiptHash(receipt: AuditReceipt): string {
    return canonicalSm3(receipt);
  }
}
