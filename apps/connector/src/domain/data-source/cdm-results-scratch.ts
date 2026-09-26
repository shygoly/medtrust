// omop-data-source-access —— results schema 中间结果留存治理（tasks 6.1–6.3）。
//
// `results` 在**医院的库**里：连接器在那儿建的每一张表都是医院替我们保管的东西，
// 不能无限堆积。三条规矩：
//
//   · 命名：mt_<UTC 建表时刻 YYYYMMDDHHMM>_<任务标识 12 位>_<用途>——看名字就知道
//     是谁、什么时候、为哪个任务建的；任务标识是任务号的 SM3 前缀，不把任务号写进医院库。
//   · 任务结束即删，**不看留存条款的长短**：留存条款是上限不是下限，立即删除满足任何条款；
//     而「保留一个可追溯窗口」与阅后即焚冲突（design 未决 2，按此定夺）。
//   · 周期兜底：进程崩溃留下的表，超过宽限期且不属于本进程在跑的任务，就删。
//
// 清理**只碰**当前账号拥有、且符合上面命名约定的表——医院放在 results 里的其它东西永远不动。
import { sm3Hex } from '../sm3';
import { CdmExecutor } from './cdm-executor';

const TABLE_NAME = /^mt_(\d{12})_([0-9a-f]{12})_([a-z0-9_]{1,30})$/;
const PURPOSE = /^[a-z][a-z0-9_]{0,29}$/;

/** 任务号 → 12 位任务标识（SM3 前缀）。 */
export function resultsTaskTag(taskId: string): string {
  return sm3Hex(taskId).slice(0, 12);
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHMM（UTC）
}

export interface ResultsTable {
  /** 表名（不带 schema）。 */
  table: string;
  /** 已引用的限定名，可直接拼进 SQL。 */
  qualified: string;
}

export class CdmResultsScratch {
  /** 本进程正在使用 results 的任务——兜底清理不碰它们。 */
  private readonly active = new Set<string>();

  constructor(
    private readonly executor: CdmExecutor,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** 为任务分配一张中间结果表（只分配名字，建表由调用方的 SQL 完成）。 */
  tableFor(taskId: string, purpose: string): ResultsTable {
    if (!PURPOSE.test(purpose)) {
      throw new Error(`中间结果表用途名须为小写字母开头的 [a-z0-9_]{1,30}：${purpose}`);
    }
    const tag = resultsTaskTag(taskId);
    this.active.add(tag);
    const table = `mt_${stamp(this.clock())}_${tag}_${purpose}`;
    return {
      table,
      qualified: this.executor.dialect.qualify(this.executor.config.schemas.results, table),
    };
  }

  /**
   * 任务结束：删掉该任务在 results 里的**全部**中间表。按库里的目录删而不是按内存记账——
   * 同一任务此前崩溃重试留下的表也一并清掉。
   */
  async dropTask(taskId: string): Promise<string[]> {
    const tag = resultsTaskTag(taskId);
    try {
      return await this.dropWhere((m) => m.tag === tag);
    } finally {
      this.active.delete(tag);
    }
  }

  /** 周期兜底：超过宽限期、且不属于本进程在跑任务的中间表。 */
  async sweep(graceMs: number): Promise<string[]> {
    const cutoff = stamp(new Date(this.clock().getTime() - graceMs));
    return this.dropWhere((m) => !this.active.has(m.tag) && m.stamp < cutoff);
  }

  private async dropWhere(pred: (m: { stamp: string; tag: string }) => boolean): Promise<string[]> {
    const { dialect, config } = this.executor;
    const rows = await this.executor.query<{ tablename: string }>({
      text: dialect.ownedTablesQuery(),
      values: [config.schemas.results],
    });
    const dropped: string[] = [];
    for (const { tablename } of rows) {
      const m = TABLE_NAME.exec(tablename);
      if (!m || !pred({ stamp: m[1], tag: m[2] })) continue;
      await this.executor.query({
        text: `DROP TABLE IF EXISTS ${dialect.qualify(config.schemas.results, tablename)}`,
      });
      dropped.push(tablename);
    }
    return dropped;
  }
}
