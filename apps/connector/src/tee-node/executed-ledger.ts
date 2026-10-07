import type { NodeStageOutcome } from './stage-dispatch';
import { outstandingReports, type PendingStageReports } from './stage-reports';

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
 * **登记发生在执行完成之后、任何上报之前**，并带着「还欠平台的上报」（`pending`）：
 * 句柄登记、C3 投递、会话见证、回执链哪一步没送达，重发的指令只补那一步（见 `stage-reports.ts`）。
 * 早先登记放在全部上报之后——任何一条上报抛错就等于没登记，阶段照样重跑
 * （2026-10-07 真机 job-muy1ioki-b12ae3e7：一次 `fetch failed` 之后同样两把密钥被放了三次）。
 *
 * 落盘的是**摘要与标识**（句柄、等级、摘要、计数），没有任何制品内容：C3 载荷不进登记，
 * 补投时从节点制品库取（销毁即无）。唯一的例外是**尚未送达的会话见证本体**（证明报告 + 释放凭据）——
 * 它本来就是要交给平台并转给持有方的凭据，保管方不会为同一次释放再出一份；送达即从登记里删掉。
 */

export interface ExecutedStageEntry {
  /** `凭证:阶段`。 */
  key: string;
  jobId: string;
  /** 登记时间（TTL 清理用）。 */
  at: string;
  /** 执行凭证编号（补报时构造出站消息用；旧登记没有它，从 `key` 里取）。 */
  credentialId?: string;
  outcome: NodeStageOutcome;
  /**
   * 成功状态是否已被平台收下。`false` = 执行完了但平台还不知道——平台重发指令时**只补报**，不重跑。
   */
  statusReported: boolean;
  /**
   * 还欠平台的上报（送达一项划掉一项；全部送达后不再有这个字段）。
   * 旧版本写下的登记没有它，等同于「只可能还欠成功状态」。
   */
  pending?: PendingStageReports;
  /**
   * 该作业已按 `PurgeOrder` 销毁：制品不在了，欠着的上报一律作废（**不可再投**）。
   * 登记本身留着——销毁之后再来的指令同样不得把阶段重跑一遍。
   */
  purged?: boolean;
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
    credentialId?: string;
    outcome: NodeStageOutcome;
    statusReported: boolean;
    /** 还欠着的上报。**按引用保存**：调用方随上报进展原地划掉，下一次落盘就是最新进展。 */
    pending?: PendingStageReports;
    now?: Date;
  }): ExecutedStageEntry {
    const entry: ExecutedStageEntry = {
      key: input.key,
      jobId: input.jobId,
      ...(input.credentialId ? { credentialId: input.credentialId } : {}),
      at: (input.now ?? new Date()).toISOString(),
      outcome: input.outcome,
      statusReported: input.statusReported,
      ...(input.pending ? { pending: input.pending } : {}),
    };
    this.entries.set(input.key, entry);
    return entry;
  }

  markReported(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.statusReported = true;
  }

  /**
   * 作业已销毁：它名下各阶段欠着的上报一律作废（见证本体也一并丢掉），并打上 `purged`。
   * 返回受影响的登记条数。
   */
  markJobPurged(jobId: string): number {
    let marked = 0;
    for (const entry of this.entries.values()) {
      if (entry.jobId !== jobId) continue;
      delete entry.pending;
      entry.purged = true;
      marked += 1;
    }
    return marked;
  }

  size(): number {
    return this.entries.size;
  }

  /** 导出（落盘用）：过期条目不导出，也顺手从内存里清掉。 */
  dump(now: Date = new Date()): ExecutedStageEntry[] {
    for (const [key, entry] of this.entries)
      if (now.getTime() - Date.parse(entry.at) > EXECUTED_STAGE_TTL_MS) this.entries.delete(key);
    return [...this.entries.values()].map((entry) => {
      const { pending, ...rest } = entry;
      return {
        ...rest,
        outcome: { ...entry.outcome },
        // 深拷贝：落盘的是这一刻的快照，不能跟着内存里的清单继续变
        ...(pending && outstandingReports(pending).length > 0
          ? { pending: JSON.parse(JSON.stringify(pending)) as PendingStageReports }
          : {}),
      };
    });
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
        ...(typeof entry.credentialId === 'string' ? { credentialId: entry.credentialId } : {}),
        at: entry.at,
        outcome: { ...entry.outcome },
        statusReported: entry.statusReported === true,
        ...(entry.pending && typeof entry.pending === 'object'
          ? { pending: JSON.parse(JSON.stringify(entry.pending)) as PendingStageReports }
          : {}),
        ...(entry.purged === true ? { purged: true } : {}),
      });
      loaded += 1;
    }
    return loaded;
  }
}
