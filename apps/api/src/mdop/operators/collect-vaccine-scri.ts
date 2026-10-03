/**
 * 平台侧**收集**疫苗接种后不良事件 SCRI 的 C3 结果。
 *
 * 与跨院配对同理：计数是在**可信空间节点内**按人对齐后算出来的，平台这一步只收集。
 * 单一产出节点（本场景的正常情形）原样交付、只做形状校验；多个产出节点按分层键求和
 * （前提同 `collect-paired-cohort`：各节点分层是同一套 key，须在合约/模板层面确认）。
 */

export interface VaccineScriCell {
  key: string;
  doses: number;
  riskEvents: number;
  controlEvents: number;
  suppressed?: boolean;
}

export interface VaccineScriAggregate {
  analysisType: "vaccine-scri";
  windows: { risk: [number, number]; control: [number, number] };
  strata: VaccineScriCell[];
  buckets?: Array<{ key: string; count: number; suppressed?: boolean }>;
}

const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

function assertShape(aggregate: VaccineScriAggregate, node: string): void {
  if (aggregate.analysisType !== "vaccine-scri")
    throw new Error(`收集阶段只接受 vaccine-scri（节点 ${node} 交来 ${aggregate.analysisType}）`);
  const w = aggregate.windows;
  if (!w || !Array.isArray(w.risk) || !Array.isArray(w.control))
    throw new Error(`节点 ${node} 的 SCRI 结果缺风险期 / 对照期`);
  if (!Array.isArray(aggregate.strata)) throw new Error(`节点 ${node} 的 SCRI 结果缺分层表`);
  for (const cell of aggregate.strata) {
    if (typeof cell.key !== "string" || ![cell.doses, cell.riskEvents, cell.controlEvents].every(isCount))
      throw new Error(`节点 ${node} 的 SCRI 分层条目形状非法`);
  }
}

export function collectVaccineScri(input: {
  tables: Array<{ node: string; aggregate: VaccineScriAggregate }>;
}): VaccineScriAggregate {
  if (input.tables.length === 0) throw new Error("收集阶段没有任何输入表");
  for (const t of input.tables) assertShape(t.aggregate, t.node);
  if (input.tables.length === 1) {
    const only = input.tables[0].aggregate;
    return { ...only, strata: only.strata.map((c) => ({ ...c })) };
  }
  const byKey = new Map<string, VaccineScriCell>();
  for (const t of input.tables)
    for (const c of t.aggregate.strata) {
      const prev = byKey.get(c.key) ?? { key: c.key, doses: 0, riskEvents: 0, controlEvents: 0 };
      byKey.set(c.key, {
        key: c.key,
        doses: prev.doses + c.doses,
        riskEvents: prev.riskEvents + c.riskEvents,
        controlEvents: prev.controlEvents + c.controlEvents,
        ...(prev.suppressed || c.suppressed ? { suppressed: true } : {}),
      });
    }
  return {
    analysisType: "vaccine-scri",
    windows: input.tables[0].aggregate.windows,
    strata: [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
  };
}
