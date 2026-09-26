import { Injectable, Logger } from '@nestjs/common';
import { MdopError, canonicalSm3 } from '@medtrust/mdop';
import { signSm2 } from '../../domain/sm2-sign';
import { connectorPublicKey } from '../../domain/connector-key';

/**
 * 节点本地制品与销毁（任务 3.10、协议 §8.5）。
 *
 * 两点硬要求：
 *  ① **销毁是"物理"的**：删掉记录的同时把载荷引用置空，之后按句柄读取必须失败（不是打标记）；
 *  ② **重复指令返回同一回执**：`PurgeOrder` 是至少一次投递，第二条指令不该产出第二份回执
 *     （否则平台侧的"回执集合"会出现同一节点两条不同内容）。
 *
 * 回执按顺序列出被销毁的句柄并签名——平台据此核对「这个节点确实处理过这些制品并已销毁」。
 */

export interface NodeArtifactRecord {
  handle: string;
  jobId: string;
  label: string;
  digest: string;
  /** 载荷（密文或节点内的中间结果）。销毁即删除。 */
  payload: Record<string, unknown>;
  expiresAt: string;
}

export interface NodePurgeReceipt {
  receipt_id: string;
  job_id: string;
  node: string;
  reason: 'purge-order' | 'ttl' | 'job-failed';
  handles: string[];
  destroyed_at: string;
  idempotency_key: string;
  sig: { alg: string; kid: string; value: string };
}

@Injectable()
export class NodeArtifactStore {
  private readonly logger = new Logger(NodeArtifactStore.name);
  private readonly artifacts = new Map<string, NodeArtifactRecord>();
  private readonly purgeReceipts = new Map<string, NodePurgeReceipt>();

  constructor(private readonly deps: { node: string; privateKey?: string }) {}

  put(record: NodeArtifactRecord): void {
    // 句柄唯一：同句柄重复写入视为覆盖（重放同一阶段时不应产生两份制品）
    this.artifacts.set(record.handle, record);
  }

  /** 读制品；已销毁或不存在返回 null。 */
  read(handle: string): NodeArtifactRecord | null {
    return this.artifacts.get(handle) ?? null;
  }

  listJob(jobId: string): NodeArtifactRecord[] {
    return [...this.artifacts.values()].filter((a) => a.jobId === jobId);
  }

  /** 导出全部制品（落盘用；任务 3.16）。销毁后调 `dump()` 自然不含已被销毁的行。 */
  dump(): NodeArtifactRecord[] {
    return [...this.artifacts.values()].map((a) => ({ ...a }));
  }

  /** 从落盘快照恢复（重启后仍可按句柄读取；已销毁的不在快照里，因此仍然是「读不到」）。 */
  import(records: readonly NodeArtifactRecord[]): number {
    for (const record of records) this.artifacts.set(record.handle, { ...record });
    return records.length;
  }

  /**
   * 销毁某作业在本节点的全部制品并出签名回执。
   * 幂等：同一 `idempotencyKey` 重复调用返回**同一份回执**（首次销毁时句柄集合已固定）。
   */
  purge(input: {
    jobId: string;
    reason: NodePurgeReceipt['reason'];
    idempotencyKey: string;
    now?: Date;
  }): NodePurgeReceipt {
    const existing = this.purgeReceipts.get(input.idempotencyKey);
    if (existing) return existing;

    const rows = this.listJob(input.jobId);
    const handles = rows.map((r) => r.handle);
    for (const row of rows) this.artifacts.delete(row.handle);

    const now = input.now ?? new Date();
    const payload = {
      receipt_id: `node-purge:${input.jobId}:${input.reason}`,
      job_id: input.jobId,
      node: this.deps.node,
      reason: input.reason,
      handles,
      destroyed_at: now.toISOString(),
      idempotency_key: input.idempotencyKey,
    };
    const privateKey = this.privateKey();
    const receipt: NodePurgeReceipt = {
      ...payload,
      sig: {
        alg: 'SM2-SM3',
        kid: canonicalSm3(connectorPublicKey(privateKey)).replace(/^sm3:/, ''),
        value: signSm2(canonicalSm3(payload), privateKey),
      },
    };
    this.purgeReceipts.set(input.idempotencyKey, receipt);
    this.logger.log(`节点销毁完成 job=${input.jobId} handles=${handles.length} reason=${input.reason}`);
    return receipt;
  }

  /** TTL 到期自主销毁（无需平台指令），返回逐作业的句柄集合。 */
  sweepExpired(now: Date = new Date()): Array<{ jobId: string; handles: string[] }> {
    const byJob = new Map<string, string[]>();
    for (const row of [...this.artifacts.values()]) {
      if (Date.parse(row.expiresAt) > now.getTime()) continue;
      this.artifacts.delete(row.handle);
      const list = byJob.get(row.jobId) ?? [];
      list.push(row.handle);
      byJob.set(row.jobId, list);
    }
    return [...byJob.entries()].map(([jobId, handles]) => ({ jobId, handles }));
  }

  private privateKey(): string {
    const key = this.deps.privateKey ?? process.env.CONNECTOR_SM2_PRIVATE_KEY ?? '';
    if (!key) throw new MdopError('E_RUNTIME', {}, '节点未配置私钥，无法签销毁回执');
    return key;
  }
}
