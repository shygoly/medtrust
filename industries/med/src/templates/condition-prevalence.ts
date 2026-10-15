// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 慢病标签现患 `rws.condition-prevalence` 计划模板（批次 2，平台侧合并组）。
 *
 * 与 `cohort-count` / `ae-signal` 同构（design D6：三型是一件事）：各院
 * `source` -> `seal`（投影 `list-categories`）-> `rws.categorical-count@1.0.0` -> `declassify.small_cell`；
 * 平台按分类键相加。
 *
 * 两处口径说明（都要在对拍里核）：
 *  1. **一行多标签各计一次**（旧链 `conditions[]` 的每个标签逐个计数）；
 *  2. **无标签的行以占位分类计入**（旧链的「无明确慢病标签」口径，不是丢弃）——
 *     占位文案属行业用语，由本包给出（基座只按参数取）。
 *
 * 与旧链的**显式差异**：旧链接受任意标签，本模板要求调用方给**闭合的 `categoryKeys`**
 * （基座只在这些桶里计数）。超出列表的标签在节点侧会被拒 —— 这是有意的收紧，
 * 对拍时必须把旧链的标签集合与 `categoryKeys` 对齐后逐字段比。
 */
import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

/** 旧链对「一个慢病标签都没有」的占位口径（属行业用语，随模板走）。 */
export const NO_CONDITION_LABEL = "无明确慢病标签";

export interface ConditionPrevalenceTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  holders: Array<{ participantId: string; dataProductId: string }>;
  /** 慢病标签的**闭合分类键列表**（节点只在这些桶里计数）。 */
  categoryKeys: string[];
  /** 是否把「无标签」的行以占位分类计入（默认 true，与旧链一致）。 */
  countUnlabeled?: boolean;
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

export function buildConditionPrevalencePlan(
  input: ConditionPrevalenceTemplateInput,
  _space: string,
): LogicalPlanDraft {
  if (!input.holders?.length) throw new PlanInputError("慢病标签现患至少需要一家持有方");
  if (!input.contracts?.length) throw new PlanInputError("慢病标签现患至少需要一份合约");
  if (!input.categoryKeys?.length)
    throw new PlanInputError("慢病标签现患必须显式给 categoryKeys（标签闭合列表）");
  const seen = new Set<string>();
  for (const h of input.holders) {
    if (!h.participantId) throw new PlanInputError("持有方缺少参与方 id");
    if (seen.has(h.participantId))
      throw new PlanInputError(`慢病标签现患的持有方重复：${h.participantId}`);
    seen.add(h.participantId);
  }
  // 占位分类必须也在闭合列表里，否则节点侧会因为「分类不在列表」拒掉无标签的行。
  const countUnlabeled = input.countUnlabeled ?? true;
  const categoryKeys = [...input.categoryKeys];
  if (countUnlabeled && !categoryKeys.includes(NO_CONDITION_LABEL))
    categoryKeys.push(NO_CONDITION_LABEL);

  const stages: LogicalPlanDraft["stages"] = [];
  for (const holder of input.holders) {
    const node = holder.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const seal = `seal_${suffix}`;
    const count = `count_${suffix}`;
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
        projection: "list-categories",
        listField: "conditions",
        emptyPlaceholder: countUnlabeled ? NO_CONDITION_LABEL : "",
      },
    });
    stages.push({
      id: count,
      op: "rws.categorical-count@1.0.0",
      inputs: [{ from: seal }],
      params: { dataset: { ref: seal }, categoryKeys },
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

/** SPI 的 S2 声明。 */
export const conditionPrevalenceTemplate: PlanTemplate = {
  id: "rws.condition-prevalence",
  build(input: unknown, ctx: SpiContext) {
    return buildConditionPrevalencePlan(
      input as ConditionPrevalenceTemplateInput,
      ctx.spaceId,
    );
  },
};
