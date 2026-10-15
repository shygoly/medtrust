// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.load-forecast 计划模板（任务 3.5，spec: power-load-forecast）。
 *
 * 只做「申请方入参 → 逻辑计划草案」的翻译与入参校验，不做 I/O。
 * 入参不合法时抛 PlanInputError，由应用层映射为 HTTP 400。
 */

import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";

export const LOAD_FORECAST_MODELS = ["lstm", "transformer"] as const;
export type LoadForecastModel = (typeof LOAD_FORECAST_MODELS)[number];

export const LOAD_FORECAST_ROLES = ["grid", "weather", "industrial"] as const;
export type LoadForecastRole = (typeof LOAD_FORECAST_ROLES)[number];

export const MAX_FORECAST_HORIZON_HOURS = 168;

export interface LoadForecastParticipant {
  readonly participantId: string;
  readonly dataProductId: string;
  readonly role: LoadForecastRole;
}

export interface LoadForecastInput {
  readonly purpose: string;
  readonly applicant: { readonly org: string; readonly project: string };
  readonly contracts: readonly string[];
  readonly participants: readonly LoadForecastParticipant[];
  readonly spec: {
    readonly forecastHorizon: number;
    readonly features: readonly string[];
    readonly model: LoadForecastModel;
  };
  readonly notBefore: string;
  readonly notAfter: string;
  readonly ethicsRef?: string;
}

/** 校验入参；不合法时抛 PlanInputError（文案与 spec 一致）。 */
export function validateLoadForecastInput(input: unknown): asserts input is LoadForecastInput {
  if (typeof input !== "object" || input === null) {
    throw new PlanInputError("负荷预测计划入参必须是对象");
  }
  const v = input as Partial<LoadForecastInput> & Record<string, unknown>;

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
    throw new PlanInputError("负荷预测至少需要 2 方参与");
  }
  for (const p of v.participants) {
    if (
      !p ||
      typeof p.participantId !== "string" ||
      typeof p.dataProductId !== "string" ||
      !(LOAD_FORECAST_ROLES as readonly string[]).includes(p.role)
    ) {
      throw new PlanInputError("参与方需包含 participantId、dataProductId 与合法 role（grid / weather / industrial）");
    }
  }

  const spec = v.spec;
  if (!spec) throw new PlanInputError("缺少 spec");
  const h = spec.forecastHorizon;
  if (typeof h !== "number" || !Number.isFinite(h) || h <= 0 || h > MAX_FORECAST_HORIZON_HOURS) {
    throw new PlanInputError("预测时长应在 1-168 小时之间");
  }
  if (!Array.isArray(spec.features) || spec.features.length === 0) {
    throw new PlanInputError("至少需要一个特征");
  }
  if (spec.model === "transformer") {
    throw new PlanInputError("Transformer 模型尚未实现，当前请使用 lstm（由季节朴素基线承接）");
  }
  if (!(LOAD_FORECAST_MODELS as readonly string[]).includes(spec.model)) {
    throw new PlanInputError("只支持 lstm 模型");
  }
  if (typeof v.notBefore !== "string" || typeof v.notAfter !== "string") {
    throw new PlanInputError("缺少计划有效期 notBefore / notAfter");
  }
}

/**
 * 构建负荷预测逻辑计划草案。
 *
 * 阶段链：
 * - 各参与方：source.dataset → power.feature-extraction → declassify.small_cell
 * - 各参与方节点：secure_aggregate（fedavg，输入为所有方的脱密输出）
 * - 平台：power.load-forecast-merge（透传 spec）
 *
 * @param input - 申请方入参（会先经过 validateLoadForecastInput）
 * @returns 逻辑计划草案
 * @throws PlanInputError 入参不合法时
 */
export function buildLoadForecastPlan(input: unknown): LogicalPlanDraft {
  validateLoadForecastInput(input);

  const declassifyIds: string[] = [];
  const stages: LogicalPlanDraft["stages"] = [];

  for (const p of input.participants) {
    const base = `${p.participantId}`;
    const sourceId = `${base}.source`;
    const featureId = `${base}.feature`;
    const declassifyId = `${base}.declassify`;

    stages.push(
      { id: sourceId, op: "source.dataset@1.0.0", inputs: [], params: { dataProductId: p.dataProductId, role: p.role }, at: p.participantId },
      { id: featureId, op: "power.feature-extraction@1.0.0", inputs: [{ from: sourceId }], params: { features: [...input.spec.features] }, at: p.participantId },
      { id: declassifyId, op: "declassify.small_cell@1.0.0", inputs: [{ from: featureId }], params: {}, at: p.participantId },
    );
    declassifyIds.push(declassifyId);
  }

  const aggregateIds: string[] = [];
  for (const p of input.participants) {
    const aggregateId = `${p.participantId}.aggregate`;
    aggregateIds.push(aggregateId);
    stages.push({
      id: aggregateId,
      op: "secure_aggregate@1.0.0",
      inputs: declassifyIds.map((from) => ({ from })),
      params: { aggregation: "fedavg" },
      at: p.participantId,
    });
  }

  stages.push({
    id: "platform.load-forecast-merge",
    op: "power.load-forecast-merge@1.0.0",
    inputs: aggregateIds.map((from) => ({ from })),
    params: { spec: { ...input.spec, features: [...input.spec.features] } },
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
