// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 平台侧**收集** `dedup-incidence`（跨院去重的发病率与罕见病登记）的 C3 结果。
 *
 * 为什么是「收集」而不是「合并」（同 `collectPairedCohort`）：去重的四件套（人头并集 / 人时区间并集 /
 * 事件按（人,码,日期）去重 / 罕见病按人取最早）**只在可信空间节点内**有全局视图才能算，
 * 平台拿到的已经是那份结果。拿失衡合并器去合它只会抛「只接受四格表」——
 * 这正是 `cross-hospital-dedup-incidence` tasks 10.2 报的缺口。
 *
 * **多产出节点一律拒**：去重是「同一人在多院」这一全局关系的结果，两份各自去重过的结果相加
 * 会把同一个人在两院各算一次，等于把刚去掉的重复又加回来 —— 宁可拒绝也不出悄悄算错的数。
 */
import type { DedupIncidenceResult } from "@medtrust/wasm-algorithms";

export interface DedupIncidenceAggregate extends DedupIncidenceResult {}

function assertShape(aggregate: DedupIncidenceAggregate, node: string): void {
  if (aggregate.analysisType !== "dedup-incidence")
    throw new Error(
      `收集阶段只接受 dedup-incidence（节点 ${node} 交来 ${String((aggregate as { analysisType?: string }).analysisType)}）`,
    );
  if (!Array.isArray(aggregate.strata))
    throw new Error(`节点 ${node} 的去重结果缺分层表`);
  for (const cell of aggregate.strata) {
    if (typeof cell.key !== "string")
      throw new Error(`节点 ${node} 的分层条目形状非法`);
  }
}

export function collectDedupIncidence(input: {
  tables: Array<{ node: string; aggregate: DedupIncidenceAggregate }>;
}): DedupIncidenceAggregate {
  if (input.tables.length === 0) throw new Error("收集阶段没有任何输入表");
  for (const table of input.tables) assertShape(table.aggregate, table.node);
  if (input.tables.length > 1)
    throw new Error(
      "跨院去重的结果来自单一产出节点；多个产出节点的结果不可相加（会把同一人重复计入），拒绝收集",
    );
  return input.tables[0].aggregate;
}
