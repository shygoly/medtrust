// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { canonicalSm3 } from "@medtrust/mdop";

const SM3 = /^sm3:[0-9a-f]{64}$/;
const REGISTRATION_OPERATOR = "rws.external-control-registration@1.0.0";

export type RegistrationSourceRole =
  | "trial"
  | "external-control-primary"
  | "external-control-secondary";

export type RegistrationEvidenceRole =
  | "primary"
  | "supportive"
  | "exploratory";

export interface RegistrationClinicalGates {
  /** Product, indication, natural history and ECA feasibility reviewed together. */
  clinicalFeasibility: boolean;
  protocolFrozen: boolean;
  sapFrozen: boolean;
  /** Ethics, data-source agreements and regulator-access terms are in force. */
  sourceAgreements: boolean;
  regulatoryCommunication: boolean;
}

export interface RegistrationEvidenceInput {
  createdAt: string;
  study: {
    studyId: string;
    purpose: string;
    product: string;
    indication: string;
    design: "single-arm-with-external-control";
    objective: "superiority";
    evidenceRole: RegistrationEvidenceRole;
    estimand: "ATT" | "ATE";
    estimator: "IPTW-ATT" | "IPTW-ATE";
    timeZero: string;
    outcome: string;
    synthetic: boolean;
    profileVersion: string;
    protocolVersion: string;
    protocolDigest: string;
    sapVersion: string;
    sapDigest: string;
    dslVersion: string;
    dslDigest: string;
    gates: RegistrationClinicalGates;
  };
  sources: Array<{
    role: RegistrationSourceRole;
    participantId: string;
    dataProductId: string;
    contractId: string;
    sourceVersion: string;
    sourceDigest: string;
    projectionDigest: string;
  }>;
  contractBundle: {
    bundleId: string;
    version: string;
    digest: string;
    minCell: number;
    retentionDays?: number;
    teePolicy: "software" | "hardware";
  };
  operator: {
    ref: typeof REGISTRATION_OPERATOR;
    sm3: string;
  };
  plan: {
    jobId: string;
    logicalPlanHash: string;
    planHash: string;
    executionAttestationDigest: string;
  };
  result: {
    digest: string;
    summary: {
      trialN: number;
      controlPoolN: number;
      analysisTrialN: number;
      analysisControlN: number;
      effectEstimate: number;
      ciLow: number;
      ciHigh: number;
      maxAbsSmdAfter: number;
      overlapPassed: boolean;
      missingMode: "MCAR" | "MAR" | "MNAR";
      censoredN: number;
      sensitivityIds: string[];
      syntheticTruthWithinRange?: boolean;
    };
  };
  receipts: Array<{
    node: string;
    auditReceiptDigest: string;
    purgeReceiptDigest?: string;
  }>;
}

export interface RegistrationEvidenceManifest
  extends Omit<RegistrationEvidenceInput, "study"> {
  schema: "medtrust.registration-evidence/v1";
  study: RegistrationEvidenceInput["study"] & {
    boundary: "synthetic-method-validation" | "real-regulatory-study";
  };
  manifestDigest: string;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${path} 不能为空`);
  return value.trim();
}

function digest(value: unknown, path: string): string {
  const v = text(value, path);
  if (!SM3.test(v)) throw new Error(`${path} 必须是 sm3:<64hex>`);
  return v;
}

function count(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new Error(`${path} 必须是非负整数`);
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${path} 必须是有限数值`);
  return value;
}

/**
 * Build a deterministic evidence manifest for one registration-grade external
 * control job. The manifest only carries versions, hashes and aggregate output;
 * source rows and participant link keys are excluded by construction.
 *
 * A synthetic run can be packaged for method validation without the human
 * clinical gates. A real run fails closed until every gate is explicitly true.
 */
