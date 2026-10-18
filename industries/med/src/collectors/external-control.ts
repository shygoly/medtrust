// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * Collect the C3 produced by the single trusted-space node that ran
 * `rws.external-control`. Matching already happened inside the node, so the
 * platform must not apply the disproportionality four-cell merger here.
 */
export interface ExternalControlCell {
  key: string;
  mExpPos: number;
  mExpNeg: number;
  ctlPos: number;
  ctlNeg: number;
  matched: number;
  unmatched: number;
}

export interface ExternalControlAggregate {
  analysisType: "external-control";
  caliperDays: number;
  ratioK: number;
  strata: ExternalControlCell[];
  buckets?: Array<{ key: string; count: number }>;
  [key: string]: unknown;
}

function assertShape(
  aggregate: ExternalControlAggregate,
  node: string,
): void {
  if (aggregate.analysisType !== "external-control") {
    throw new Error(
      `收集阶段只接受 external-control（节点 ${node} 交来 ${String((aggregate as { analysisType?: string }).analysisType)}）`,
    );
  }
  if (!Array.isArray(aggregate.strata)) {
    throw new Error(`节点 ${node} 的外部对照结果缺分层表`);
  }
  for (const cell of aggregate.strata) {
    if (
      typeof cell.key !== "string" ||
      ![
        cell.mExpPos,
        cell.mExpNeg,
        cell.ctlPos,
        cell.ctlNeg,
        cell.matched,
        cell.unmatched,
      ].every((value) => typeof value === "number")
    ) {
      throw new Error(`节点 ${node} 的外部对照分层条目形状非法`);
    }
  }
}

export function collectExternalControl(input: {
  tables: Array<{ node: string; aggregate: ExternalControlAggregate }>;
}): ExternalControlAggregate {
  if (input.tables.length === 0) throw new Error("收集阶段没有任何输入表");
  for (const table of input.tables) assertShape(table.aggregate, table.node);
  if (input.tables.length > 1) {
    throw new Error(
      "外部对照的匹配结果来自单一可信空间节点；多个节点的结果不可相加，拒绝收集",
    );
  }
  return structuredClone(input.tables[0].aggregate);
}
