import { mergeDisproportionalityAggregates } from "../../runtime/rws-orchestrator/disproportionality";
import type {
  RwsAnalysisSpec,
  RwsMergedAggregate,
  RwsPartyAggregate,
} from "../../runtime/rws-orchestrator/types";

/**
 * 平台合并算子 `merge.disproportionality@1`（任务 9.5 / rws-compute 规格）。
 *
 * 平台是合约明示的 **C3 接收方与合并方**（D-MDOP-2），所以只接受 C3 输入。
 * 合并口径**复用现有实现**：`mergeDisproportionalityAggregates` 按 event key 逐格相加，
 * 再重算 PRR / ROR / IC 与 Evans 信号 —— 与旧通道同一条计算路径，保证 §9.7 对拍逐字段一致。
 */

export interface PartyTable {
  node: string;
  aggregate: RwsPartyAggregate;
}

export function mergeProportionality(input: {
  analysis: RwsAnalysisSpec;
  tables: PartyTable[];
}): RwsMergedAggregate {
  if (input.tables.length === 0) throw new Error("合并阶段没有任何输入表");
  for (const table of input.tables) {
    if (table.aggregate.analysisType !== "disproportionality")
      throw new Error(
        `合并阶段只接受失衡检测四格表（收到 ${table.aggregate.analysisType}）`,
      );
  }
  return mergeDisproportionalityAggregates(
    input.analysis,
    input.tables.map((t) => t.aggregate),
  );
}
