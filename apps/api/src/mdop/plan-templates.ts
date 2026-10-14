import { currentSpaceId } from "../runtime/space-context/space-id.util";
import type { FlPredictionTaskSpec } from "../compute-task/dto/fl-prediction-task-spec";
import { BadRequestException } from "@nestjs/common";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import {
  participantUrn,
} from "@medtrust/mdop";

/**
 * 计划模板（任务 9.1）：把「药物/事件/队列定义/医院/合约」翻译成逻辑计划。
 *
 * 本期的模板 `rws.l15.disproportionality` 固定四个阶段：
 *   每家医院：`source.dataset@1` → `rws.disproportionality@1` → `declassify.small_cell@1`
 *   平台合并：`merge.disproportionality@1`（吃各院 C3）
 * 申请方只描述「算什么」，不描述「在哪算」——放置由编译器按数据就近决定。
 */

export const L15_TEMPLATE_ID = "rws.l15.disproportionality";

export type { LogicalPlanDraft } from "@medtrust/mdop";

export const L4_TEMPLATE_ID = "rws.l4.fl-prediction";

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
  spec: FlPredictionTaskSpec;
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
  space = currentSpaceId(),
): LogicalPlanDraft {
  if (!input.spec) throw new BadRequestException("L4 计划需要训练规格");
  if (
    input.spec.modelType !== "logistic_regression" ||
    input.spec.aggregation !== "fedavg"
  ) {
    throw new BadRequestException(
      "本期 L4 计划只支持 logistic_regression + fedavg（其余模型待 connector-ml 对拍）",
    );
  }
  if (!input.hospitals?.length)
    throw new BadRequestException("L4 计划至少需要一家医院");
  if (!input.contracts?.length)
    throw new BadRequestException("L4 计划至少需要一份合约");

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
export const PAIRED_COHORT_TEMPLATE_ID = "rws.paired-cohort";

/** 疫苗接种后不良事件主动监测（自身对照风险期 SCRI）的模板 id。 */
export const VACCINE_SCRI_TEMPLATE_ID = "rws.vaccine-scri";

/** 疫苗真实世界保护效果（检测阴性设计）的模板 id。 */
export const VE_TND_TEMPLATE_ID = "rws.ve-tnd";

/** 跨院去重发病率的模板 id。 */
export const DEDUP_INCIDENCE_TEMPLATE_ID = "rws.dedup-incidence";
