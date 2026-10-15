// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * L0 算法校验计划模板（`mdop-rws-ladder-migration` 任务 3.4）。
 *
 * 每家持有方：`source` → `seal`（只留标签和分数）→ 站内校验指标 → `declassify.small_cell`。
 */
import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

import { normalizeHolders } from "./category-dictionaries";

export interface AlgorithmValidationTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  holders?: Array<{ participantId: string; dataProductId: string }>;
  hospitals?: Array<{ participantId: string; dataProductId: string }>;
  scoreField?: string;
  labelField?: string;
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

export function buildAlgorithmValidationPlan(
  input: AlgorithmValidationTemplateInput,
  _space: string,
): LogicalPlanDraft {
  const holders = normalizeHolders(input);
  if (!holders.length) throw new PlanInputError("算法校验至少需要一家持有方");
  if (!input.contracts?.length) throw new PlanInputError("算法校验至少需要一份合约");
  const scoreField = input.scoreField ?? "score";
  const labelField = input.labelField ?? "eventOccurred";
  if (!scoreField || !labelField) throw new PlanInputError("算法校验需指定分数和标签字段");
  const seen = new Set<string>();
  for (const holder of holders) {
    if (!holder.participantId) throw new PlanInputError("持有方缺少参与方 id");
    if (seen.has(holder.participantId)) {
      throw new PlanInputError(`算法校验的持有方重复：${holder.participantId}`);
    }
    seen.add(holder.participantId);
  }
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
        projection: "score-label",
        scoreField,
        labelField,
      },
    });
    stages.push({
      id: effect,
      op: "rws.algorithm-validation@1.0.0",
      inputs: [{ from: seal }],
      params: { scoreField, labelField, minCell },
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

export const algorithmValidationTemplate: PlanTemplate = {
  id: "rws.algorithm-validation",
  build(input: unknown, ctx: SpiContext) {
    return buildAlgorithmValidationPlan(input as AlgorithmValidationTemplateInput, ctx.spaceId);
  },
};
