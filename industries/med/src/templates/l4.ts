// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * L4 表格联邦预测（`rws.l4.fl-prediction`）计划模板 —— 逐字搬移自 `apps/api/src/mdop/plan-templates.ts`
 * （change `pack-med-templates`，本锯绑 FL 迁移；design D5：阶段链 / `at` 放置 / 条件展开不动）。
 *
 * 与原文的差异：`space` 由调用方传入；入参校验抛 `PlanInputError`；`spec` 用**包内结构类型**声明
 * （本模板只读 `modelType` / `aggregation`，其余字段原样透传进阶段参数）——
 * 这样应用侧的 `FlPredictionTaskSpec` 天然满足它，而包无需 import 应用内部 DTO。
 */
import { PlanInputError, participantUrn } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

/**
 * 包内声明它需要的训练规格形状（结构类型）。
 * 应用侧的 `FlPredictionTaskSpec` 结构上满足它；包 MUST NOT import 应用内部 DTO。
 */
export interface L4FlSpecLike {
  modelType: string;
  aggregation: string;
  readonly [field: string]: unknown;
}

export interface L4TemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 参与医院（participant id）→ 数据产品 id。 */
  hospitals: Array<{ participantId: string; dataProductId: string }>;
  /**
   * 训练规格：**复用旧链的 `FlPredictionTaskSpec`**（不另立字段语义）。
   * 本期只支持 `logistic_regression + fedavg`（无 sidecar、纯院内，便于逐字段对拍）；
   * 其余模型走 connector-ml，需另立一轮对拍（见 change design 风险表）。
   */
  spec: L4FlSpecLike;
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * L4 计划：每家医院 `source.dataset@1` → `rws.l4-train@1` → `declassify.small_cell@1`，
 * 平台 `merge.fedavg@1`（吃各院 C3）。
 */
export function buildL4Plan(
  input: L4TemplateInput,
  space: string,
): LogicalPlanDraft {
  if (!input.spec) throw new PlanInputError("L4 计划需要训练规格");
  if (
    input.spec.modelType !== "logistic_regression" ||
    input.spec.aggregation !== "fedavg"
  ) {
    throw new PlanInputError(
      "本期 L4 计划只支持 logistic_regression + fedavg（其余模型待 connector-ml 对拍）",
    );
  }
  if (!input.hospitals?.length)
    throw new PlanInputError("L4 计划至少需要一家医院");
  if (!input.contracts?.length)
    throw new PlanInputError("L4 计划至少需要一份合约");

  const stages: LogicalPlanDraft["stages"] = [];
  const declassifyStageIds: string[] = [];
  for (const hospital of input.hospitals) {
    const node = hospital.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const train = `l4_${suffix}`;
    const dec = `dec_${suffix}`;
    stages.push({
      id: src,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${node}/${hospital.dataProductId}` }],
      params: { uri: `ds://${node}/${hospital.dataProductId}` },
    });
    stages.push({
      id: train,
      op: "rws.l4-train@1.0.0",
      inputs: [{ from: src }],
      params: { spec: input.spec },
    });
    stages.push({
      id: dec,
      op: "declassify.small_cell@1.0.0",
      inputs: [{ from: train }],
      params: {
        ...(input.minCell !== undefined ? { minCell: input.minCell } : {}),
        contractId: input.contracts[0],
      },
    });
    declassifyStageIds.push(dec);
  }
  stages.push({
    id: "merge",
    op: "merge.fedavg@1.0.0",
    inputs: declassifyStageIds.map((from) => ({ from })),
    params: { spec: input.spec },
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

/** 跨院队列交集（C2 首个场景，D-TEE-4 首选 A）的模板 id。 */

/** SPI 的 S2 声明。 */
export const l4Template: PlanTemplate = {
  id: "rws.l4.fl-prediction",
  build(input: unknown, ctx: SpiContext) {
    return buildL4Plan(input as L4TemplateInput, ctx.spaceId);
  },
};
