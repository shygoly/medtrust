// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { PlanInputError } from "@medtrust/mdop";
import type { LogicalPlanDraft } from "@medtrust/mdop";
import type { PlanTemplate, SpiContext } from "@medtrust/space-kernel-spi";

export interface RegistrationExternalControlSource {
  participantId: string;
  dataProductId: string;
  contractId: string;
}

export interface RegistrationExternalControlTemplateInput {
  purpose: string;
  applicant: { org: string; project: string };
  study: {
    studyId: string;
    product: string;
    indication: string;
    design: "single-arm-with-external-control";
    objective: "superiority";
    evidenceRole: "primary" | "supportive" | "exploratory";
    estimand: "ATT";
    estimator: "IPTW-ATT";
    timeZero: string;
    outcome: string;
    profileVersion: string;
    protocolVersion: string;
    sapVersion: string;
    synthetic: boolean;
    /** Real studies fail closed until every P0 clinical/regulatory decision is frozen. */
    p0DecisionsFrozen: boolean;
  };
  trial: RegistrationExternalControlSource;
  controls: RegistrationExternalControlSource[];
  covariates: string[];
  missingness: "MCAR" | "MAR" | "MNAR";
  effectMeasure: "risk-ratio" | "risk-difference";
  truthRr?: number;
  contractBundle: { id: string; version: string; minCell: number };
  teeNode: string;
  minCell?: number;
  ethicsRef?: string;
  notBefore: string;
  notAfter: string;
}

const SAFE_ROLE = /^[a-z][a-z0-9-]{0,62}$/;

function assertSource(source: RegistrationExternalControlSource, path: string): void {
  for (const field of ["participantId", "dataProductId", "contractId"] as const)
    if (!source?.[field]?.trim()) throw new PlanInputError(`${path}.${field} 不能为空`);
}