export function buildRegistrationEvidenceManifest(
  input: RegistrationEvidenceInput,
): RegistrationEvidenceManifest {
  const createdAt = text(input.createdAt, "createdAt");
  if (!Number.isFinite(Date.parse(createdAt)))
    throw new Error("createdAt 必须是可解析的 RFC3339 时间");

  const s = input.study;
  const study = {
    ...s,
    studyId: text(s.studyId, "study.studyId"),
    purpose: text(s.purpose, "study.purpose"),
    product: text(s.product, "study.product"),
    indication: text(s.indication, "study.indication"),
    timeZero: text(s.timeZero, "study.timeZero"),
    outcome: text(s.outcome, "study.outcome"),
    profileVersion: text(s.profileVersion, "study.profileVersion"),
    protocolVersion: text(s.protocolVersion, "study.protocolVersion"),
    protocolDigest: digest(s.protocolDigest, "study.protocolDigest"),
    sapVersion: text(s.sapVersion, "study.sapVersion"),
    sapDigest: digest(s.sapDigest, "study.sapDigest"),
    dslVersion: text(s.dslVersion, "study.dslVersion"),
    dslDigest: digest(s.dslDigest, "study.dslDigest"),
  };
  if (study.design !== "single-arm-with-external-control")
    throw new Error("证据清单只接受 single-arm-with-external-control");
  if (study.objective !== "superiority")
    throw new Error("外部对照注册研究只接受 superiority；非劣效设计不得打包");
  if (study.estimand === "ATT" && study.estimator !== "IPTW-ATT")
    throw new Error("ATT 必须与 IPTW-ATT 绑定");
  if (study.estimand === "ATE" && study.estimator !== "IPTW-ATE")
    throw new Error("ATE 必须与 IPTW-ATE 绑定");
  if (
    !study.synthetic &&
    !Object.values(study.gates).every((gate) => gate === true)
  )
    throw new Error(
      "真实注册研究证据包要求临床可行性、方案、SAP、数据协议和监管沟通门全部确认",
    );

  const sourceRoles = new Set<RegistrationSourceRole>();
  const sources = input.sources.map((source, index) => {
    if (sourceRoles.has(source.role))
      throw new Error(`数据源角色重复：${source.role}`);
    sourceRoles.add(source.role);
    return {
      role: source.role,
      participantId: text(source.participantId, `sources[${index}].participantId`),
      dataProductId: text(
        source.dataProductId,
        `sources[${index}].dataProductId`,
      ),
      contractId: text(source.contractId, `sources[${index}].contractId`),
      sourceVersion: text(
        source.sourceVersion,
        `sources[${index}].sourceVersion`,
      ),
      sourceDigest: digest(
        source.sourceDigest,
        `sources[${index}].sourceDigest`,
      ),
      projectionDigest: digest(
        source.projectionDigest,
        `sources[${index}].projectionDigest`,
      ),
    };
  });
  if (!sourceRoles.has("trial") || !sourceRoles.has("external-control-primary"))
    throw new Error("证据清单至少需要 trial 与 external-control-primary 两个数据源");
  const contractIds = sources.map((source) => source.contractId);
  if (new Set(contractIds).size !== contractIds.length)
    throw new Error("每个数据源必须绑定独立的成员合约");

  if (input.contractBundle.minCell < 1)
    throw new Error("ContractBundle.minCell 必须 ≥ 1");
  if (
    input.contractBundle.retentionDays !== undefined &&
    (!Number.isInteger(input.contractBundle.retentionDays) ||
      input.contractBundle.retentionDays < 0)
  )
    throw new Error("ContractBundle.retentionDays 必须是非负整数");
  const contractBundle = {
    bundleId: text(input.contractBundle.bundleId, "contractBundle.bundleId"),
    version: text(input.contractBundle.version, "contractBundle.version"),
    digest: digest(input.contractBundle.digest, "contractBundle.digest"),
    minCell: input.contractBundle.minCell,
    ...(input.contractBundle.retentionDays !== undefined
      ? { retentionDays: input.contractBundle.retentionDays }
      : {}),
    teePolicy: input.contractBundle.teePolicy,
  };

  if (input.operator.ref !== REGISTRATION_OPERATOR)
    throw new Error(`证据清单只接受 ${REGISTRATION_OPERATOR}`);
  const operator = {
    ref: input.operator.ref,
    sm3: digest(input.operator.sm3, "operator.sm3"),
  };
  const plan = {
    jobId: text(input.plan.jobId, "plan.jobId"),
    logicalPlanHash: digest(input.plan.logicalPlanHash, "plan.logicalPlanHash"),
    planHash: digest(input.plan.planHash, "plan.planHash"),
    executionAttestationDigest: digest(
      input.plan.executionAttestationDigest,
      "plan.executionAttestationDigest",
    ),
  };

  const r = input.result.summary;
  const trialN = count(r.trialN, "result.summary.trialN");
  const controlPoolN = count(r.controlPoolN, "result.summary.controlPoolN");
  const analysisTrialN = count(
    r.analysisTrialN,
    "result.summary.analysisTrialN",
  );
  const analysisControlN = count(
    r.analysisControlN,
    "result.summary.analysisControlN",
  );
  if (analysisTrialN > trialN || analysisControlN > controlPoolN)
    throw new Error("分析队列不得超过源队列");
  const effectEstimate = finite(
    r.effectEstimate,
    "result.summary.effectEstimate",
  );
  const ciLow = finite(r.ciLow, "result.summary.ciLow");
  const ciHigh = finite(r.ciHigh, "result.summary.ciHigh");
  if (ciLow > effectEstimate || effectEstimate > ciHigh)
    throw new Error("主效应点估计必须落在置信区间内");
  if (typeof r.overlapPassed !== "boolean")
    throw new Error("result.summary.overlapPassed 必须是布尔值");
  const maxAbsSmdAfter = finite(
    r.maxAbsSmdAfter,
    "result.summary.maxAbsSmdAfter",
  );
  if (maxAbsSmdAfter < 0)
    throw new Error("result.summary.maxAbsSmdAfter 不得为负");
  if (
    !Array.isArray(r.sensitivityIds) ||
    r.sensitivityIds.some(
      (id) => typeof id !== "string" || id.trim().length === 0,
    )
  )
    throw new Error("result.summary.sensitivityIds 必须是非空字符串数组");
  if (
    study.synthetic &&
    typeof r.syntheticTruthWithinRange !== "boolean"
  )
    throw new Error("合成数据证据包必须包含答案键对照结论");
  const summary = {
    trialN,
    controlPoolN,
    analysisTrialN,
    analysisControlN,
    effectEstimate,
    ciLow,
    ciHigh,
    maxAbsSmdAfter,
    overlapPassed: r.overlapPassed,
    missingMode: r.missingMode,
    censoredN: count(r.censoredN, "result.summary.censoredN"),
    sensitivityIds: r.sensitivityIds.map((id) => id.trim()).sort(),
    ...(r.syntheticTruthWithinRange !== undefined
      ? { syntheticTruthWithinRange: r.syntheticTruthWithinRange }
      : {}),
  };
  const result = {
    digest: digest(input.result.digest, "result.digest"),
    summary,
  };

  if (input.receipts.length === 0)
    throw new Error("证据清单缺少节点执行与销毁回执");
  const receiptNodes = new Set<string>();
  const receipts = input.receipts
    .map((receipt, index) => {
      const node = text(receipt.node, `receipts[${index}].node`);
      if (receiptNodes.has(node))
        throw new Error(`回执节点重复：${node}`);
      receiptNodes.add(node);
      return {
        node,
        auditReceiptDigest: digest(
          receipt.auditReceiptDigest,
          `receipts[${index}].auditReceiptDigest`,
        ),
        ...(receipt.purgeReceiptDigest !== undefined
          ? {
              purgeReceiptDigest: digest(
                receipt.purgeReceiptDigest,
                `receipts[${index}].purgeReceiptDigest`,
              ),
            }
          : {}),
      };
    })
    .sort((a, b) => a.node.localeCompare(b.node));

  const manifest = {
    schema: "medtrust.registration-evidence/v1" as const,
    createdAt,
    study: {
      ...study,
      boundary: study.synthetic
        ? ("synthetic-method-validation" as const)
        : ("real-regulatory-study" as const),
    },
    sources,
    contractBundle,
    operator,
    plan,
    result,
    receipts,
  };
  return {
    ...manifest,
    manifestDigest: canonicalSm3(manifest),
  };
}
