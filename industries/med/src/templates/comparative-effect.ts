// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * L2 比较效果计划模板（`mdop-rws-ladder-migration` 任务 3.1）。
 *
 * 每家持有方：`source` → `seal`（投影只留分层与暴露/结局字段）→ 站内效应量 → `declassify.small_cell`。
 * 平台侧用随机效应合并各站交回的效应量 + 标准误，不回收个体行。
 */
import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

import { normalizeHolders } from "./category-dictionaries";

export interface ComparativeEffectTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  holders?: Array<{ participantId: string; dataProductId: string }>;
  hospitals?: Array<{ participantId: string; dataProductId: string }>;
  drug: string;
  outcome: string;
  outcomeKind?: "adverse_event" | "condition";
  stratifyBy?: Array<"ageBand" | "sex">;
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

export function buildComparativeEffectPlan(
  input: ComparativeEffectTemplateInput,
  _space: string,
): LogicalPlanDraft {
  const holders = normalizeHolders(input);
  if (!holders.length) throw new PlanInputError("比较效果至少需要一家持有方");
  if (!input.contracts?.length) throw new PlanInputError("比较效果至少需要一份合约");
  if (!input.drug) throw new PlanInputError("比较效果需指定 drug");
  if (!input.outcome) throw new PlanInputError("比较效果需指定 outcome");
  const seen = new Set<string>();
  for (const holder of holders) {
    if (!holder.participantId) throw new PlanInputError("持有方缺少参与方 id");
    if (seen.has(holder.participantId)) {
      throw new PlanInputError(`比较效果的持有方重复：${holder.participantId}`);
    }
    seen.add(holder.participantId);
  }
  const outcomeKind = input.outcomeKind ?? "adverse_event";
  const stratifyBy = input.stratifyBy ?? ["ageBand"];

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
        projection: "comparative-effect",
      },
    });
    stages.push({
      id: effect,
      op: "rws.comparative-effect@1.0.0",
      inputs: [{ from: seal }],
      params: { drug: input.drug, outcome: input.outcome, outcomeKind, stratifyBy, minCell: input.minCell ?? 5 },
    });
    stages.push({
      id: dec,
      op: "declassify.small_cell@1.0.0",
      inputs: [{ from: effect }],
      params: {
        ...(input.minCell !== undefined ? { minCell: input.minCell } : {}),
        contractId: input.contracts[0],
      },
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

export const comparativeEffectTemplate: PlanTemplate = {
  id: "rws.comparative-effect",
  build(input: unknown, ctx: SpiContext) {
    return buildComparativeEffectPlan(input as ComparativeEffectTemplateInput, ctx.spaceId);
  },
};
