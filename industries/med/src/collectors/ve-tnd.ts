// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 平台侧**收集** `vaccine-tnd`（疫苗真实世界保护效果，检测阴性设计）的 C3 结果。
 *
 * 为什么是「收集」而不是「合并」（同 `collectPairedCohort`）：TND 的层内 2×2（接种/未接种 × 阳性/阴性）
 * 必须在**可信空间节点内**按 `linkKey` 对齐两方记录才算得出来 —— 疾控只有接种史、医院只有检测结果，
 * 任一方单独都凑不出这张表。平台拿到的已经是那份结果。
 *
 * 这条补齐前，节点交回的 C3 自称 `vaccine-tnd`，而注册面只有 `paired-cohort` / `vaccine-scri`，
 * 于是落到失衡合并器报「只接受四格表」，作业永远到不了 SUCCEEDED（tasks 9.2 报的缺口，
 * 与跨院去重 10.2 同一类）。
 *
 * **多产出节点一律拒**：TND 的两方记录只在同一节点内对齐过，两份各自算出的结果相加没有意义
 * （分母不是同一套人群）。
 */
import type { VeTndResult } from "@medtrust/wasm-algorithms";

export type VeTndAggregate = VeTndResult;

function assertShape(aggregate: VeTndAggregate, node: string): void {
  if (aggregate.analysisType !== "vaccine-tnd")
    throw new Error(
      `收集阶段只接受 vaccine-tnd（节点 ${node} 交来 ${String((aggregate as { analysisType?: string }).analysisType)}）`,
    );
  if (!Array.isArray(aggregate.strata))
    throw new Error(`节点 ${node} 的保护效果结果缺分层表`);
  for (const cell of aggregate.strata) {
    if (typeof cell.key !== "string")
      throw new Error(`节点 ${node} 的分层条目形状非法`);
  }
}

export function collectVeTnd(input: {
  tables: Array<{ node: string; aggregate: VeTndAggregate }>;
}): VeTndAggregate {
  if (input.tables.length === 0) throw new Error("收集阶段没有任何输入表");
  for (const table of input.tables) assertShape(table.aggregate, table.node);
  if (input.tables.length > 1)
    throw new Error(
      "保护效果的层内四格来自单一产出节点；多个产出节点的结果不可相加（分母不是同一套人群），拒绝收集",
    );
  return input.tables[0].aggregate;
}
