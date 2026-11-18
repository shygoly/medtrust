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

const L15_DESIGN_TYPES = [
  "cross-sectional",
  "cohort",
  "case-control",
  "nested-case-control",
  "case-cohort",
  "case-crossover",
] as const;

const MISSINGNESS_MECHANISMS = ["MCAR", "MAR", "MNAR"] as const;

export interface L15TemporalWindowInput {
  /** 用药开始后最长风险窗口（天，可选）；仅在输入带日期时参与截断。 */
  maxDaysAfterStart?: number;
  /** 是否允许用药当日事件（默认 true）。 */
  allowSameDay?: boolean;
  /** 是否强制拒绝无日期记录（默认 false，允许无日期数据回退为 undated-cooccurrence）。 */
  requireTemporalOrder?: boolean;
}

export interface L15TemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  drug: string;
  /** §2.5 流行病学设计类型（L1.5 必填）。 */
  designType: (typeof L15_DESIGN_TYPES)[number];
  /** §2.5 选型理由（与 designType 成对必填）。 */
  rationale: string;
  /** §3.1/§3.2 SAP（可选；多结局/多组合扫描时用于登记多重性校正）。 */
  sap?: {
    significanceLevel?: number;
    power?: number;
    sampleSizeAssumption?: number;
    sampleSizeJustification?: string;
    multiplicityAlphaAdjustment?: string;
  };
  /** 医院（participant id）→ 数据产品 id。 */
  hospitals: Array<{ participantId: string; dataProductId: string }>;
  /** 队列定义（可选；本期透传给 source 阶段，由数据加载侧解释）。 */
  cohort?: string;
  /**
   * **可执行的**协议队列定义（纳入/排除规则），可选。与上面的 `cohort` 不同：那个是数据源侧的
   * 不透明句柄，这个是节点能逐条判定的规则，用于在**投影之前**收窄队列（change
   * `mdop-node-parity-enrichments` D1：声明随计划走，节点侧应用）。
   */
  cohortDefinition?: { inclusion?: string[]; exclusion?: string[] };
  /** 缺失值处理声明（SAP 逐字文本），可选；节点在投影之前应用并记录 `missingnessLog`。 */
  missingnessDeclaration?: { mechanism?: string; imputationStrategy?: string };
  /** Drug-before-Event 时间窗控制参数（可选）。 */
  temporalWindow?: L15TemporalWindowInput;
  /** 小单元格阈值下限（缺省由合约决定）。 */
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

function validateL15ProtocolInput(input: L15TemplateInput): void {
  if (!input.drug?.trim())
    throw new PlanInputError("L1.5 计划需要目标药物");
  if (!input.hospitals?.length)
    throw new PlanInputError("L1.5 计划至少需要一家医院");
  if (!input.contracts?.length)
    throw new PlanInputError("L1.5 计划至少需要一份合约");
  if (
    typeof input.designType !== "string" ||
    !L15_DESIGN_TYPES.includes(input.designType as (typeof L15_DESIGN_TYPES)[number])
  ) {
    throw new PlanInputError(
      `L1.5 计划必须声明 designType（${L15_DESIGN_TYPES.join(" / ")}，§2.5 流行病学设计类型）`,
    );
  }
  if (typeof input.rationale !== "string" || !input.rationale.trim()) {
    throw new PlanInputError("L1.5 计划选了 designType 就必须填写非空 rationale（§2.5 选型理由）");
  }
  if (input.cohortDefinition !== undefined) {
    if (!input.cohortDefinition || typeof input.cohortDefinition !== "object") {
      throw new PlanInputError("L1.5 cohortDefinition 必须为对象");
    }
    const { inclusion, exclusion } = input.cohortDefinition;
    if (
      (inclusion !== undefined &&
        (!Array.isArray(inclusion) || !inclusion.every((r) => typeof r === "string"))) ||
      (exclusion !== undefined &&
        (!Array.isArray(exclusion) || !exclusion.every((r) => typeof r === "string")))
    ) {
      throw new PlanInputError("L1.5 cohortDefinition.inclusion / exclusion 必须为字符串数组");
    }
  }
  if (input.missingnessDeclaration !== undefined) {
    const m = input.missingnessDeclaration;
    if (
      !m ||
      typeof m !== "object" ||
      typeof m.mechanism !== "string" ||
      !MISSINGNESS_MECHANISMS.includes(m.mechanism as (typeof MISSINGNESS_MECHANISMS)[number])
    ) {
      throw new PlanInputError(
        `L1.5 missingnessDeclaration.mechanism 必须为 ${MISSINGNESS_MECHANISMS.join("/")}`,
      );
    }
    if (typeof m.imputationStrategy !== "string" || !m.imputationStrategy.trim()) {
      throw new PlanInputError(
        "L1.5 missingnessDeclaration.imputationStrategy 必须与 mechanism 成对声明且非空（§3.4）",
      );
    }
  }
  if (input.temporalWindow !== undefined) {
    const tw = input.temporalWindow;
    if (!tw || typeof tw !== "object") {
      throw new PlanInputError("L1.5 temporalWindow 必须为对象");
    }
    if (
      tw.maxDaysAfterStart !== undefined &&
      (typeof tw.maxDaysAfterStart !== "number" ||
        !Number.isFinite(tw.maxDaysAfterStart) ||
        tw.maxDaysAfterStart <= 0)
    ) {
      throw new PlanInputError("L1.5 temporalWindow.maxDaysAfterStart 必须为正数");
    }
  }
}

/** 计划草案的形状已提升到协议核（change `pack-med-templates` D4）；此处再导出，调用点不变。 */

export function buildL15Plan(
  input: L15TemplateInput,
  space: string,
): LogicalPlanDraft {
  validateL15ProtocolInput(input);

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
      params: {
        drug: input.drug,
        ...(input.cohortDefinition
          ? {
              cohortDefinition: {
                inclusion: input.cohortDefinition.inclusion ?? [],
                exclusion: input.cohortDefinition.exclusion ?? [],
              },
            }
          : {}),
        ...(input.missingnessDeclaration
          ? { missingnessDeclaration: input.missingnessDeclaration }
          : {}),
        ...(input.temporalWindow ? { temporalWindow: input.temporalWindow } : {}),
      },
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
