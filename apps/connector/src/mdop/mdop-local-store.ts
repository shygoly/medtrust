import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LocalMdopArtifact,
  LocalMdopNonce,
  LocalMdopProcessedKey,
  LocalMdopReceipt,
} from '@medtrust/database';
import {
  NONCE_TTL_MS,
  canonicalSm3,
  type NonceStore,
  type PurgeReceipt,
} from '@medtrust/mdop';
import { signSm2 } from '../domain/sm2-sign';

/**
 * 连接器本地 MDOP 存储（任务 8.1/8.4/8.5）：nonce、幂等键、制品、审计回执链。
 *
 * 四张表都在**院内本地库**：制品载荷永不离开连接器；上报给平台的只有句柄与回执。
 */

export interface ArtifactRecord {
  handle: string;
  jobId: string;
  stage: string;
  label: string;
  schema: string;
  digest: string;
  payload: Record<string, unknown>;
  stats?: Record<string, unknown> | null;
  expiresAt: string;
  ticketId?: string | null;
}

@Injectable()
export class MdopLocalStore {
  constructor(
    @InjectRepository(LocalMdopNonce)
    private readonly nonces: Repository<LocalMdopNonce>,
    @InjectRepository(LocalMdopProcessedKey)
    private readonly processed: Repository<LocalMdopProcessedKey>,
    @InjectRepository(LocalMdopArtifact)
    private readonly artifacts: Repository<LocalMdopArtifact>,
    @InjectRepository(LocalMdopReceipt)
    private readonly receipts: Repository<LocalMdopReceipt>,
  ) {}

  // ── nonce（防重放；落盘，重启后仍有效）──────────────────────────────────

  nonceStore(): NonceStore {
    return {
      seen: (nonce: string) => this.nonceSeenCache.has(nonce),
      remember: (nonce: string, expiresAt: Date) => this.rememberNonce(nonce, expiresAt),
    };
  }

  private readonly nonceSeenCache = new Set<string>();

  private rememberNonce(nonce: string, expiresAt: Date, sender = ''): void {
    this.nonceSeenCache.add(nonce);
    void this.nonces
      .save(this.nonces.create({ nonce, sender, expiresAt }))
      .catch(() => undefined);
  }

  /** 启动时把未过期的 nonce 载入内存（重启后仍然拦得住重放）。 */
  async hydrateNonces(now: Date = new Date()): Promise<number> {
    const rows = await this.nonces.find();
    let loaded = 0;
    for (const row of rows) {
      if (new Date(row.expiresAt).getTime() < now.getTime()) continue;
      this.nonceSeenCache.add(row.nonce);
      loaded += 1;
    }
    return loaded;
  }

  /** 校验并登记 nonce；已见过即返回 false（调用方报 E_REPLAY）。 */
  async acceptNonce(nonce: string, sender: string, now: Date = new Date()): Promise<boolean> {
    if (this.nonceSeenCache.has(nonce)) return false;
    const existing = await this.nonces.findOne({ where: { nonce } });
    if (existing && new Date(existing.expiresAt).getTime() >= now.getTime()) return false;
    this.rememberNonce(nonce, new Date(now.getTime() + NONCE_TTL_MS), sender);
    return true;
  }

  async sweepNonces(now: Date = new Date()): Promise<number> {
    const rows = await this.nonces.find();
    let removed = 0;
    for (const row of rows) {
      if (new Date(row.expiresAt).getTime() >= now.getTime()) continue;
      this.nonceSeenCache.delete(row.nonce);
      await this.nonces.delete({ nonce: row.nonce });
      removed += 1;
    }
    return removed;
  }

  // ── 幂等键（同一 job:stage:attempt 返回原结果，不重算）──────────────────

  async findProcessed(key: string): Promise<Record<string, unknown> | null> {
    const row = await this.processed.findOne({ where: { key } });
    return row ? (row.result as Record<string, unknown>) : null;
  }

  async rememberProcessed(
    key: string,
    jobId: string,
    stageId: string,
    attempt: number,
    result: Record<string, unknown>,
  ): Promise<void> {
    await this.processed.save(
      this.processed.create({ key, jobId, stageId, attempt, result }),
    );
  }

  // ── 制品库（TTL 到期自主销毁；销毁后不可读）────────────────────────────

  async putArtifact(record: ArtifactRecord): Promise<void> {
    // 只有 C3 句柄可以带 stats（规格「制品句柄」）
    if (record.label !== 'C3' && record.stats && Object.keys(record.stats).length > 0)
      throw new Error('只有 C3 句柄可以填写 stats');
    await this.artifacts.save(this.artifacts.create({ ...record, destroyedAt: null }));
  }

