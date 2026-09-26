import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  MdopFragmentEntity,
  MdopJobEntity,
  MdopOutboxEntity,
  MdopReceiptEntity,
} from "@medtrust/database";
import {
  MdopError,
  JOB_PURGE_TRIGGER_STATES,
  parsePurgeReceipt,
  verifyCanonicalObject,
  type JobState,
  type PurgeReceipt,
} from "@medtrust/mdop";
import type { MdopReceiptChainService } from "./mdop-receipt-chain.service";

/**
 * 终态销毁编排（任务 7.8 / 协议 §8.5、规格「终态销毁」）。
 *
 * 作业进入 `SUCCEEDED` / `FAILED` / `ABORTED` 后，平台向所有**持有该作业中间制品**的节点
 * 发 `PurgeOrder`；收齐全部有效 `PurgeReceipt` 才进 `PURGED`。
 * 缺回执就按**原幂等键**重发（不生成第二条指令，连接器返回同一回执）。
 * 平台上的 C3 结果（各院投递与合并结果）是交付物，**不列入**销毁范围。
 */
@Injectable()
export class MdopPurgeService {
  private readonly logger = new Logger(MdopPurgeService.name);

  constructor(
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly jobs: Repository<MdopJobEntity>,
    @InjectRepository(MdopFragmentEntity, "controlplane")
    private readonly fragments: Repository<MdopFragmentEntity>,
    @InjectRepository(MdopOutboxEntity, "controlplane")
    private readonly outbox: Repository<MdopOutboxEntity>,
    @InjectRepository(MdopReceiptEntity, "controlplane")
    private readonly receipts: Repository<MdopReceiptEntity>,
    /** 终态锚定回执链头（§10.3）。可选：purge 与 receipt-chain 互相不依赖为硬需求。 */
    @Optional() private readonly receiptChain?: MdopReceiptChainService,
  ) {}

  /** 需要销毁的节点 = 有片段的参与方节点（平台的 C3 交付物不销毁）。 */
  async nodesToPurge(jobId: string, platformNode?: string): Promise<string[]> {
    const rows = await this.fragments.find({ where: { jobId } });
    // 缺省排除**平台自己**：它的片段产出是 C3 交付物，不在销毁范围；否则平台会给自己发
    // PurgeOrder 并等自己的回执，作业永远进不了 PURGED。
    const platform =
      platformNode ??
      `urn:tds:${process.env.SPACE_ID ?? "sh-med"}:participant:platform`;
    return rows
      .map((r) => r.node)
      .filter((node) => node !== platform)
      .sort();
  }

  /**
   * 进入终态后调用：给每个持制品的节点发 `PurgeOrder`（幂等键 `purge:<jobId>`）。
   * 已有回执的节点不再发（重发请用 {@link resendMissing}）。
   */
  async orchestratePurge(
    jobId: string,
    platformNode?: string,
  ): Promise<{ ordered: string[] }> {
    const job = await this.mustGetJob(jobId);
    if (!(JOB_PURGE_TRIGGER_STATES as readonly string[]).includes(job.status))
      throw new MdopError(
        "E_RUNTIME",
        {},
        `作业状态 ${job.status} 不触发销毁（只对 SUCCEEDED/FAILED/ABORTED）`,
      );
    const nodes = await this.nodesToPurge(jobId, platformNode);
    const done = new Set(
      (await this.receipts.find({ where: { jobId, kind: "purge" } })).map(
        (r) => r.node,
      ),
    );
    const ordered: string[] = [];
    for (const node of nodes) {
      if (done.has(node)) continue;
      await this.enqueuePurgeOrder(jobId, node);
      ordered.push(node);
    }
    return { ordered };
  }

  /** 缺回执时按原幂等键重发（连接器对重复 `PurgeOrder` 返回同一回执）。 */
  async resendMissing(
    jobId: string,
    platformNode?: string,
  ): Promise<{ resent: string[] }> {
    const nodes = await this.nodesToPurge(jobId, platformNode);
    const done = new Set(
      (await this.receipts.find({ where: { jobId, kind: "purge" } })).map(
        (r) => r.node,
      ),
    );
    const resent: string[] = [];
    for (const node of nodes) {
      if (done.has(node)) continue;
      await this.enqueuePurgeOrder(jobId, node);
      resent.push(node);
    }
    if (resent.length)
      this.logger.warn(
        `作业 ${jobId} 缺销毁回执，已重发：${resent.join(", ")}`,
      );
    return { resent };
  }

