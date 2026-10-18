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

import { datasetUri, releaseParams, validateReleaseOptions, type PowerReleaseOptions } from "./release";

/**
 * 已实现的预测模型（**计划里写的模型 = 实际跑的模型**）。
 * 只有训练后端真的接上、输出里确实用的模型才允许进这个枚举；
 * 见 `analysis/load-forecast-model.ts`（季节朴素基线）。
 */
export const LOAD_FORECAST_MODELS = ["baseline"] as const;
export type LoadForecastModel = (typeof LOAD_FORECAST_MODELS)[number];

/**
 * 规格里登记过、但训练后端尚未接入的模型。
 * 提交它们会**显式拒绝**，而不是悄悄拿基线顶替——否则计划（与审计）写的算法不是真跑的那个。
 */
export const UNIMPLEMENTED_FORECAST_MODELS = ["lstm", "transformer"] as const;

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
    /** 取值见 `LOAD_FORECAST_MODELS`（当前仅 `baseline`）；未实现的模型提交即拒。 */
    readonly model: string;
  };
  readonly notBefore: string;
  readonly notAfter: string;
  readonly ethicsRef?: string;
  readonly release?: PowerReleaseOptions;
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
  // 模型：未实现的显式拒绝（fail-closed），已实现的白名单校验。
  // 这样计划与审计里记的模型，就是收集器真正跑的那个。
  if ((UNIMPLEMENTED_FORECAST_MODELS as readonly string[]).includes(String(spec.model))) {
    throw new PlanInputError(
      `预测模型 ${String(spec.model)} 尚未实现（训练后端未接入）；当前可用：${LOAD_FORECAST_MODELS.join(" / ")}（季节朴素基线）`,
    );
  }
  if (!(LOAD_FORECAST_MODELS as readonly string[]).includes(String(spec.model))) {
    throw new PlanInputError(`只支持 ${LOAD_FORECAST_MODELS.join(" / ")} 模型`);
  }
  if (typeof v.notBefore !== "string" || typeof v.notAfter !== "string") {
    throw new PlanInputError("缺少计划有效期 notBefore / notAfter");
  }
  validateReleaseOptions(v.release);
}

/**
 * 构建负荷预测逻辑计划草案。
 *
 * 阶段链：
 * - 各参与方：source.dataset → power.feature-extraction（wasm）→ declassify.small_cell
 *   （降密环在节点内把逐表计特征聚合为节点级，C3 不含表计标识）
 * - 平台：power.load-forecast-merge（透传 spec）
 *
 * 不再经 secure_aggregate：节点级 C3 已是聚合量，平台按样本量加权合并即可；
 * 让每个节点都上传同一份聚合结果反而会被合并器重复计数。
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
    const uri = datasetUri(p.participantId, p.dataProductId);

    stages.push(
      { id: sourceId, op: "source.dataset@1.0.0", inputs: [{ from: uri }], params: { uri, role: p.role } },
      { id: featureId, op: "power.feature-extraction@1.0.0", inputs: [{ from: sourceId }], params: { features: [...input.spec.features], period: 24 } },
      {
        id: declassifyId,
        op: "declassify.small_cell@1.0.0",
        inputs: [{ from: featureId }],
        params: releaseParams(input.contracts[0]!, input.release),
      },
    );
    declassifyIds.push(declassifyId);
  }

  stages.push({
    id: "platform.load-forecast-merge",
    op: "power.load-forecast-merge@1.0.0",
    inputs: declassifyIds.map((from) => ({ from })),
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
