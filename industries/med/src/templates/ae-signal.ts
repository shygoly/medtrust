// SPDX-License-Identifier: MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * 不良事件信号 `rws.adverse-event-signal` 计划模板（批次 2，design D1 的平台侧合并组）。
 *
 * 与 `cohort-count` 同构：各院 `source` -> `seal`（本型的投影 `ae-signal`）-> `rws.categorical-count@1.0.0` -> `declassify.small_cell`；
 * 平台侧按分类键相加。口径按 design D6：数的是**出现次数**（一行一起事件），不是去重主体。
 *
 * 域词（`adverseEvents` 字段名、器官系统分类键）都留在**本包**，基座只按参数取 —— 这是基座纯度守护逼出来的边界。
 */
import { PlanInputError } from "@medtrust/mdop";
import { DEFAULT_ORGAN_SYSTEMS, normalizeHolders } from "./category-dictionaries";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

export interface AeSignalTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 参与统计的持有方（`holders` 与既有入口的 `hospitals` 同义，两个都收）。 */
  holders?: Array<{ participantId: string; dataProductId: string }>;
  hospitals?: Array<{ participantId: string; dataProductId: string }>;
  /** 器官系统的**闭合分类键列表**（模板给全，节点只在这些桶里计数）。 */
  categoryKeys: string[];
  /** 小单元格阈值下限（缺省由合约决定）。 */
  /** 可选：只统计服用了该目标药（`medications` 含此值）的队列 —— 旧链三型都支持的口径。 */
  drug?: string;
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/** 本型从院内记录里读的字段名（属行业知识，随模板走、不进基座）。 */
const EVENT_FIELD = "adverseEvents";

export function buildAeSignalPlan(
  input: AeSignalTemplateInput,
  _space: string,
): LogicalPlanDraft {
  const holders = normalizeHolders(input);
  if (!holders.length) throw new PlanInputError("不良事件信号至少需要一家持有方");
  if (!input.contracts?.length) throw new PlanInputError("不良事件信号至少需要一份合约");
  // 省缺时用本包默认器官系统词典（调用方仍可覆盖为更贴合的列表）。
  const categoryKeys = input.categoryKeys?.length
    ? input.categoryKeys
    : [...DEFAULT_ORGAN_SYSTEMS];
  const seen = new Set<string>();
  for (const h of holders) {
    if (!h.participantId) throw new PlanInputError("持有方缺少参与方 id");
    if (seen.has(h.participantId))
      throw new PlanInputError(`不良事件信号的持有方重复：${h.participantId}`);
    seen.add(h.participantId);
  }

  const stages: LogicalPlanDraft["stages"] = [];
  for (const holder of holders) {
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
      // `eventField` 让基座的投影按名字取字段（域词留在本包）。
      params: {
        contractId: input.contracts[0],
        projection: "ae-signal",
        eventField: EVENT_FIELD,
        // 按目标药过滤队列（旧链 matchesMedication 的口径）：字段名与值都由本包给出。
        ...(input.drug
          ? { filterField: "medications", filterValue: input.drug }
          : {}),
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

/** SPI 的 S2 声明（`OperatorPack.declareTemplates` 的返回项）。 */
export const aeSignalTemplate: PlanTemplate = {
  id: "rws.adverse-event-signal",
  build(input: unknown, ctx: SpiContext) {
    return buildAeSignalPlan(input as AeSignalTemplateInput, ctx.spaceId);
  },
};
