// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * LoRA FedAvg（`rws.lora-fedavg`）计划模板 —— 批次 1B：节点间安全聚合。
 *
 * 前置：协议 v0.3（节点间密文路由 + secure_aggregate 算子）已落地。
 *
 * 阶段链：
 *   每家医院：`source.dataset@1` → `rws.lora-train@1` → `declassify.small_cell@1`
 *   节点间聚合：各院 `secure_aggregate@1` → 平台 `merge.fedavg-secure@1`（吃聚合后的 C3）
 *
 * 与 L4 的差异：
 *   - L4：wasm 输出定点权重 → 节点内转浮点指标 → 平台按样本量加权
 *   - LoRA：wasm 输出定点权重 → 节点间安全聚合 → 平台收聚合后总和
 */
import { PlanInputError, participantUrn } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

/**
 * 包内声明它需要的 LoRA 训练规格形状（结构类型）。
 */
export interface LoraFedAvgSpecLike {
  modelType: string;
  aggregation: string;
  baseModel?: string;
  loraRank?: number;
  readonly [field: string]: unknown;
}

export interface LoraFedAvgTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 参与医院（participant id）→ 数据产品 id。 */
  hospitals: Array<{ participantId: string; dataProductId: string }>;
  /**
   * LoRA 训练规格：复用 SecretFlow LoRA 的规格字段。
   * 本期支持 LoRA + fedavg（节点间安全聚合）。
   */
  spec: LoraFedAvgSpecLike;
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * LoRA FedAvg 计划：每家医院训练 LoRA 增量，节点间安全聚合权重，平台合并聚合后的结果。
 */
export function buildLoraFedAvgPlan(
  input: LoraFedAvgTemplateInput,
  space: string,
): LogicalPlanDraft {
  if (!input.spec) throw new PlanInputError("LoRA FedAvg 计划需要训练规格");
  if (input.spec.aggregation !== "fedavg") {
    throw new PlanInputError(
      "本期 LoRA 计划只支持 fedavg 聚合（需节点间安全聚合）",
    );
  }
  if (!input.hospitals?.length)
    throw new PlanInputError("LoRA FedAvg 计划至少需要两家医院");
  if (input.hospitals.length < 2)
    throw new PlanInputError("节点间安全聚合至少需要两家医院");
  if (!input.contracts?.length)
    throw new PlanInputError("LoRA FedAvg 计划至少需要一份合约");

  const stages: LogicalPlanDraft["stages"] = [];
  const trainStageIds: string[] = [];

  // 每家医院：数据源 → LoRA 训练 → 小单元脱密
  for (const hospital of input.hospitals) {
    const node = hospital.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const train = `lora_${suffix}`;
    const dec = `dec_${suffix}`;

    stages.push({
      id: src,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${node}/${hospital.dataProductId}` }],
      params: { uri: `ds://${node}/${hospital.dataProductId}` },
    });

    stages.push({
      id: train,
      op: "rws.lora-train@1.0.0",
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

    trainStageIds.push(dec);
  }

  // 节点间安全聚合：各院上传密文贡献，本地解密并聚合
  const aggregateStageIds: string[] = [];
  for (const hospital of input.hospitals) {
    const node = hospital.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const agg = `agg_${suffix}`;

    stages.push({
      id: agg,
      op: "secure_aggregate@1.0.0",
      inputs: trainStageIds.map((from) => ({ from })),
      params: {
        aggregation: "fedavg",
        spec: input.spec,
      },
      at: participantUrn(space, node),
    });

    aggregateStageIds.push(agg);
  }

  // 平台合并：收各院聚合后的 C3
  stages.push({
    id: "merge",
    op: "merge.fedavg-secure@1.0.0",
    inputs: aggregateStageIds.map((from) => ({ from })),
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

/** SPI 的 S2 声明。 */
export const loraFedAvgTemplate: PlanTemplate = {
  id: "rws.lora-fedavg",
  build(input: unknown, ctx: SpiContext) {
    return buildLoraFedAvgPlan(input as LoraFedAvgTemplateInput, ctx.spaceId);
  },
};