  private async enqueuePurgeOrder(jobId: string, node: string): Promise<void> {
    const id = `PurgeOrder:purge:${jobId}:${node}`;
    const existing = await this.outbox.findOne({ where: { id } });
    if (existing) {
      // 至少一次：同一条指令原样保留（连接器按幂等键返回同一回执）
      return;
    }
    await this.outbox.save(
      this.outbox.create({
        id,
        msg_id: randomUUID(),
        msg_type: "PurgeOrder",
        job_id: jobId,
        receiver: node,
        sender: `urn:tds:${process.env.SPACE_ID ?? "sh-med"}:participant:platform`,
        idempotency_key: `purge:${jobId}`,
        body: { job_id: jobId },
      }),
    );
  }

  /**
   * 收到销毁回执：落库；**收齐全部节点**才进 `PURGED`。
   * 重复回执幂等（同一节点覆盖写，不重复计数）。
   */
  async onPurgeReceipt(
    input: PurgeReceipt,
    /**
     * **消息层已认证的发送方**（URN + 证书公钥）——MUST NOT 取自回执自述。
     *
     * 这两条是「销毁」这个控制能成立的前提：没有它们，任何已认证参与方都能替别家
     * 「宣布已销毁」，把作业推成 `PURGED`，而对方机器上可能还留着制品。
     */
    sender: { urn: string; publicKey: string },
    platformNode?: string,
  ): Promise<{
    received: number;
    expected: number;
    jobStatus: JobState | string;
  }> {
    const receipt = parsePurgeReceipt(input);

    // ① 身份：回执声明的节点必须就是发送方自己
    if (receipt.node !== sender.urn)
      throw new BadRequestException(
        `销毁回执声明的节点（${receipt.node}）与已认证发送方（${sender.urn}）不符——不得替别人宣布已销毁`,
      );
    // ② 签名：形状合法不等于本人签（`parsePurgeReceipt` 只验形状）
    const { sig, ...signed } = receipt;
    if (
      sig.alg !== "SM2-SM3" ||
      !verifyCanonicalObject(signed, sig, sender.publicKey)
    )
      throw new BadRequestException("销毁回执签名验证失败（不是该参与方签发）");

    const job = await this.mustGetJob(receipt.job_id);
    await this.receipts.save(
      this.receipts.create({
        id: `${receipt.job_id}#${receipt.node}#purge`,
        jobId: receipt.job_id,
        node: receipt.node,
        kind: "purge",
        payload: receipt as unknown as Record<string, unknown>,
        prevHash: null,
      }),
    );

    const expected = await this.nodesToPurge(receipt.job_id, platformNode);
    const received = new Set(
      (
        await this.receipts.find({
          where: { jobId: receipt.job_id, kind: "purge" },
        })
      ).map((r) => r.node),
    );
    const allIn = expected.every((node) => received.has(node));
    if (allIn && job.status !== "PURGED") {
      await this.jobs.update(
        { id: receipt.job_id },
        { status: "PURGED", updatedAt: new Date() },
      );
      this.logger.log(`作业 ${receipt.job_id} 收齐销毁回执 → PURGED`);
      // 终态即锚定回执链头（协议 §10.3）。**不给回执链服务注入 purge 服务**，
      // 这里用可选注入避免循环依赖；缺它时由 30 分钟周期锚定补上。
      await this.receiptChain
        ?.anchorJobChainHeads(receipt.job_id)
        .catch((err) =>
          this.logger.warn(`终态锚定失败：${(err as Error).message}`),
        );
    }
    return {
      received: received.size,
      expected: expected.length,
      jobStatus: allIn ? "PURGED" : job.status,
    };
  }

  private async mustGetJob(jobId: string): Promise<MdopJobEntity> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) throw new BadRequestException("作业不存在");
    return job;
  }
}