export function buildExternalControlRegistrationPlan(
  input: RegistrationExternalControlTemplateInput,
  space: string,
): LogicalPlanDraft {
  if (!input.purpose?.trim()) throw new PlanInputError("注册型外部对照缺 purpose");
  assertSource(input.trial, "trial");
  if (!Array.isArray(input.controls) || input.controls.length < 1 || input.controls.length > 2)
    throw new PlanInputError("注册型外部对照需要 1 个主外部对照源，可选 1 个第二对照源");
  input.controls.forEach((source, index) => assertSource(source, `controls[${index}]`));
  if (!input.teeNode?.startsWith("urn:"))
    throw new PlanInputError("注册型外部对照必须指定可信空间节点");
  if (!input.study?.estimand || input.study.estimand !== "ATT")
    throw new PlanInputError("当前注册型算子只支持 ATT");
  if (input.study.estimator !== "IPTW-ATT")
    throw new PlanInputError("ATT 必须绑定 IPTW-ATT");
  for (const field of [
    "studyId",
    "product",
    "indication",
    "timeZero",
    "outcome",
    "profileVersion",
    "protocolVersion",
    "sapVersion",
  ] as const)
    if (!input.study[field]?.trim())
      throw new PlanInputError(`study.${field} 未冻结`);
  if (input.study.design !== "single-arm-with-external-control")
    throw new PlanInputError("只接受 single-arm-with-external-control");
  if (input.study.objective !== "superiority")
    throw new PlanInputError("外部对照注册研究只接受 superiority，不支持非劣效");
  if (!input.study.synthetic && !input.study.p0DecisionsFrozen)
    throw new PlanInputError("真实研究执行前必须有全部 P0 临床与注册决策的冻结确认");
  if (input.study.synthetic && !(typeof input.truthRr === "number" && input.truthRr > 0))
    throw new PlanInputError("合成数据演练必须提供正数答案键 truthRr");
  if (!input.covariates?.length)
    throw new PlanInputError("注册型外部对照必须预先声明混杂协变量");
  if (!input.contractBundle?.id?.trim() || !input.contractBundle.version?.trim())
    throw new PlanInputError("注册型外部对照必须引用版本化 ContractBundle");
  if (!Number.isInteger(input.contractBundle.minCell) || input.contractBundle.minCell < 1)
    throw new PlanInputError("ContractBundle.minCell 必须 ≥ 1");

  const allSources = [input.trial, ...input.controls];
  const contracts = allSources.map((source) => source.contractId);
  if (new Set(contracts).size !== contracts.length)
    throw new PlanInputError("每个数据源必须绑定独立的成员合约");
  if (new Set(allSources.map((source) => source.participantId)).size !== allSources.length)
    throw new PlanInputError("trial 与外部对照数据源必须来自不同参与方");
  if (new Set(allSources.map((source) => source.dataProductId)).size !== allSources.length)
    throw new PlanInputError("每个数据源必须绑定独立数据产品");

  const urn = (participantId: string) =>
    `urn:tds:${space}:participant:${participantId}`;
  const roles = allSources.map((source, index) => {
    const role =
      index === 0
        ? "trial"
        : index === 1
          ? "external-control-primary"
          : "external-control-secondary";
    if (!SAFE_ROLE.test(role)) throw new PlanInputError(`非法数据源角色 ${role}`);
    return { source, role };
  });

  const stages: LogicalPlanDraft["stages"] = [];
  const sealed: string[] = [];
  for (const { source, role } of roles) {
    const suffix = role.replace(/[^A-Za-z0-9]/g, "");
    stages.push({
      id: `src_${suffix}`,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${source.participantId}/${source.dataProductId}` }],
      params: { uri: `ds://${source.participantId}/${source.dataProductId}` },
    });
    stages.push({
      id: `seal_${suffix}`,
      op: "seal.envelope@1.0.0",
      inputs: [{ from: `src_${suffix}` }],
      params: {
        contractId: source.contractId,
        projection:
          role === "trial" ? "sponsor-trial" : "hospital-controls",
      },
    });
    sealed.push(`seal_${suffix}`);
  }

  const controlUrns = roles
    .filter(({ role }) => role.startsWith("external-control"))
    .map(({ source }) => urn(source.participantId));
  stages.push({
    id: "registration",
    op: "rws.external-control-registration@1.0.0",
    inputs: sealed.map((from) => ({ from })),
    params: {
      parties: roles.map(({ source, role }) => ({
        ref: `seal_${role.replace(/[^A-Za-z0-9]/g, "")}`,
        node: urn(source.participantId),
      })),
      roles: {
        trial: urn(input.trial.participantId),
        controls: controlUrns,
      },
      covariates: [...input.covariates],
      missingness: input.missingness,
      effectMeasure: input.effectMeasure,
      synthetic: input.study.synthetic,
      ...(input.study.synthetic ? { truthRr: input.truthRr } : {}),
      study: {
        profileVersion: input.study.profileVersion,
        timeZero: input.study.timeZero,
        estimandSapVersion: input.study.sapVersion,
      },
    },
    at: input.teeNode,
  });
  stages.push({
    id: "release",
    op: "declassify.small_cell@1.0.0",
    inputs: [{ from: "registration" }],
    params: {
      minCell: Math.max(
        input.contractBundle.minCell,
        input.minCell ?? input.contractBundle.minCell,
      ),
      contractIds: contracts,
      contractBundleId: input.contractBundle.id,
      contractBundleVersion: input.contractBundle.version,
      contractBundleMinCell: input.contractBundle.minCell,
    },
    at: input.teeNode,
  });

  return {
    purpose: input.purpose,
    applicant: input.applicant,
    contracts,
    stages,
    ...(input.ethicsRef ? { ethics_ref: input.ethicsRef } : {}),
    not_before: input.notBefore,
    not_after: input.notAfter,
    contractBundle: {
      id: input.contractBundle.id,
      version: input.contractBundle.version,
    },
    contractBindings: roles.map(({ source, role }) => ({
      contractId: source.contractId,
      participantId: source.participantId,
      dataProductId: source.dataProductId,
      role,
      stages: [
        `src_${role.replace(/[^A-Za-z0-9]/g, "")}`,
        `seal_${role.replace(/[^A-Za-z0-9]/g, "")}`,
      ],
    })),
  };
}

export const externalControlRegistrationTemplate: PlanTemplate = {
  id: "rws.external-control-registration",
  build(input: unknown, ctx: SpiContext) {
    return buildExternalControlRegistrationPlan(
      input as RegistrationExternalControlTemplateInput,
      ctx.spaceId,
    );
  },
};
