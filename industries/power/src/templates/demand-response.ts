// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.demand-response 计划模板（任务 4.3，spec: power-demand-response）。
 *
 * 只做「申请方入参 → 逻辑计划草案」的翻译与入参校验，不做 I/O。
 * 入参不合法时抛 PlanInputError，由应用层映射为 HTTP 400。
 */

import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";

import { HOURS_PER_DAY } from "../analysis/dr-potential";

export interface DemandResponseParticipant {
  readonly participantId: string;
  readonly dataProductId: string;
}

export interface DemandResponseInput {
  readonly purpose: string;
  readonly applicant: { readonly org: string; readonly project: string };
  readonly contracts: readonly string[];
  readonly participants: readonly DemandResponseParticipant[];
  readonly spec: {
    readonly targetLoad: readonly number[];
    readonly incentiveBudget: number;
    readonly timeWindow: readonly [number, number];
  };
  readonly notBefore: string;
  readonly notAfter: string;
  readonly ethicsRef?: string;
}

/** 校验入参；不合法时抛 PlanInputError（文案与 spec 一致）。 */
export function validateDemandResponseInput(input: unknown): asserts input is DemandResponseInput {
  if (typeof input !== "object" || input === null) {
    throw new PlanInputError("需求响应计划入参必须是对象");
  }
  const v = input as Partial<DemandResponseInput> & Record<string, unknown>;

  if (typeof v.purpose !== "string" || v.purpose.length === 0) {
    throw new PlanInputError("缺少计划目的 purpose");
  }
  if (!v.applicant || typeof v.applicant.org !== "string" || typeof v.applicant.project !== "string") {
    throw new PlanInputError("缺少申请方 applicant（需包含 org 与 project）");
  }
  if (!Array.isArray(v.contracts) || v.contracts.length === 0) {
    throw new PlanInputError("至少需要一份合约");
  }
  if (!Array.isArray(v.participants)) {
    throw new PlanInputError("参与方 participants 必须是数组");
  }
  if (v.participants.length < 2) {
    throw new PlanInputError("需求响应至少需要 2 方参与");
  }
  for (const p of v.participants) {
    if (!p || typeof p.participantId !== "string" || typeof p.dataProductId !== "string") {
      throw new PlanInputError("参与方需包含 participantId 与 dataProductId");
    }
  }

  const spec = v.spec;
  if (!spec) throw new PlanInputError("缺少 spec");
  if (!Array.isArray(spec.targetLoad) || spec.targetLoad.length !== HOURS_PER_DAY) {
    throw new PlanInputError("目标负荷曲线应包含 24 小时数据");
  }
  if (!(typeof spec.incentiveBudget === "number" && spec.incentiveBudget > 0)) {
    throw new PlanInputError("激励预算必须为正数");
  }
  const tw = spec.timeWindow;
  if (
    !Array.isArray(tw) ||
    tw.length !== 2 ||
    typeof tw[0] !== "number" ||
    typeof tw[1] !== "number" ||
    tw[0] >= tw[1]
  ) {
    throw new PlanInputError("调节时间窗口无效");
  }
  if (typeof v.notBefore !== "string" || typeof v.notAfter !== "string") {
    throw new PlanInputError("缺少计划有效期 notBefore / notAfter");
  }
}

/**
 * 构建需求响应逻辑计划草案。
 *
 * 阶段链：
 * - 各参与方：source.dataset → power.dr-potential → declassify.small_cell
 * - 平台：power.dr-optimize（透传 spec）
 */
export function buildDemandResponsePlan(input: unknown): LogicalPlanDraft {
  validateDemandResponseInput(input);

  const declassifyIds: string[] = [];
  const stages: LogicalPlanDraft["stages"] = [];

  for (const p of input.participants) {
    const base = `${p.participantId}`;
    const sourceId = `${base}.source`;
    const potentialId = `${base}.dr-potential`;
    const declassifyId = `${base}.declassify`;

    stages.push(
      {
        id: sourceId,
        op: "source.dataset@1.0.0",
        inputs: [],
        params: { dataProductId: p.dataProductId },
        at: p.participantId,
      },
      {
        id: potentialId,
        op: "power.dr-potential@1.0.0",
        inputs: [{ from: sourceId }],
        params: {},
        at: p.participantId,
      },
      {
        id: declassifyId,
        op: "declassify.small_cell@1.0.0",
        inputs: [{ from: potentialId }],
        params: {},
        at: p.participantId,
      },
    );
    declassifyIds.push(declassifyId);
  }

  stages.push({
    id: "platform.dr-optimize",
    op: "power.dr-optimize@1.0.0",
    inputs: declassifyIds.map((from) => ({ from })),
    params: {
      spec: {
        targetLoad: [...input.spec.targetLoad],
        incentiveBudget: input.spec.incentiveBudget,
        timeWindow: [input.spec.timeWindow[0], input.spec.timeWindow[1]] as [number, number],
      },
    },
    at: "platform",
  });

  return {
    purpose: input.purpose,
    applicant: { org: input.applicant.org, project: input.applicant.project },
    contracts: [...input.contracts],
    stages,
    ...(input.ethicsRef ? { ethics_ref: input.ethicsRef } : {}),
    not_before: input.notBefore,
    not_after: input.notAfter,
  };
}
