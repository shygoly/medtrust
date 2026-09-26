/**
 * 平台侧**收集** `paired-cohort`（跨院主体配对）的 C3 结果（任务 3.12c）。
 *
 * 与 `merge.disproportionality` 的区别要说清：失衡检测是「各院各算四格表、平台加总」，
 * 所以有真正的**合并**算子；而跨院配对是**在可信空间节点内**对各方数据做的，
 * 节点出来就是那份结果——平台在这一步是**收集方**，不是把各院的局部量拼起来。
 *
 * 两种情形：
 *  - **单一产出节点**（本场景的正常情形）：结果原样交付，只做形状校验；
 *  - **多个产出节点**（异常/未来多节点分片）：按分层 key **求和**并重算率。
 *    这是保守口径——它假设各节点的分层是同一套 key（同一批数据的不同分片），
 *    若 key 空间不同，求和只会把两批互不相干的数加在一起；因此多节点情形必须
 *    在合约/模板层面确认过再启用（本场景不会出现）。
 */

export interface PairedCohortCell {
  key: string;
  exposed: number;
  outcome: number;
  exposedWithOutcome: number;
  cohortSize: number;
  rate: number;
}

export interface PairedCohortAggregate {
  analysisType: "paired-cohort";
  /** 配对后的交集规模。 */
  cohortSize: number;
  exposed: number;
  outcome: number;
  exposedWithOutcome: number;
  rate: number;
  strata: PairedCohortCell[];
}

function assertShape(aggregate: PairedCohortAggregate, node: string): void {
  if (aggregate.analysisType !== "paired-cohort")
    throw new Error(
      `收集阶段只接受 paired-cohort（节点 ${node} 交来 ${aggregate.analysisType}）`,
    );
  if (!Array.isArray(aggregate.strata))
    throw new Error(`节点 ${node} 的配对结果缺分层表`);
  for (const cell of aggregate.strata) {
    if (typeof cell.key !== "string" || typeof cell.exposed !== "number")
      throw new Error(`节点 ${node} 的分层条目形状非法`);
  }
}

export function collectPairedCohort(input: {
  tables: Array<{ node: string; aggregate: PairedCohortAggregate }>;
}): PairedCohortAggregate {
  if (input.tables.length === 0) throw new Error("收集阶段没有任何输入表");
  for (const table of input.tables) assertShape(table.aggregate, table.node);

  if (input.tables.length === 1) {
    const only = input.tables[0].aggregate;
    return { ...only, strata: only.strata.map((c) => ({ ...c })) };
  }

  const byKey = new Map<string, PairedCohortCell>();
  let cohortSize = 0;
  let exposed = 0;
  let outcome = 0;
  let both = 0;
  for (const { aggregate } of input.tables) {
    cohortSize += aggregate.cohortSize;
    exposed += aggregate.exposed;
    outcome += aggregate.outcome;
    both += aggregate.exposedWithOutcome;
    for (const cell of aggregate.strata) {
      const prev = byKey.get(cell.key) ?? {
        key: cell.key,
        exposed: 0,
        outcome: 0,
        exposedWithOutcome: 0,
        cohortSize: 0,
        rate: 0,
      };
      prev.exposed += cell.exposed;
      prev.outcome += cell.outcome;
      prev.exposedWithOutcome += cell.exposedWithOutcome;
      prev.cohortSize += cell.cohortSize;
      prev.rate =
        prev.exposed === 0 ? 0 : prev.exposedWithOutcome / prev.exposed;
      byKey.set(cell.key, prev);
    }
  }
  return {
    analysisType: "paired-cohort",
    cohortSize,
    exposed,
    outcome,
    exposedWithOutcome: both,
    rate: exposed === 0 ? 0 : both / exposed,
    strata: [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
  };
}

/** 判断一批 C3 载荷是不是配对结果（合并服务据此分派）。 */
export function isPairedCohort(aggregate: Record<string, unknown>): boolean {
  return aggregate?.analysisType === "paired-cohort";
}
