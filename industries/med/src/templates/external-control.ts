// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 单臂试验真实世界外部对照（`rws.external-control`）计划模板。
 *
 * 为什么以模板形态进入 MDOP（external-control-arm tasks 6.2）：此前该场景只在演示脚本里
 * **经执行器直驱**（`wasmOp` 直接跑算子），没有可提交的计划 —— 于是「提交入口 / 台账归属 /
 * 编译期校验」三件都绕过了。本模板把它接回与其它场景同一条路：网页/接口提交 逻辑计划
 * 编译（合约、数据就近、C2 目标证明、排序契约）  节点内执行。
 *
 * 骨架与 SCRI 同构，差别在两处：
 *   两方**角色不同**（申办方试验臂 / 医院历史对照池），封存投影分别是 `sponsor-trial` 与
 *     `hospital-controls`（最小投影：缺 linkKey / 索引日 / 结局的行不出院）；
 *   节点阶段吃 `roles` + `strataKeys` + `caliperDays` / `ratioK`，桶口径与输入契约见 D-RWS-8。
 */
import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

export interface ExternalControlTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 申办方一侧：单臂试验受试者（`sponsor-trial` 投影）。 */
  trial: { participantId: string; dataProductId: string };
  /** 医院一侧：历史对照池（`hospital-controls` 投影）。 */
  controls: { participantId: string; dataProductId: string };
  /** **可信空间节点**（参与方 URN）：匹配与降密都在它内部完成。 */
  teeNode: string;
  /** 分层取值（`ageBand|sex` 形态）；本场景必填（节点侧缺它即拒）。 */
  strataKeys: string[];
  /** 匹配卡钳（天）。 */
  caliperDays?: number;
  /** 匹配比例上限（每名试验受试者最多配几名对照）。 */
  ratioK?: number;
  /** 小单元格阈值下限（缺省由合约决定）。 */
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * 外部对照（C2）：**两方各自封存  可信空间节点内匹配  节点内降密  平台收集**。
 */
export function buildExternalControlPlan(
  input: ExternalControlTemplateInput,
  space: string,
): LogicalPlanDraft {
  if (!input.trial?.participantId || !input.controls?.participantId)
    throw new PlanInputError(
      "外部对照需要申办方试验数据与医院对照池各一方",
    );
  if (input.trial.participantId === input.controls.participantId)
    throw new PlanInputError("外部对照的两方不能是同一参与方");
  if (!input.teeNode?.startsWith("urn:"))
    throw new PlanInputError("外部对照必须指定可信空间节点（参与方 URN）");
  if (!input.contracts?.length) throw new PlanInputError("外部对照至少需要一份合约");
  if (!input.strataKeys?.length)
    throw new PlanInputError(
      "外部对照必须显式给 strataKeys（节点侧缺它会拒绝执行）",
    );

  const urn = (id: string) => `urn:tds:${space}:participant:${id}`;
  const stages: LogicalPlanDraft["stages"] = [];
  const sealed: string[] = [];
  const sides = [
    { holder: input.trial, projection: "sponsor-trial" },
    { holder: input.controls, projection: "hospital-controls" },
  ];
  for (const side of sides) {
    const node = side.holder.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    stages.push({
      id: `src_${suffix}`,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${node}/${side.holder.dataProductId}` }],
      params: { uri: `ds://${node}/${side.holder.dataProductId}` },
    });
    stages.push({
      id: `seal_${suffix}`,
      op: "seal.envelope@1.0.0",
      inputs: [{ from: `src_${suffix}` }],
      params: { contractId: input.contracts[0], projection: side.projection },
    });
    sealed.push(`seal_${suffix}`);
  }
  stages.push({
    id: "extCtl",
    op: "rws.external-control@1.0.0",
    inputs: sealed.map((from) => ({ from })),
    params: {
      roles: {
        trial: urn(input.trial.participantId),
        controls: urn(input.controls.participantId),
      },
      strataKeys: input.strataKeys,
      ...(input.caliperDays !== undefined ? { caliperDays: input.caliperDays } : {}),
      ...(input.ratioK !== undefined ? { ratioK: input.ratioK } : {}),
    },
    at: input.teeNode,
  });
  stages.push({
    id: "decTee",
    op: "declassify.small_cell@1.0.0",
    inputs: [{ from: "extCtl" }],
    params: {
      ...(input.minCell !== undefined ? { minCell: input.minCell } : {}),
      contractId: input.contracts[0],
    },
    at: input.teeNode,
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

/** SPI 的 S2 声明（`OperatorPack.declareTemplates` 的返回项）。 */
export const externalControlTemplate: PlanTemplate = {
  id: "rws.external-control",
  build(input: unknown, ctx: SpiContext) {
    return buildExternalControlPlan(input as ExternalControlTemplateInput, ctx.spaceId);
  },
};
