// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.theft-detection 计划模板（任务 5.5，spec: power-theft-detection）。
 */

import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";

import { datasetUri, releaseParams, validateReleaseOptions, type PowerReleaseOptions } from "./release";

export interface TheftDetectionParticipant {
  readonly participantId: string;
  readonly dataProductId: string;
}

export interface TheftDetectionInput {
  readonly purpose: string;
  readonly applicant: { readonly org: string; readonly project: string };
  readonly contracts: readonly string[];
  readonly participants: readonly TheftDetectionParticipant[];
  readonly spec: {
    readonly detectionPeriod: number;
    readonly anomalyThreshold: number;
    readonly topK: number;
  };
  readonly notBefore: string;
  readonly notAfter: string;
  readonly ethicsRef?: string;
  readonly release?: PowerReleaseOptions;
}

export function validateTheftDetectionInput(input: unknown): asserts input is TheftDetectionInput {
  if (typeof input !== "object" || input === null) {
    throw new PlanInputError("窃电检测计划入参必须是对象");
  }
  const v = input as Partial<TheftDetectionInput> & Record<string, unknown>;

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
    throw new PlanInputError("窃电检测至少需要 2 个供电局参与");
  }
  for (const p of v.participants) {
    if (!p || typeof p.participantId !== "string" || typeof p.dataProductId !== "string") {
      throw new PlanInputError("参与方需包含 participantId 与 dataProductId");
    }
  }

  const spec = v.spec;
  if (!spec) throw new PlanInputError("缺少 spec");
  if (!(typeof spec.detectionPeriod === "number" && spec.detectionPeriod >= 30)) {
    throw new PlanInputError("检测周期至少需要 30 天");
  }
  if (!(typeof spec.anomalyThreshold === "number" && spec.anomalyThreshold >= 0 && spec.anomalyThreshold <= 1)) {
    throw new PlanInputError("异常阈值应在 0-1 之间");
  }
  if (!(typeof spec.topK === "number" && Number.isInteger(spec.topK) && spec.topK > 0)) {
    throw new PlanInputError("topK 必须为正整数");
  }
  if (typeof v.notBefore !== "string" || typeof v.notAfter !== "string") {
    throw new PlanInputError("缺少计划有效期 notBefore / notAfter");
  }
  validateReleaseOptions(v.release);
}

export function buildTheftDetectionPlan(input: unknown): LogicalPlanDraft {
  validateTheftDetectionInput(input);

  const declassifyIds: string[] = [];
  const stages: LogicalPlanDraft["stages"] = [];

  for (const p of input.participants) {
    const base = `${p.participantId}`;
    const sourceId = `${base}.source`;
    const anomalyId = `${base}.anomaly`;
    const declassifyId = `${base}.declassify`;
    const uri = datasetUri(p.participantId, p.dataProductId);

    stages.push(
      {
        id: sourceId,
        op: "source.dataset@1.0.0",
        inputs: [{ from: uri }],
        params: { uri },
      },
      {
        id: anomalyId,
        op: "power.anomaly-detection@1.0.0",
        inputs: [{ from: sourceId }],
        params: { anomalyThreshold: input.spec.anomalyThreshold },
      },
      {
        id: declassifyId,
        op: "declassify.small_cell@1.0.0",
        inputs: [{ from: anomalyId }],
        // 节点只放行超阈值、至多 topK 块表计（假名化），其余留在本地
        params: releaseParams(input.contracts[0]!, input.release, {
          anomalyThreshold: input.spec.anomalyThreshold,
          topK: input.spec.topK,
        }),
      },
    );
    declassifyIds.push(declassifyId);
  }

  stages.push({
    id: "platform.theft-merge",
    op: "power.theft-merge@1.0.0",
    inputs: declassifyIds.map((from) => ({ from })),
    params: {
      spec: {
        detectionPeriod: input.spec.detectionPeriod,
        anomalyThreshold: input.spec.anomalyThreshold,
        topK: input.spec.topK,
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
