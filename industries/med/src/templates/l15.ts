// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * L1.5 失衡检测（`rws.l15.disproportionality`）计划模板 —— 逐字搬移自 `apps/api/src/mdop/plan-templates.ts`
 * （change `pack-med-templates` design D5：阶段链、`at` 放置、条件展开不动）。
 * 差异只有两处：`space` 由调用方传入；入参校验抛 `PlanInputError`（应用层映射 400）。
 */
import { PlanInputError, participantUrn } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

export interface L15TemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  drug: string;
  /** 医院（participant id）→ 数据产品 id。 */
  hospitals: Array<{ participantId: string; dataProductId: string }>;
  /** 队列定义（可选；本期透传给 source 阶段，由数据加载侧解释）。 */
  cohort?: string;
  /** 小单元格阈值下限（缺省由合约决定）。 */
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/** 计划草案的形状已提升到协议核（change `pack-med-templates` D4）；此处再导出，调用点不变。 */

export function buildL15Plan(
  input: L15TemplateInput,
  space: string,
): LogicalPlanDraft {
  if (!input.drug?.trim())
    throw new PlanInputError("L1.5 计划需要目标药物");
  if (!input.hospitals?.length)
    throw new PlanInputError("L1.5 计划至少需要一家医院");
  if (!input.contracts?.length)
    throw new PlanInputError("L1.5 计划至少需要一份合约");

  const stages: LogicalPlanDraft["stages"] = [];
  const declassifyStageIds: string[] = [];
  for (const hospital of input.hospitals) {
    const node = hospital.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const l15 = `l15_${suffix}`;
    const dec = `dec_${suffix}`;
    stages.push({
      id: src,
      op: "source.dataset@1.0.0",
      // 数据源句柄进「输入」：以 ds://<node>/… 为输入的阶段 MUST 落在该节点（数据就近）
      inputs: [{ from: `ds://${node}/${hospital.dataProductId}` }],
      params: {
        uri: `ds://${node}/${hospital.dataProductId}`,
        ...(input.cohort ? { cohort: input.cohort } : {}),
      },
    });
    stages.push({
      id: l15,
      op: "rws.disproportionality@1.0.0",
      inputs: [{ from: src }],
      params: { drug: input.drug },
    });
    stages.push({
      id: dec,
      op: "declassify.small_cell@1.0.0",
      inputs: [{ from: l15 }],
      params: {
        ...(input.minCell !== undefined ? { minCell: input.minCell } : {}),
        contractId: input.contracts[0],
      },
    });
    declassifyStageIds.push(dec);
  }
  stages.push({
    id: "merge",
    op: "merge.disproportionality@1.0.0",
    inputs: declassifyStageIds.map((from) => ({ from })),
    params: { drug: input.drug },
    at: participantUrn(space, "platform"),
  });

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

/** L4 联邦预测（批次 1A）的模板 id。 */

/** SPI 的 S2 声明。 */
export const l15Template: PlanTemplate = {
  id: "rws.l15.disproportionality",
  build(input: unknown, ctx: SpiContext) {
    return buildL15Plan(input as L15TemplateInput, ctx.spaceId);
  },
};
