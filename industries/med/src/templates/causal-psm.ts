// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * L3 倾向评分计划模板（`mdop-rws-ladder-migration` 任务 3.2）。
 *
 * 每家持有方：`source` → `seal` → 站内 PSM/IPTW → `declassify.small_cell`。
 * 出域只有平均处理效应和标准误，平台做随机效应合并。
 */
import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

import { normalizeHolders } from "./category-dictionaries";

export interface CausalPsmTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  holders?: Array<{ participantId: string; dataProductId: string }>;
  hospitals?: Array<{ participantId: string; dataProductId: string }>;
  drug: string;
  comparator: string;
  outcome: string;
  outcomeKind?: "adverse_event" | "condition";
  method?: "psm" | "iptw";
  stratifyBy?: Array<"ageBand" | "sex">;
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

export function buildCausalPsmPlan(input: CausalPsmTemplateInput, _space: string): LogicalPlanDraft {
  const holders = normalizeHolders(input);
  if (!holders.length) throw new PlanInputError("因果分析至少需要一家持有方");
  if (!input.contracts?.length) throw new PlanInputError("因果分析至少需要一份合约");
  if (!input.drug) throw new PlanInputError("因果分析需指定 drug");
  if (!input.comparator) throw new PlanInputError("因果分析需指定 comparator");
  if (input.drug === input.comparator) throw new PlanInputError("暴露臂与对照臂不能相同");
  if (!input.outcome) throw new PlanInputError("因果分析需指定 outcome");
  const method = input.method ?? "psm";
  if (method !== "psm" && method !== "iptw") throw new PlanInputError("方法只能是 psm 或 iptw");
  const seen = new Set<string>();
  for (const holder of holders) {
    if (!holder.participantId) throw new PlanInputError("持有方缺少参与方 id");
    if (seen.has(holder.participantId)) {
      throw new PlanInputError(`因果分析的持有方重复：${holder.participantId}`);
    }
    seen.add(holder.participantId);
  }
  const outcomeKind = input.outcomeKind ?? "adverse_event";
  const stratifyBy = input.stratifyBy ?? ["ageBand", "sex"];
  const minCell = input.minCell ?? 5;

  const stages: LogicalPlanDraft["stages"] = [];
  for (const holder of holders) {
    const node = holder.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const seal = `seal_${suffix}`;
    const effect = `effect_${suffix}`;
    const dec = `dec_${suffix}`;
    stages.push({
      id: src,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${node}/${holder.dataProductId}` }],
      params: { uri: `ds://${node}/${holder.dataProductId}` },
    });
    stages.push({
      id: seal,
      op: "seal.envelope@1.0.0",
      inputs: [{ from: src }],
      params: {
        contractId: input.contracts[0],
        projection: "causal-psm",
      },
    });
    stages.push({
      id: effect,
      op: "rws.causal-psm@1.0.0",
      inputs: [{ from: seal }],
      params: {
        drug: input.drug,
        comparator: input.comparator,
        outcome: input.outcome,
        outcomeKind,
        method,
        stratifyBy,
        minCell,
      },
    });
    stages.push({
      id: dec,
      op: "declassify.small_cell@1.0.0",
      inputs: [{ from: effect }],
      params: { minCell, contractId: input.contracts[0] },
    });
  }

  return {
    purpose: input.purpose,
    applicant: input.applicant,
    contracts: input.contracts,
    stages,
    ...(input.ethicsRef ? { ethics_ref: input.ethicsRef } : {}),
    not_before: input.notBefore,
    not_after: input.notAfter,
  };
}

export const causalPsmTemplate: PlanTemplate = {
  id: "rws.causal-psm",
  build(input: unknown, ctx: SpiContext) {
    return buildCausalPsmPlan(input as CausalPsmTemplateInput, ctx.spaceId);
  },
};
