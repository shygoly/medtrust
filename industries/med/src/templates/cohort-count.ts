// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 队列规模（年龄带）`rws.cohort-count` 计划模板 —— 批次 2（`mdop-rws-ladder-migration`）的**第一型**。
 *
 * 它的迁移难度最低（design D1 的「平台侧合并组」）：各院各算**同形状的分层去重人数**，平台只相加，
 * 不需要节点内计算、不需要 C2 目标、不需要新算子 —— 用的是清单里已有的通用模块 `distinct-count`。
 *
 * 语义边界（必须在迁移对拍里确认，不得想当然）：这里的口径是**各院分层人数相加**；同一主体若在两院
 * 都有记录，会各算一次。跨院去重是另一条链路（`rws.dedup-incidence`）的分内事，本型不重复它的语义。
 */
import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

export interface CohortCountTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 参与统计的持有方：参与方 id + 数据产品 id（各一份院内队列切片）。 */
  holders: Array<{ participantId: string; dataProductId: string }>;
  /** 分层键（`ageBand|sex` 形态）；缺省由各院行里的 `ageBand`/`sex` 决定。 */
  strataKeys?: string[];
  /** 小单元格阈值下限（缺省由合约决定）。 */
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * 队列规模：**各院 `source` → `distinct-count` → 节点/持有方侧降密 → 平台相加**。
 */
export function buildCohortCountPlan(
  input: CohortCountTemplateInput,
  _space: string,
): LogicalPlanDraft {
  if (!input.holders?.length)
    throw new PlanInputError("队列规模至少需要一家持有方");
  if (!input.contracts?.length)
    throw new PlanInputError("队列规模至少需要一份合约");
  const seen = new Set<string>();
  for (const h of input.holders) {
    if (!h.participantId) throw new PlanInputError("持有方缺少参与方 id");
    if (seen.has(h.participantId))
      throw new PlanInputError(`队列规模的持有方重复：${h.participantId}`);
    seen.add(h.participantId);
  }

  const stages: LogicalPlanDraft["stages"] = [];
  const sealed: string[] = [];
  for (const holder of input.holders) {
    const node = holder.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const count = `count_${suffix}`;
    const dec = `dec_${suffix}`;
    stages.push({
      id: src,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${node}/${holder.dataProductId}` }],
      params: { uri: `ds://${node}/${holder.dataProductId}` },
    });
    stages.push({
      id: count,
      op: "rws.distinct-count@1.0.0",
      inputs: [{ from: src }],
      params: { ...(input.strataKeys ? { strataKeys: input.strataKeys } : {}) },
    });
    stages.push({
      id: dec,
      op: "declassify.small_cell@1.0.0",
      inputs: [{ from: count }],
      params: {
        ...(input.minCell !== undefined ? { minCell: input.minCell } : {}),
        contractId: input.contracts[0],
      },
    });
    sealed.push(dec);
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

/** SPI 的 S2 声明（`OperatorPack.declareTemplates` 的返回项）。 */
export const cohortCountTemplate: PlanTemplate = {
  id: "rws.cohort-count",
  build(input: unknown, ctx: SpiContext) {
    return buildCohortCountPlan(input as CohortCountTemplateInput, ctx.spaceId);
  },
};
