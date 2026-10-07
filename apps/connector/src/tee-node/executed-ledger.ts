import type { NodeStageOutcome } from './stage-dispatch';

/**
 * 可信空间节点的**已执行阶段登记**（`凭证:阶段` → 结果），随节点状态落盘。
 *
 * 为什么它必须独立于内存里的消息路由器、并且落盘：阶段执行有**不可重来的副作用**——
 * 解封要向密钥保管方再要一次密钥（多一份释放凭据），出口要再扣一次查询预算，
 * C3 交付物会带着新的时间戳与预算读数换一个摘要覆盖上一份。此前「执行过没有」只记在内存里：
 *  - 进程一重启就全忘了，而平台的发件箱是至少一次投递——同一份 `StageDispatch` 再来，就整段重跑
 *    （2026-10-07 真机：节点重启后 `scri` 与 `decTee` 各跑了第二遍，预算又记了一次 `used=1/5`）；
 *  - 成功状态上报失败时不登记，下一轮长轮询同样会重跑。
 *
 * 落盘的只有**摘要与标识**（句柄、等级、摘要、计数），没有任何制品内容——与节点状态文件的口径一致。
 */

export interface ExecutedStageEntry {
  /** `凭证:阶段`。 */
  key: string;
  jobId: string;
  /** 登记时间（TTL 清理用）。 */
  at: string;
  outcome: NodeStageOutcome;
  /**
   * 成功状态是否已被平台收下。`false` = 执行完了但平台还不知道——平台重发指令时**只补报**，不重跑。
   */
  statusReported: boolean;
}

/**
 * 保留时长：与节点制品的保留期一致（72 小时）。过了这个点上游制品已到期销毁、凭证也多半过期，
 * 同一阶段不可能再被合法地执行一次，登记留着只会让状态文件无限增长。
 */
export const EXECUTED_STAGE_TTL_MS = 72 * 3_600_000;

export class NodeExecutedStages {
  private readonly entries = new Map<string, ExecutedStageEntry>();

  get(key: string): ExecutedStageEntry | undefined {
    return this.entries.get(key);
  }

  record(input: {
    key: string;
    jobId: string;
    outcome: NodeStageOutcome;
    statusReported: boolean;
    now?: Date;
  }): ExecutedStageEntry {
    const entry: ExecutedStageEntry = {
      key: input.key,
      jobId: input.jobId,
      at: (input.now ?? new Date()).toISOString(),
      outcome: input.outcome,
      statusReported: input.statusReported,
    };
    this.entries.set(input.key, entry);
    return entry;
  }

  markReported(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.statusReported = true;
  }

  size(): number {
    return this.entries.size;
  }

  /** 导出（落盘用）：过期条目不导出，也顺手从内存里清掉。 */
  dump(now: Date = new Date()): ExecutedStageEntry[] {
    for (const [key, entry] of this.entries)
      if (now.getTime() - Date.parse(entry.at) > EXECUTED_STAGE_TTL_MS) this.entries.delete(key);
    return [...this.entries.values()].map((entry) => ({ ...entry, outcome: { ...entry.outcome } }));
  }

  /** 导入（启动恢复用）：形状不对的条目跳过——宁可少记一条（退化为重发时重跑），不把坏数据当成已执行。 */
  import(entries: readonly ExecutedStageEntry[] | undefined, now: Date = new Date()): number {
    let loaded = 0;
    for (const entry of entries ?? []) {
      if (
        !entry ||
        typeof entry.key !== 'string' ||
        typeof entry.jobId !== 'string' ||
        typeof entry.at !== 'string' ||
        !entry.outcome ||
        typeof entry.outcome.digest !== 'string' ||
        typeof entry.outcome.label !== 'string'
      )
        continue;
      if (now.getTime() - Date.parse(entry.at) > EXECUTED_STAGE_TTL_MS) continue;
      this.entries.set(entry.key, {
        key: entry.key,
        jobId: entry.jobId,
        at: entry.at,
        outcome: { ...entry.outcome },
        statusReported: entry.statusReported === true,
      });
      loaded += 1;
    }
    return loaded;
  }
}
