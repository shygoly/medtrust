// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 跨院队列交集（`rws.paired-cohort`）计划模板 —— 逐字搬移自 `apps/api/src/mdop/plan-templates.ts`
 * （change `pack-med-templates` design D5：阶段链、`at` 放置、条件展开一律不动）。
 *
 * 与原文的两点差异（也只有这两点）：
 *  1. `space` 由调用方传入（包不能 import 应用的 `space-id.util`）；
 *  2. 入参校验抛协议核的 `PlanInputError`（应用层控制器映射成 HTTP 400，文案原样）。
 */
import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

export interface PairedCohortTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  /** 参与配对的持有方：参与方 id + 数据产品 id（各一份 **C2 封存切片**）。 */
  holders: Array<{ participantId: string; dataProductId: string }>;
  /** **可信空间节点**（参与方 URN）：配对与降密都在它内部完成。 */
  teeNode: string;
  /** 分层取值（`ageBand|sex` 形态；由数据侧映射，节点内按它分组）。 */
  strata?: string[];
  /** 小单元格阈值下限（缺省由合约决定）。 */
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

/**
 * 跨院队列交集（C2）：**各院封存 → 可信空间节点内配对 → 节点内降密 → 平台收集**。
 *
 * 三处刻意的写法，都与「能判的都在编译期判」有关：
 *  ① 每家持有方的阶段链是 `source` → `seal`：**封存留在持有方侧**（C0→C2），
 *     送出去的只有信封；数据源句柄让编译器把这两步钉在该院（数据就近）。
 *  ② 节点侧两个阶段都写 `at: <teeNode>`：`pair` 吃的是各院的 **C2 输入**，
 *     **不写 `at` 就会按「多节点依赖」被默认丢给平台**（而平台不该、也不能解封）；
 *     写了 `at` 之后编译器照走 `assertC2Target`（合约证明策略 + 该节点的证明登记）。
 *  ③ 配对之后跟一个 `declassify.small_cell` 阶段：C2 → C3 的**降密就是节点内的发布审查**，
 *     用同一套闸门机制表达（既不是平台的事，也不是把 C2 直接投给平台）。
 */
export function buildPairedCohortPlan(
  input: PairedCohortTemplateInput,
  space: string,
): LogicalPlanDraft {
  if (!input.holders?.length || input.holders.length < 2)
    throw new PlanInputError("跨院配对至少需要两家持有方");
  if (!input.teeNode?.startsWith("urn:"))
    throw new PlanInputError("跨院配对必须指定可信空间节点（参与方 URN）");
  if (!input.contracts?.length)
    throw new PlanInputError("跨院配对至少需要一份合约");

  const stages: LogicalPlanDraft["stages"] = [];
  const sealedStageIds: string[] = [];
  for (const holder of input.holders) {
    const node = holder.participantId;
    const suffix = node.replace(/[^A-Za-z0-9]/g, "");
    const src = `src_${suffix}`;
    const seal = `seal_${suffix}`;
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
      params: { contractId: input.contracts[0] },
    });
    sealedStageIds.push(seal);
  }

  stages.push({
    id: "pair",
    op: "rws.paired-cohort@1.0.0",
    inputs: sealedStageIds.map((from) => ({ from })),
    params: { ...(input.strata ? { strata: input.strata } : {}) },
    at: input.teeNode,
  });
  stages.push({
    id: "decTee",
    op: "declassify.small_cell@1.0.0",
    inputs: [{ from: "pair" }],
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
export const pairedCohortTemplate: PlanTemplate = {
  id: "rws.paired-cohort",
  build(input: unknown, ctx: SpiContext) {
    return buildPairedCohortPlan(input as PairedCohortTemplateInput, ctx.spaceId);
  },
};
