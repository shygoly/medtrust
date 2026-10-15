// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * L3 生存分析计划模板（`mdop-rws-ladder-migration` 任务 3.3）。
 *
 * 每家持有方：`source` → `seal` → 站内 Cox 与分箱生存曲线 → `declassify.small_cell`。
 * 出域是 log HR + 标准误，以及在险人数过阈值的分箱曲线。
 */
import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

import { normalizeHolders } from "./category-dictionaries";

export interface CausalSurvivalTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  holders?: Array<{ participantId: string; dataProductId: string }>;
  hospitals?: Array<{ participantId: string; dataProductId: string }>;
  drug: string;
  comparator: string;
  outcome: string;
  outcomeKind?: "adverse_event" | "condition";
  binWidthDays?: number;
  minCell?: number;
  /**
   * D-RWS-10 / P-EVD-11：匹配策略须由请求方显式声明（必填，不接受缺省）。
   * MDOP 通道只有层内配对一种实际行为，声明其他值即拒（fail-closed，不静默忽略）。
   */
  matchingStrategy: "within-stratum" | "cross-stratum-nearest";
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

export function buildCausalSurvivalPlan(
  input: CausalSurvivalTemplateInput,
  _space: string,
): LogicalPlanDraft {
  const holders = normalizeHolders(input);
  if (!holders.length) throw new PlanInputError("生存分析至少需要一家持有方");
  if (!input.contracts?.length) throw new PlanInputError("生存分析至少需要一份合约");
  if (!input.drug) throw new PlanInputError("生存分析需指定 drug");
  if (!input.comparator) throw new PlanInputError("生存分析需指定 comparator");
  if (input.drug === input.comparator) throw new PlanInputError("暴露臂与对照臂不能相同");
  if (!input.outcome) throw new PlanInputError("生存分析需指定 outcome");
  if (!input.matchingStrategy) {
    throw new PlanInputError(
      "生存分析须预先声明匹配策略 matchingStrategy（D-RWS-10 / P-EVD-11；" +
        "MDOP 通道只接受 within-stratum，不接受缺省）",
    );
  }
  if (input.matchingStrategy !== "within-stratum") {
    throw new PlanInputError(
      `声明的匹配策略 "${input.matchingStrategy}" 与 MDOP 通道实际配对行为 "within-stratum" 不一致：` +
        "MDOP 定点模块只做层内 1:1 配对（不跨层）；cross-stratum-nearest 是旧链 estimate_psm " +
        "的跨层就近口径（D-RWS-10②，两者非同一估计量），经 MDOP 入口提交即拒",
    );
  }
  if (input.binWidthDays !== undefined && input.binWidthDays < 1) {
    throw new PlanInputError("分箱宽度至少 1 天");
  }
  const seen = new Set<string>();
  for (const holder of holders) {
    if (!holder.participantId) throw new PlanInputError("持有方缺少参与方 id");
    if (seen.has(holder.participantId)) {
      throw new PlanInputError(`生存分析的持有方重复：${holder.participantId}`);
    }
    seen.add(holder.participantId);
  }
  const outcomeKind = input.outcomeKind ?? "condition";
  const binWidthDays = input.binWidthDays ?? 30;
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
      params: { contractId: input.contracts[0], projection: "causal-survival" },
    });
    stages.push({
      id: effect,
      op: "rws.causal-survival@1.0.0",
      inputs: [{ from: seal }],
      params: {
        drug: input.drug,
        comparator: input.comparator,
        outcome: input.outcome,
        outcomeKind,
        binWidthDays,
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

export const causalSurvivalTemplate: PlanTemplate = {
  id: "rws.causal-survival",
  build(input: unknown, ctx: SpiContext) {
    return buildCausalSurvivalPlan(input as CausalSurvivalTemplateInput, ctx.spaceId);
  },
};
