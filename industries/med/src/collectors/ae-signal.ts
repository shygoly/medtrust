// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 平台侧**合并**（按分类键相加）不良事件信号：`{ analysisType: 'categorical-count', rowCount, buckets }`。
 *
 * 与 `paired-cohort` 的「收集」不同：各院结果是**同形状的分类计数**，平台相加即可。
 * 口径按 design D6：数的是**出现次数**（不是去重主体），所以相加是有意义的（同一人的两起事件就是两起）。
 * 行数（`rowCount`）也相加 —— 它等于各桶之和（回填处的不变量），两句相加后的结论一致。
 */
export interface CategoricalCountAggregate {
  analysisType: "categorical-count";
  rowCount: number;
  buckets: Array<{ key: string; count: number }>;
}

function assertShape(aggregate: CategoricalCountAggregate, node: string): void {
  if (aggregate.analysisType !== "categorical-count")
    throw new Error(
      `不良事件信号合并只接受 categorical-count（节点 ${node} 交来 ${String((aggregate as { analysisType?: string }).analysisType)}）`,
    );
  if (!Array.isArray(aggregate.buckets))
    throw new Error(`节点 ${node} 的分类计数缺 buckets`);
  if (typeof aggregate.rowCount !== "number")
    throw new Error(`节点 ${node} 的分类计数缺 rowCount`);
  for (const cell of aggregate.buckets) {
    if (typeof cell.key !== "string" || typeof cell.count !== "number")
      throw new Error(`节点 ${node} 的分类条目形状非法`);
  }
}

export function mergeAeSignal(input: {
  tables: Array<{ node: string; aggregate: CategoricalCountAggregate }>;
}): CategoricalCountAggregate {
  if (input.tables.length === 0) throw new Error("合并阶段没有任何输入表");
  for (const table of input.tables) assertShape(table.aggregate, table.node);
  if (input.tables.length === 1) return input.tables[0].aggregate;
  const byKey = new Map<string, number>();
  let rows = 0;
  for (const table of input.tables) {
    rows += table.aggregate.rowCount;
    for (const cell of table.aggregate.buckets)
      byKey.set(cell.key, (byKey.get(cell.key) ?? 0) + cell.count);
  }
  return {
    analysisType: "categorical-count",
    rowCount: rows,
    buckets: [...byKey.entries()].map(([key, count]) => ({ key, count })),
  };
}