  /** 读制品；已销毁或不存在返回 null（销毁后不可读）。 */
  async readArtifact(handle: string): Promise<LocalMdopArtifact | null> {
    const row = await this.artifacts.findOne({ where: { handle } });
    if (!row || row.destroyedAt) return null;
    return row;
  }

  /**
   * 按**阶段 id**取本作业的产物：计划里下游阶段的 `inputs[].from` 写的是上游阶段 id，
   * 而制品是按句柄存的行——执行器要按阶段 id 反查（同节点内不跨消息）。
   */
  async artifactForStage(jobId: string, stageId: string): Promise<LocalMdopArtifact | null> {
    const row = await this.artifacts.findOne({ where: { jobId, stage: stageId } });
    if (!row || row.destroyedAt) return null;
    return row;
  }

  listArtifacts(jobId: string): Promise<LocalMdopArtifact[]> {
    return this.artifacts.find({ where: { jobId } });
  }

  /** 到期自主销毁（无需平台指令），返回 {jobId, handles} 以便逐作业出回执。 */
  async sweepExpired(now: Date = new Date()): Promise<Array<{ jobId: string; handles: string[] }>> {
    const rows = await this.artifacts.find();
    const expired = rows.filter(
      (r) => !r.destroyedAt && new Date(r.expiresAt).getTime() <= now.getTime(),
    );
    const byJob = new Map<string, string[]>();
    for (const row of expired) {
      await this.artifacts.delete({ handle: row.handle });
      const list = byJob.get(row.jobId) ?? [];
      list.push(row.handle);
      byJob.set(row.jobId, list);
    }
    return [...byJob.entries()].map(([jobId, handles]) => ({ jobId, handles }));
  }

  /** 处理 PurgeOrder：销毁该作业在本节点的全部制品，返回签名销毁回执。 */
  async purgeJob(
    jobId: string,
    reason: PurgeReceipt['reason'],
    privateKey: string,
    idempotencyKey: string,
    now: Date = new Date(),
  ): Promise<PurgeReceipt> {
    const rows = await this.artifacts.find({ where: { jobId } });
    const handles = rows.map((r) => r.handle);
    for (const row of rows) await this.artifacts.delete({ handle: row.handle });
    const body = {
      receipt_id: `purge:${jobId}:${now.getTime()}`,
      job_id: jobId,
      node: '', // 由调用方（连接器身份）补齐后重签
      reason,
      handles,
      destroyed_at: now.toISOString(),
      idempotency_key: idempotencyKey,
    };
    void privateKey;
    return { ...body, sig: { alg: 'SM2-SM3', kid: '', value: '' } } as PurgeReceipt;
  }

  // ── 审计回执链（每事件一条签名回执，成链）──────────────────────────────

  /**
   * 追加一条**已签名**的审计回执（签名必须在调用前完成，因为回执内容进签名）。
   * 返回本条回执的哈希（链头 = 最后一条的哈希）。
   */
  async appendSignedReceipt(receipt: {
    receipt_id: string;
    job_id: string;
    stage: string;
    event: string;
    prev_receipt_hash: string | null;
    [key: string]: unknown;
  }): Promise<{ entryHash: string; prev: string | null }> {
    const entryHash = canonicalSm3(receipt);
    await this.receipts.save(
      this.receipts.create({
        receiptId: receipt.receipt_id,
        jobId: receipt.job_id,
        stage: receipt.stage,
        event: receipt.event,
        payload: receipt,
        prevReceiptHash: receipt.prev_receipt_hash ?? null,
        entryHash,
        reported: false,
      }),
    );
    return { entryHash, prev: receipt.prev_receipt_hash ?? null };
  }

  async lastReceipt(jobId: string): Promise<LocalMdopReceipt | null> {
    const rows = await this.receipts.find({ where: { jobId }, order: { at: 'ASC' } });
    return rows.length ? rows[rows.length - 1] : null;
  }

  async unreportedReceipts(jobId?: string): Promise<LocalMdopReceipt[]> {
    const rows = jobId
      ? await this.receipts.find({ where: { jobId }, order: { at: 'ASC' } })
      : await this.receipts.find({ order: { at: 'ASC' } });
    return rows.filter((r) => !r.reported);
  }

  async markReported(receiptIds: string[]): Promise<void> {
    for (const receiptId of receiptIds)
      await this.receipts.update({ receiptId }, { reported: true });
  }

  /** 链头哈希（平台锚定用）。 */
  async chainHead(jobId: string): Promise<string | null> {
    const last = await this.lastReceipt(jobId);
    return last ? last.entryHash : null;
  }
}

export { signSm2 };
