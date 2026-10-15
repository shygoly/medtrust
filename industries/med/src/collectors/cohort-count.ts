// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 平台侧**合并**（相加）`distinct-count` 载荷：队列规模（年龄带）型的第五件套之一。
 *
 * 与 `paired-cohort` / `vaccine-scri` 的「收集」不同：这一型的各院结果**是可以相加的**
 * （同形状的分层人数，平台只汇总）。两种情形：
 *  - 单院：原样返回；
 *  - 多院：按分层键求和，`totalDistinct` 也求和（**口径 = 各院人数相加**；同一主体跨院会各算一次，
 *    跨院去重是 `rws.dedup-incidence` 的分内事）。该口径必须与旧链逐字段对拍后才置 `migrated`。
 */
import type { DistinctCountResult } from "@medtrust/wasm-algorithms";

export type CohortCountAggregate = DistinctCountResult;

function assertShape(aggregate: CohortCountAggregate, node: string): void {
  if (aggregate.analysisType !== "distinct-count")
    throw new Error(
      `队列规模合并只接受 distinct-count（节点 ${node} 交来 ${String((aggregate as { analysisType?: string }).analysisType)}）`,
    );
  if (!Array.isArray(aggregate.strata))
    throw new Error(`节点 ${node} 的计数结果缺分层表`);
  if (typeof aggregate.totalDistinct !== "number")
    throw new Error(`节点 ${node} 的计数结果缺 totalDistinct`);
  for (const cell of aggregate.strata) {
    if (typeof cell.key !== "string" || typeof cell.distinct !== "number")
      throw new Error(`节点 ${node} 的分层条目形状非法`);
  }
}

export function mergeCohortCount(input: {
  tables: Array<{ node: string; aggregate: CohortCountAggregate }>;
}): CohortCountAggregate {
  if (input.tables.length === 0) throw new Error("合并阶段没有任何输入表");
  for (const table of input.tables) assertShape(table.aggregate, table.node);
  if (input.tables.length === 1) return input.tables[0].aggregate;

  // 分层键的先后：按首次出现的顺序（与旧链「按分层键排序后相加」在数值上等价，顺序不影响求和）。
  const byKey = new Map<string, number>();
  let total = 0;
  for (const table of input.tables) {
    total += table.aggregate.totalDistinct;
    for (const cell of table.aggregate.strata)
      byKey.set(cell.key, (byKey.get(cell.key) ?? 0) + cell.distinct);
  }
  return {
    analysisType: "distinct-count",
    totalDistinct: total,
    strata: [...byKey.entries()].map(([key, distinct]) => ({ key, distinct })),
  };
}
