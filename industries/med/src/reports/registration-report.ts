// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { canonicalSm3 } from "@medtrust/mdop";

export const REGISTRATION_REPORT_SCHEMA = "medtrust.rwd-registration-report/v1";
export const REGISTRATION_REPORT_VERSION = "1.0.0";
export const REQUIRED_SCREENSHOT_STEPS = [
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "A07",
  "A08",
  "A09",
  "A10",
] as const;

export type RegistrationReportStep = (typeof REQUIRED_SCREENSHOT_STEPS)[number];
export type CredentialDisplay = "fictional-only" | "masked" | "none";

export interface RegistrationAssistantMessage {
  id: string;
  role: "user" | "assistant";
  at: string;
  text: string;
  cardType?: "form" | "confirm" | "status" | "result";
}

export interface RegistrationAssistantToolCall {
  id: string;
  name: string;
  at: string;
  success: boolean;
  requestDigest: string;
  responseDigest: string;
}

export interface RegistrationScreenshot {
  stepId: RegistrationReportStep;
  title: string;
  screenshot: string;
  screenshotSha256: string;
  capturedAt: string;
  sessionId: string;
  assistantMessageId: string;
  cardType: "form" | "confirm" | "status" | "result";
  toolName: string;
  toolRequestDigest: string;
  toolResponseDigest: string;
  backendResource: Record<string, string | number>;
  credentialDisplay: CredentialDisplay;
}

export interface RegistrationReportInput {
  metadata: {
    generatedAt: string;
    language: "zh-CN";
    syntheticOnly: boolean;
  };
  assistantSession: {
    sessionId: string;
    userRole: string;
    credentialPolicy: "fictional-fixture-only" | "real-credentials-redacted";
    messages: RegistrationAssistantMessage[];
    toolCalls: RegistrationAssistantToolCall[];
    screenshots: RegistrationScreenshot[];
  };
  study: {
    studyId: string;
    product: string;
    indication: string;
    evidenceRole: "primary" | "supportive" | "exploratory";
    design: "single-arm-with-external-control";
    objective: "superiority";
  };
  protocol: {
    protocolVersion: string;
    protocolDigest: string;
    sapVersion: string;
    sapDigest: string;
    p0Decisions: Array<{ id: string; decision: string; status: string }>;
  };
  targetTrial: {
    population: string;
    treatmentStrategies: { trial: string; externalControl: string };
    timeZero: string;
    followUp: string;
    outcome: string;
    intercurrentEvents: string;
  };
  estimand: {
    type: "ATT";
    summaryMeasure: "risk-ratio" | "risk-difference";
    sensitivityPolicy: string;
  };
  sources: Array<{
    role: "trial" | "external-control-primary" | "external-control-secondary";
    participantId: string;
    dataProductId: string;
    contractId: string;
    sourceVersion: string;
    sourceDigest: string;
    projectionDigest: string;
  }>;
  cohort: {
    trialN: number;
    controlPoolN: number;
    analysisTrialN: number;
    analysisControlN: number;
    exclusions: Array<{ reason: string; count: number }>;
  };
  methods: {
    propensityModel: string;
    covariates: string[];
    trimLow: number;
    trimHigh: number;
    missingPlan: string;
    censoringPlan: string;
    failClosedRules: string[];
  };
  result: {
    riskTreated: number;
    riskControl: number;
    riskDifference: number;
    riskRatio: number;
    riskDifferenceCi: [number, number];
    riskRatioCi: [number, number];
  };
  diagnostics: {
    balance: Array<{ covariate: string; smdBefore: number; smdAfter: number }>;
    overlap: {
      minPropensity: number;
      maxPropensity: number;
      trimmed: number;
      eesTrial: number;
      eesControl: number;
    };
    weights: {
      maxWeight: number;
      p99Weight: number;
      truncatedFraction: number;
      effectiveSampleSize: number;
    };
    missingness: {
      mode: "MCAR" | "MAR" | "MNAR";
      missingFraction: number;
      imputedN: number;
    };
    censoring: {
      observedN: number;
      censoredN: number;
      competingRiskN: number;
    };
  };
  sensitivity: Array<{
    id: string;
    estimate: number;
    ciLow: number;
    ciHigh: number;
    direction: string;
  }>;
  truthRecovery: {
    truthRr: number;
    adjustedRr: number;
    crudeRr: number;
    adjustedAbsoluteError: number;
    crudeAbsoluteError: number;
    withinExpectedRange: boolean;
    answerKeyDigest: string;
  };
  heterogeneity: {
    primaryRr: number;
    secondaryRr: number | null;
    conclusion: string;
  };
  bias: {
    negativeControl: string;
    quantitativeBias: string;
  };
  limitations: string[];
  execution: {
    jobId: string;
    logicalPlanHash: string;
    planHash: string;
    operatorRef: "rws.external-control-registration@1.0.0";
    operatorSm3: string;
    teePolicy: "software" | "hardware";
    receipts: Array<{ node: string; auditReceiptDigest: string; purgeReceiptDigest?: string }>;
    chainsValid: boolean;
  };
  evidence: {
    evidenceManifestDigest: string;
    reportInputDigest?: string;
  };
  independentReview: {
    reviewerId: string;
    reviewedAt: string;
    protocolDigest: string;
    sapDigest: string;
    verdict: "approved" | "rejected";
    conclusion: string;
  };
  deviations: Array<{ at: string; description: string; rationale: string }>;
}

export interface RegistrationReport extends RegistrationReportInput {
  schema: typeof REGISTRATION_REPORT_SCHEMA;
  reportVersion: typeof REGISTRATION_REPORT_VERSION;
  boundary: "SIMULATION ONLY — NOT CLINICAL OR REGULATORY EVIDENCE";
  reportFingerprint: string;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

const REPORT_KEYS = new Set([
  "metadata",
  "assistantSession",
  "study",
  "protocol",
  "targetTrial",
  "estimand",
  "sources",
  "cohort",
  "methods",
  "result",
  "diagnostics",
  "sensitivity",
  "truthRecovery",
  "heterogeneity",
  "bias",
  "limitations",
  "execution",
  "evidence",
  "independentReview",
  "deviations",
]);

function rejectUnknownKeys(
  value: Record<string, unknown>,
  path: string,
  allowed: Set<string>,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0)
    throw new Error(`${path} contains unknown field(s): ${unknown.join(", ")}`);
}

function rejectRowLevelKeys(value: unknown, path = "report"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectRowLevelKeys(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:linkKey|subjectKey|patientId|personId|recordId|row[A-Z])/i.test(key))
      throw new Error(`${path}.${key} is a row-level identifier and cannot enter a report`);
    rejectRowLevelKeys(child, `${path}.${key}`);
  }
}

function array(value: unknown, path: string, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum)
    throw new Error(`${path} must be an array with at least ${minimum} item(s)`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${path} must be a non-empty string`);
  return value.trim();
}

function numberValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${path} must be a finite number`);
  return value;
}

function integer(value: unknown, path: string): number {
  const parsed = numberValue(value, path);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`${path} must be a non-negative integer`);
  return parsed;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
  return value;
}

function digest(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!/^(?:sm3:)?[0-9a-f]{64}$/i.test(parsed))
    throw new Error(`${path} must be a 64-hex digest`);
  return parsed;
}

function sha256(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!/^[0-9a-f]{64}$/i.test(parsed))
    throw new Error(`${path} must be a SHA-256 digest`);
  return parsed.toLowerCase();
}

function rejectSecretText(value: string, path: string): void {
  if (
    /\b(?:bearer\s+[a-z0-9._-]+|access[_-]?token|cookie|refresh[_-]?token|kms[_-]?(?:key|secret))\b/i.test(
      value,
    )
  )
    throw new Error(`${path} contains credential-like secret material`);
}

function mapBalance(value: unknown): RegistrationReportInput["diagnostics"]["balance"] {
  return array(value, "diagnostics.balance", 1).map((item, index) => {
    const row = record(item, `diagnostics.balance[${index}]`);
    return {
      covariate: text(row.covariate, `diagnostics.balance[${index}].covariate`),
      smdBefore: numberValue(row.smdBefore, `diagnostics.balance[${index}].smdBefore`),
      smdAfter: numberValue(row.smdAfter, `diagnostics.balance[${index}].smdAfter`),
    };
  });
}

function validateAssistant(
  input: unknown,
  syntheticOnly: boolean,
): RegistrationReportInput["assistantSession"] {
  const session = record(input, "assistantSession");
  const sessionId = text(session.sessionId, "assistantSession.sessionId");
  const credentialPolicy = text(
    session.credentialPolicy,
    "assistantSession.credentialPolicy",
  );
  if (
    credentialPolicy !== "fictional-fixture-only" &&
    credentialPolicy !== "real-credentials-redacted"
  )
    throw new Error("assistantSession.credentialPolicy is invalid");
  if (!syntheticOnly && credentialPolicy !== "real-credentials-redacted")
    throw new Error("real studies must redact credentials");

  const messages = array(session.messages, "assistantSession.messages", 1).map(
    (item, index) => {
      const row = record(item, `assistantSession.messages[${index}]`);
      const role = text(row.role, `assistantSession.messages[${index}].role`);
      if (role !== "user" && role !== "assistant")
        throw new Error(`assistantSession.messages[${index}].role is invalid`);
      const messageText = text(row.text, `assistantSession.messages[${index}].text`);
      rejectSecretText(messageText, `assistantSession.messages[${index}].text`);
      const cardType = row.cardType;
      if (
        cardType !== undefined &&
        !["form", "confirm", "status", "result"].includes(String(cardType))
      )
        throw new Error(`assistantSession.messages[${index}].cardType is invalid`);
      return {
        id: text(row.id, `assistantSession.messages[${index}].id`),
        role: role as RegistrationAssistantMessage["role"],
        at: text(row.at, `assistantSession.messages[${index}].at`),
        text: messageText,
        ...(cardType
          ? { cardType: cardType as RegistrationAssistantMessage["cardType"] }
          : {}),
      };
    },
  );
  const messageIds = new Set(messages.map((message) => message.id));

  const toolCalls = array(session.toolCalls, "assistantSession.toolCalls", 1).map(
    (item, index) => {
      const row = record(item, `assistantSession.toolCalls[${index}]`);
      return {
        id: text(row.id, `assistantSession.toolCalls[${index}].id`),
        name: text(row.name, `assistantSession.toolCalls[${index}].name`),
        at: text(row.at, `assistantSession.toolCalls[${index}].at`),
        success: booleanValue(row.success, `assistantSession.toolCalls[${index}].success`),
        requestDigest: digest(
          row.requestDigest,
          `assistantSession.toolCalls[${index}].requestDigest`,
        ),
        responseDigest: digest(
          row.responseDigest,
          `assistantSession.toolCalls[${index}].responseDigest`,
        ),
      };
    },
  );
  const toolNames = new Set(toolCalls.map((call) => call.name));

  const screenshots = array(session.screenshots, "assistantSession.screenshots", 10).map(
    (item, index) => {
      const row = record(item, `assistantSession.screenshots[${index}]`);
      const stepId = text(row.stepId, `assistantSession.screenshots[${index}].stepId`);
      if (!REQUIRED_SCREENSHOT_STEPS.includes(stepId as RegistrationReportStep))
        throw new Error(`assistantSession.screenshots[${index}].stepId is invalid`);
      const assistantMessageId = text(
        row.assistantMessageId,
        `assistantSession.screenshots[${index}].assistantMessageId`,
      );
      if (!messageIds.has(assistantMessageId))
        throw new Error(`screenshot ${stepId} references an unknown assistant message`);
      const toolName = text(row.toolName, `assistantSession.screenshots[${index}].toolName`);
      if (!toolNames.has(toolName))
        throw new Error(`screenshot ${stepId} references an unknown tool call`);
      const credentialDisplay = text(
        row.credentialDisplay,
        `assistantSession.screenshots[${index}].credentialDisplay`,
      );
      if (
        credentialDisplay !== "fictional-only" &&
        credentialDisplay !== "masked" &&
        credentialDisplay !== "none"
      )
        throw new Error(`screenshot ${stepId} credentialDisplay is invalid`);
      // D-TRUST-13: 双向凭据边界强制（与计划 §3 安全校验对齐）
      if (credentialDisplay === "fictional-only" && !syntheticOnly)
        throw new Error(
          "fictional-only credentials are allowed only for synthetic reports (syntheticOnly=true)",
        );
      if (syntheticOnly && credentialDisplay !== "fictional-only" && credentialDisplay !== "none")
        throw new Error(
          "synthetic reports must not display real credentials (credentialDisplay must be fictional-only or none)",
        );
      return {
        stepId: stepId as RegistrationReportStep,
        title: text(row.title, `assistantSession.screenshots[${index}].title`),
        screenshot: text(
          row.screenshot,
          `assistantSession.screenshots[${index}].screenshot`,
        ),
        screenshotSha256: sha256(
          row.screenshotSha256,
          `assistantSession.screenshots[${index}].screenshotSha256`,
        ),
        capturedAt: text(
          row.capturedAt,
          `assistantSession.screenshots[${index}].capturedAt`,
        ),
        sessionId: text(
          row.sessionId,
          `assistantSession.screenshots[${index}].sessionId`,
        ),
        assistantMessageId,
        cardType: text(
          row.cardType,
          `assistantSession.screenshots[${index}].cardType`,
        ) as RegistrationScreenshot["cardType"],
        toolName,
        toolRequestDigest: digest(
          row.toolRequestDigest,
          `assistantSession.screenshots[${index}].toolRequestDigest`,
        ),
        toolResponseDigest: digest(
          row.toolResponseDigest,
          `assistantSession.screenshots[${index}].toolResponseDigest`,
        ),
        backendResource: record(
          row.backendResource,
          `assistantSession.screenshots[${index}].backendResource`,
        ) as Record<string, string | number>,
        credentialDisplay: credentialDisplay as CredentialDisplay,
      };
    },
  );
  for (const screenshot of screenshots) {
    if (screenshot.sessionId !== sessionId)
      throw new Error(`screenshot ${screenshot.stepId} belongs to another session`);
  }
  const steps = new Set(screenshots.map((screenshot) => screenshot.stepId));
  for (const step of REQUIRED_SCREENSHOT_STEPS)
    if (!steps.has(step)) throw new Error(`missing assistant screenshot ${step}`);
  if (steps.size !== screenshots.length)
    throw new Error("duplicate assistant screenshot step");

  return {
    sessionId,
    userRole: text(session.userRole, "assistantSession.userRole"),
    credentialPolicy: credentialPolicy as RegistrationReportInput["assistantSession"]["credentialPolicy"],
    messages,
    toolCalls,
    screenshots,
  };
}

export function buildRegistrationReport(input: RegistrationReportInput): RegistrationReport {
  const root = record(input, "report");
  rejectUnknownKeys(root, "report", REPORT_KEYS);
  rejectRowLevelKeys(root);
  const metadataRaw = record(root.metadata, "metadata");
  const syntheticOnly = booleanValue(metadataRaw.syntheticOnly, "metadata.syntheticOnly");
  const metadata: RegistrationReportInput["metadata"] = {
    generatedAt: text(metadataRaw.generatedAt, "metadata.generatedAt"),
    language: "zh-CN",
    syntheticOnly,
  };
  const assistantSession = validateAssistant(root.assistantSession, syntheticOnly);

  const studyRaw = record(root.study, "study");
  const study: RegistrationReportInput["study"] = {
    studyId: text(studyRaw.studyId, "study.studyId"),
    product: text(studyRaw.product, "study.product"),
    indication: text(studyRaw.indication, "study.indication"),
    evidenceRole: text(studyRaw.evidenceRole, "study.evidenceRole") as RegistrationReportInput["study"]["evidenceRole"],
    design: "single-arm-with-external-control",
    objective: "superiority",
  };

  const protocolRaw = record(root.protocol, "protocol");
  const protocol: RegistrationReportInput["protocol"] = {
    protocolVersion: text(protocolRaw.protocolVersion, "protocol.protocolVersion"),
    protocolDigest: digest(protocolRaw.protocolDigest, "protocol.protocolDigest"),
    sapVersion: text(protocolRaw.sapVersion, "protocol.sapVersion"),
    sapDigest: digest(protocolRaw.sapDigest, "protocol.sapDigest"),
    p0Decisions: array(protocolRaw.p0Decisions, "protocol.p0Decisions", 1).map(
      (item, index) => {
        const row = record(item, `protocol.p0Decisions[${index}]`);
        return {
          id: text(row.id, `protocol.p0Decisions[${index}].id`),
          decision: text(row.decision, `protocol.p0Decisions[${index}].decision`),
          status: text(row.status, `protocol.p0Decisions[${index}].status`),
        };
      },
    ),
  };
  if (!syntheticOnly && protocol.p0Decisions.some((decision) => decision.status !== "frozen"))
    throw new Error("real reports require frozen P0 decisions");

  const targetRaw = record(root.targetTrial, "targetTrial");
  const strategies = record(targetRaw.treatmentStrategies, "targetTrial.treatmentStrategies");
  const targetTrial: RegistrationReportInput["targetTrial"] = {
    population: text(targetRaw.population, "targetTrial.population"),
    treatmentStrategies: {
      trial: text(strategies.trial, "targetTrial.treatmentStrategies.trial"),
      externalControl: text(
        strategies.externalControl,
        "targetTrial.treatmentStrategies.externalControl",
      ),
    },
    timeZero: text(targetRaw.timeZero, "targetTrial.timeZero"),
    followUp: text(targetRaw.followUp, "targetTrial.followUp"),
    outcome: text(targetRaw.outcome, "targetTrial.outcome"),
    intercurrentEvents: text(targetRaw.intercurrentEvents, "targetTrial.intercurrentEvents"),
  };

  const estimandRaw = record(root.estimand, "estimand");
  if (estimandRaw.type !== "ATT") throw new Error("estimand.type must be ATT");
  const summaryMeasure = text(estimandRaw.summaryMeasure, "estimand.summaryMeasure");
  if (summaryMeasure !== "risk-ratio" && summaryMeasure !== "risk-difference")
    throw new Error("estimand.summaryMeasure is invalid");
  const estimand: RegistrationReportInput["estimand"] = {
    type: "ATT",
    summaryMeasure,
    sensitivityPolicy: text(estimandRaw.sensitivityPolicy, "estimand.sensitivityPolicy"),
  };

  const sources = array(root.sources, "sources", 2).map((item, index) => {
    const row = record(item, `sources[${index}]`);
    const role = text(row.role, `sources[${index}].role`);
    if (
      role !== "trial" &&
      role !== "external-control-primary" &&
      role !== "external-control-secondary"
    )
      throw new Error(`sources[${index}].role is invalid`);
    return {
      role,
      participantId: text(row.participantId, `sources[${index}].participantId`),
      dataProductId: text(row.dataProductId, `sources[${index}].dataProductId`),
      contractId: text(row.contractId, `sources[${index}].contractId`),
      sourceVersion: text(row.sourceVersion, `sources[${index}].sourceVersion`),
      sourceDigest: digest(row.sourceDigest, `sources[${index}].sourceDigest`),
      projectionDigest: digest(row.projectionDigest, `sources[${index}].projectionDigest`),
    } as RegistrationReportInput["sources"][number];
  });
  const sourceRoles = new Set(sources.map((source) => source.role));
  if (!sourceRoles.has("trial") || !sourceRoles.has("external-control-primary"))
    throw new Error("report requires trial and primary external-control sources");
  if (new Set(sources.map((source) => source.contractId)).size !== sources.length)
    throw new Error("each report source requires an independent contract");

  const cohortRaw = record(root.cohort, "cohort");
  const exclusions = array(cohortRaw.exclusions, "cohort.exclusions").map((item, index) => {
    const row = record(item, `cohort.exclusions[${index}]`);
    return {
      reason: text(row.reason, `cohort.exclusions[${index}].reason`),
      count: integer(row.count, `cohort.exclusions[${index}].count`),
    };
  });
  const cohort: RegistrationReportInput["cohort"] = {
    trialN: integer(cohortRaw.trialN, "cohort.trialN"),
    controlPoolN: integer(cohortRaw.controlPoolN, "cohort.controlPoolN"),
    analysisTrialN: integer(cohortRaw.analysisTrialN, "cohort.analysisTrialN"),
    analysisControlN: integer(cohortRaw.analysisControlN, "cohort.analysisControlN"),
    exclusions,
  };
  if (
    cohort.analysisTrialN > cohort.trialN ||
    cohort.analysisControlN > cohort.controlPoolN
  )
    throw new Error("analysis cohort exceeds source cohort");

  const methodsRaw = record(root.methods, "methods");
  const methods: RegistrationReportInput["methods"] = {
    propensityModel: text(methodsRaw.propensityModel, "methods.propensityModel"),
    covariates: array(methodsRaw.covariates, "methods.covariates", 1).map((item, index) =>
      text(item, `methods.covariates[${index}]`),
    ),
    trimLow: numberValue(methodsRaw.trimLow, "methods.trimLow"),
    trimHigh: numberValue(methodsRaw.trimHigh, "methods.trimHigh"),
    missingPlan: text(methodsRaw.missingPlan, "methods.missingPlan"),
    censoringPlan: text(methodsRaw.censoringPlan, "methods.censoringPlan"),
    failClosedRules: array(methodsRaw.failClosedRules, "methods.failClosedRules", 1).map(
      (item, index) => text(item, `methods.failClosedRules[${index}]`),
    ),
  };
  if (methods.trimLow < 0 || methods.trimHigh > 1 || methods.trimLow >= methods.trimHigh)
    throw new Error("invalid propensity trim bounds");

  const resultRaw = record(root.result, "result");
  const result: RegistrationReportInput["result"] = {
    riskTreated: numberValue(resultRaw.riskTreated, "result.riskTreated"),
    riskControl: numberValue(resultRaw.riskControl, "result.riskControl"),
    riskDifference: numberValue(resultRaw.riskDifference, "result.riskDifference"),
    riskRatio: numberValue(resultRaw.riskRatio, "result.riskRatio"),
    riskDifferenceCi: array(resultRaw.riskDifferenceCi, "result.riskDifferenceCi", 2).map(
      (value, index) => numberValue(value, `result.riskDifferenceCi[${index}]`),
    ) as [number, number],
    riskRatioCi: array(resultRaw.riskRatioCi, "result.riskRatioCi", 2).map(
      (value, index) => numberValue(value, `result.riskRatioCi[${index}]`),
    ) as [number, number],
  };
  if (
    result.riskDifferenceCi[0] > result.riskDifference ||
    result.riskDifference > result.riskDifferenceCi[1] ||
    result.riskRatioCi[0] > result.riskRatio ||
    result.riskRatio > result.riskRatioCi[1]
  )
    throw new Error("effect estimate must fall within its confidence interval");

  const diagnosticsRaw = record(root.diagnostics, "diagnostics");
  const overlapRaw = record(diagnosticsRaw.overlap, "diagnostics.overlap");
  const weightsRaw = record(diagnosticsRaw.weights, "diagnostics.weights");
  const missingRaw = record(diagnosticsRaw.missingness, "diagnostics.missingness");
  const censoringRaw = record(diagnosticsRaw.censoring, "diagnostics.censoring");
  const diagnostics: RegistrationReportInput["diagnostics"] = {
    balance: mapBalance(diagnosticsRaw.balance),
    overlap: {
      minPropensity: numberValue(overlapRaw.minPropensity, "diagnostics.overlap.minPropensity"),
      maxPropensity: numberValue(overlapRaw.maxPropensity, "diagnostics.overlap.maxPropensity"),
      trimmed: integer(overlapRaw.trimmed, "diagnostics.overlap.trimmed"),
      eesTrial: numberValue(overlapRaw.eesTrial, "diagnostics.overlap.eesTrial"),
      eesControl: numberValue(overlapRaw.eesControl, "diagnostics.overlap.eesControl"),
    },
    weights: {
      maxWeight: numberValue(weightsRaw.maxWeight, "diagnostics.weights.maxWeight"),
      p99Weight: numberValue(weightsRaw.p99Weight, "diagnostics.weights.p99Weight"),
      truncatedFraction: numberValue(
        weightsRaw.truncatedFraction,
        "diagnostics.weights.truncatedFraction",
      ),
      effectiveSampleSize: numberValue(
        weightsRaw.effectiveSampleSize,
        "diagnostics.weights.effectiveSampleSize",
      ),
    },
    missingness: {
      mode: text(missingRaw.mode, "diagnostics.missingness.mode") as "MCAR" | "MAR" | "MNAR",
      missingFraction: numberValue(
        missingRaw.missingFraction,
        "diagnostics.missingness.missingFraction",
      ),
      imputedN: integer(missingRaw.imputedN, "diagnostics.missingness.imputedN"),
    },
    censoring: {
      observedN: integer(censoringRaw.observedN, "diagnostics.censoring.observedN"),
      censoredN: integer(censoringRaw.censoredN, "diagnostics.censoring.censoredN"),
      competingRiskN: integer(
        censoringRaw.competingRiskN,
        "diagnostics.censoring.competingRiskN",
      ),
    },
  };
  if (!["MCAR", "MAR", "MNAR"].includes(diagnostics.missingness.mode))
    throw new Error("missingness mode must be MCAR, MAR, or MNAR");

  const sensitivity = array(root.sensitivity, "sensitivity", 1).map((item, index) => {
    const row = record(item, `sensitivity[${index}]`);
    const estimate = numberValue(row.estimate, `sensitivity[${index}].estimate`);
    const ciLow = numberValue(row.ciLow, `sensitivity[${index}].ciLow`);
    const ciHigh = numberValue(row.ciHigh, `sensitivity[${index}].ciHigh`);
    if (ciLow > estimate || estimate > ciHigh)
      throw new Error(`sensitivity[${index}] estimate is outside its interval`);
    return {
      id: text(row.id, `sensitivity[${index}].id`),
      estimate,
      ciLow,
      ciHigh,
      direction: text(row.direction, `sensitivity[${index}].direction`),
    };
  });

  const truthRaw = record(root.truthRecovery, "truthRecovery");
  const truthRecovery: RegistrationReportInput["truthRecovery"] = {
    truthRr: numberValue(truthRaw.truthRr, "truthRecovery.truthRr"),
    adjustedRr: numberValue(truthRaw.adjustedRr, "truthRecovery.adjustedRr"),
    crudeRr: numberValue(truthRaw.crudeRr, "truthRecovery.crudeRr"),
    adjustedAbsoluteError: numberValue(
      truthRaw.adjustedAbsoluteError,
      "truthRecovery.adjustedAbsoluteError",
    ),
    crudeAbsoluteError: numberValue(
      truthRaw.crudeAbsoluteError,
      "truthRecovery.crudeAbsoluteError",
    ),
    withinExpectedRange: booleanValue(
      truthRaw.withinExpectedRange,
      "truthRecovery.withinExpectedRange",
    ),
    answerKeyDigest: digest(
      truthRaw.answerKeyDigest,
      "truthRecovery.answerKeyDigest",
    ),
  };
  if (syntheticOnly && !truthRecovery.withinExpectedRange)
    throw new Error("synthetic report truth recovery must be within range");

  const heteroRaw = record(root.heterogeneity, "heterogeneity");
  const heterogeneity: RegistrationReportInput["heterogeneity"] = {
    primaryRr: numberValue(heteroRaw.primaryRr, "heterogeneity.primaryRr"),
    secondaryRr:
      heteroRaw.secondaryRr === null
        ? null
        : numberValue(heteroRaw.secondaryRr, "heterogeneity.secondaryRr"),
    conclusion: text(heteroRaw.conclusion, "heterogeneity.conclusion"),
  };

  const biasRaw = record(root.bias, "bias");
  const bias: RegistrationReportInput["bias"] = {
    negativeControl: text(biasRaw.negativeControl, "bias.negativeControl"),
    quantitativeBias: text(biasRaw.quantitativeBias, "bias.quantitativeBias"),
  };

  const limitations = array(root.limitations, "limitations", 1).map((item, index) =>
    text(item, `limitations[${index}]`),
  );

  const executionRaw = record(root.execution, "execution");
  if (
    executionRaw.operatorRef !==
    "rws.external-control-registration@1.0.0"
  )
    throw new Error("execution.operatorRef is invalid");
  if (executionRaw.teePolicy !== "software" && executionRaw.teePolicy !== "hardware")
    throw new Error("execution.teePolicy is invalid");
  const receipts = array(executionRaw.receipts, "execution.receipts", 1).map(
    (item, index) => {
      const row = record(item, `execution.receipts[${index}]`);
      return {
        node: text(row.node, `execution.receipts[${index}].node`),
        auditReceiptDigest: digest(
          row.auditReceiptDigest,
          `execution.receipts[${index}].auditReceiptDigest`,
        ),
        ...(row.purgeReceiptDigest !== undefined
          ? {
              purgeReceiptDigest: digest(
                row.purgeReceiptDigest,
                `execution.receipts[${index}].purgeReceiptDigest`,
              ),
            }
          : {}),
      };
    },
  );
  const chainsValid = booleanValue(executionRaw.chainsValid, "execution.chainsValid");
  if (!chainsValid) throw new Error("report requires valid execution receipt chains");
  const execution: RegistrationReportInput["execution"] = {
    jobId: text(executionRaw.jobId, "execution.jobId"),
    logicalPlanHash: digest(executionRaw.logicalPlanHash, "execution.logicalPlanHash"),
    planHash: digest(executionRaw.planHash, "execution.planHash"),
    operatorRef: "rws.external-control-registration@1.0.0",
    operatorSm3: digest(executionRaw.operatorSm3, "execution.operatorSm3"),
    teePolicy: executionRaw.teePolicy,
    receipts,
    chainsValid,
  };

  const evidenceRaw = record(root.evidence, "evidence");
  const evidence: RegistrationReportInput["evidence"] = {
    evidenceManifestDigest: digest(
      evidenceRaw.evidenceManifestDigest,
      "evidence.evidenceManifestDigest",
    ),
  };
  const reviewRaw = record(root.independentReview, "independentReview");
  const reviewVerdict = text(
    reviewRaw.verdict,
    "independentReview.verdict",
  );
  if (reviewVerdict !== "approved" && reviewVerdict !== "rejected")
    throw new Error("independentReview.verdict must be approved or rejected");
  const independentReview: RegistrationReportInput["independentReview"] = {
    reviewerId: text(
      reviewRaw.reviewerId,
      "independentReview.reviewerId",
    ),
    reviewedAt: text(
      reviewRaw.reviewedAt,
      "independentReview.reviewedAt",
    ),
    protocolDigest: digest(
      reviewRaw.protocolDigest,
      "independentReview.protocolDigest",
    ),
    sapDigest: digest(
      reviewRaw.sapDigest,
      "independentReview.sapDigest",
    ),
    verdict: reviewVerdict,
    conclusion: text(
      reviewRaw.conclusion,
      "independentReview.conclusion",
    ),
  };
  if (independentReview.protocolDigest !== protocol.protocolDigest)
    throw new Error("independent review does not match the protocol digest");
  if (independentReview.sapDigest !== protocol.sapDigest)
    throw new Error("independent review does not match the SAP digest");
  if (syntheticOnly && independentReview.verdict !== "approved")
    throw new Error("synthetic reports require an approved independent review");
  const deviations = array(root.deviations, "deviations").map((item, index) => {
    const row = record(item, `deviations[${index}]`);
    return {
      at: text(row.at, `deviations[${index}].at`),
      description: text(row.description, `deviations[${index}].description`),
      rationale: text(row.rationale, `deviations[${index}].rationale`),
    };
  });

  const normalized: RegistrationReportInput = {
    metadata,
    assistantSession,
    study,
    protocol,
    targetTrial,
    estimand,
    sources,
    cohort,
    methods,
    result,
    diagnostics,
    sensitivity,
    truthRecovery,
    heterogeneity,
    bias,
    limitations,
    execution,
    evidence,
    independentReview,
    deviations,
  };
  const reportFingerprint = canonicalSm3({
    schema: REGISTRATION_REPORT_SCHEMA,
    reportVersion: REGISTRATION_REPORT_VERSION,
    report: normalized,
  });
  return {
    schema: REGISTRATION_REPORT_SCHEMA,
    reportVersion: REGISTRATION_REPORT_VERSION,
    boundary: "SIMULATION ONLY — NOT CLINICAL OR REGULATORY EVIDENCE",
    ...normalized,
    reportFingerprint,
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function num(value: number): string {
  return value.toFixed(3);
}

type MarkdownRow = Array<string | number>;

function markdownTable(headers: MarkdownRow, rows: MarkdownRow[]): string[] {
  const clean = (value: string | number) => String(value).replace(/\|/g, "\\|");
  return [
    `| ${headers.map(clean).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(clean).join(" | ")} |`),
  ];
}

export function renderRegistrationReportMarkdown(report: RegistrationReport): string {
  const lines: string[] = [
    "# RWD 单臂外部对照注册研究报告",
    "",
    "> **SIMULATION ONLY / 仅用于模拟与方法学验证。不得作为真实临床、安全性或注册结论。**",
    "",
    "## 文档控制",
    "",
  ];
  lines.push(
    ...markdownTable(
      ["字段", "值"],
      [
        ["Study", report.study.studyId],
        ["Product", report.study.product],
        ["Indication", report.study.indication],
        ["Protocol", report.protocol.protocolVersion],
        ["SAP", report.protocol.sapVersion],
        ["Report schema", report.schema],
        ["Report version", report.reportVersion],
        ["Operator", report.execution.operatorRef],
        ["Independent reviewer", report.independentReview.reviewerId],
        ["Review verdict", report.independentReview.verdict],
        ["Job", report.execution.jobId],
        ["Report fingerprint", report.reportFingerprint],
      ],
    ),
  );
  lines.push(
    "",
    "## AI 助手执行摘要",
    "",
    ...markdownTable(
      ["Step", "Screenshot", "Credential display"],
      report.assistantSession.screenshots.map((shot) => [
        shot.stepId,
        shot.title,
        shot.credentialDisplay,
      ]),
    ),
  );
  lines.push(
    "",
    "## 执行结论",
    "",
    `主分析为 ATT ${report.estimand.summaryMeasure}：${num(report.result.riskRatio)}（95% CI ${num(report.result.riskRatioCi[0])}–${num(report.result.riskRatioCi[1])}）。`,
    `加权后最大绝对 SMD 为 ${num(Math.max(...report.diagnostics.balance.map((row) => Math.abs(row.smdAfter))))}。截尾 ${report.diagnostics.overlap.trimmed} 人，有效样本量 ${num(report.diagnostics.weights.effectiveSampleSize)}。`,
    "",
    "## 研究设计",
    "",
  );
  lines.push(
    ...markdownTable(
      ["项目", "内容"],
      [
        ["Design", report.study.design],
        ["Objective", report.study.objective],
        ["Population", report.targetTrial.population],
        ["Trial strategy", report.targetTrial.treatmentStrategies.trial],
        ["External strategy", report.targetTrial.treatmentStrategies.externalControl],
        ["Time zero", report.targetTrial.timeZero],
        ["Follow-up", report.targetTrial.followUp],
        ["Outcome", report.targetTrial.outcome],
        ["Intercurrent events", report.targetTrial.intercurrentEvents],
      ],
    ),
  );
  lines.push(
    "",
    "## 数据源与契约",
    "",
    ...markdownTable(
      ["Role", "Participant", "Data product", "Contract", "Version"],
      report.sources.map((source) => [
        source.role,
        source.participantId,
        source.dataProductId,
        source.contractId,
        source.sourceVersion,
      ]),
    ),
  );
  lines.push(
    "",
    "## 队列",
    "",
    ...markdownTable(
      ["指标", "数量"],
      [
        ["Trial", report.cohort.trialN],
        ["Control pool", report.cohort.controlPoolN],
        ["Analysis trial", report.cohort.analysisTrialN],
        ["Analysis control", report.cohort.analysisControlN],
      ],
    ),
  );
  lines.push(
    "",
    ...markdownTable(
      ["Exclusion", "Count"],
      report.cohort.exclusions.map((row) => [row.reason, row.count]),
    ),
  );
  lines.push(
    "",
    "## 统计方法",
    "",
    `- Propensity model: ${report.methods.propensityModel}`,
    `- Covariates: ${report.methods.covariates.join(", ")}`,
    `- Trim: [${report.methods.trimLow}, ${report.methods.trimHigh}]`,
    `- Missing plan: ${report.methods.missingPlan}`,
    `- Censoring plan: ${report.methods.censoringPlan}`,
    ...report.methods.failClosedRules.map((rule) => `- Fail-closed: ${rule}`),
    "",
    "## 主要结果",
    "",
  );
  lines.push(
    ...markdownTable(
      ["指标", "估计", "95% CI"],
      [
        ["Trial risk", num(report.result.riskTreated), "—"],
        ["Control risk", num(report.result.riskControl), "—"],
        ["Risk difference", num(report.result.riskDifference), `${num(report.result.riskDifferenceCi[0])}–${num(report.result.riskDifferenceCi[1])}`],
        ["Risk ratio", num(report.result.riskRatio), `${num(report.result.riskRatioCi[0])}–${num(report.result.riskRatioCi[1])}`],
      ],
    ),
  );
  lines.push(
    "",
    "## 平衡与 overlap",
    "",
    ...markdownTable(
      ["Covariate", "SMD before", "SMD after"],
      report.diagnostics.balance.map((row) => [row.covariate, num(row.smdBefore), num(row.smdAfter)]),
    ),
  );
  lines.push(
    "",
    `Propensity range ${num(report.diagnostics.overlap.minPropensity)}–${num(report.diagnostics.overlap.maxPropensity)}; trimmed ${report.diagnostics.overlap.trimmed}; ESS trial ${num(report.diagnostics.overlap.eesTrial)}, control ${num(report.diagnostics.overlap.eesControl)}.`,
    `Max weight ${num(report.diagnostics.weights.maxWeight)}, P99 ${num(report.diagnostics.weights.p99Weight)}, truncated fraction ${pct(report.diagnostics.weights.truncatedFraction)}.`,
    "",
    "## 缺失与删失",
    "",
    `Missing mechanism ${report.diagnostics.missingness.mode}; missing fraction ${pct(report.diagnostics.missingness.missingFraction)}; imputed cells ${report.diagnostics.missingness.imputedN}.`,
    `Observed outcomes ${report.diagnostics.censoring.observedN}; censored ${report.diagnostics.censoring.censoredN}; competing risk ${report.diagnostics.censoring.competingRiskN}.`,
    "",
    "## 敏感性分析",
    "",
  );
  lines.push(
    ...markdownTable(
      ["Analysis", "Estimate", "95% CI", "Direction"],
      report.sensitivity.map((row) => [row.id, num(row.estimate), `${num(row.ciLow)}–${num(row.ciHigh)}`, row.direction]),
    ),
  );
  lines.push(
    "",
    "## 真值与异质性",
    "",
    `Synthetic truth RR ${num(report.truthRecovery.truthRr)}; adjusted ${num(report.truthRecovery.adjustedRr)}; crude ${num(report.truthRecovery.crudeRr)}.`,
    `Adjusted error ${num(report.truthRecovery.adjustedAbsoluteError)} vs crude error ${num(report.truthRecovery.crudeAbsoluteError)}; ${report.truthRecovery.withinExpectedRange ? "within expected range" : "outside expected range"}.`,
    `Primary RR ${num(report.heterogeneity.primaryRr)}; secondary ${report.heterogeneity.secondaryRr === null ? "not available" : num(report.heterogeneity.secondaryRr)}. ${report.heterogeneity.conclusion}`,
    "",
    "## 偏倚与局限",
    "",
    `- Negative control: ${report.bias.negativeControl}`,
    `- Quantitative bias: ${report.bias.quantitativeBias}`,
    ...report.limitations.map((item) => `- ${item}`),
    "",
    "## 执行与证据链",
    "",
  );
  lines.push(
    ...markdownTable(
      ["字段", "值"],
      [
        ["Job", report.execution.jobId],
        ["Logical plan hash", report.execution.logicalPlanHash],
        ["Plan hash", report.execution.planHash],
        ["Operator", report.execution.operatorRef],
        ["Operator SM3", report.execution.operatorSm3],
        ["TEE policy", report.execution.teePolicy],
        ["Evidence manifest", report.evidence.evidenceManifestDigest],
      ],
    ),
  );
  lines.push(
    "",
    ...markdownTable(
      ["Node", "Audit receipt", "Purge receipt"],
      report.execution.receipts.map((row) => [row.node, row.auditReceiptDigest, row.purgeReceiptDigest ?? "—"]),
    ),
  );
  lines.push(
    "",
    "## 方案偏离",
    "",
  );
  if (report.deviations.length) {
    lines.push(
      ...markdownTable(
        ["At", "Description", "Rationale"],
        report.deviations.map((row) => [row.at, row.description, row.rationale]),
      ),
    );
  } else {
    lines.push("无记录偏离。");
  }
  lines.push(
    "",
    "## AI 交互截图附录",
    "",
    ...report.assistantSession.screenshots.flatMap((shot) => [
      `### ${shot.stepId} ${shot.title}`,
      "",
      `![${shot.stepId} ${shot.title}](${shot.screenshot})`,
      "",
      `- Captured: ${shot.capturedAt}`,
      `- Message: ${shot.assistantMessageId}`,
      `- Tool: ${shot.toolName}`,
      `- Screenshot SHA-256: ${shot.screenshotSha256}`,
      `- Credential display: ${shot.credentialDisplay}`,
      "",
    ]),
  );
  return `${lines.join("\n").trim()}\n`;
}

export function renderRegistrationReportHtml(report: RegistrationReport): string {
  const markdown = renderRegistrationReportMarkdown(report);
  const screenshotHtml = report.assistantSession.screenshots
    .map(
      (shot) => `<section>
<h3>${escapeHtml(shot.stepId)} ${escapeHtml(shot.title)}</h3>
<img src="${escapeHtml(shot.screenshot)}" alt="${escapeHtml(shot.title)}" style="max-width:100%;border:1px solid #cbd5e1">
<p class="mono">message=${escapeHtml(shot.assistantMessageId)} · tool=${escapeHtml(shot.toolName)} · credentials=${escapeHtml(shot.credentialDisplay)}</p>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>RWD 单臂外部对照注册研究报告（模拟）</title>
<style>
body{font-family:-apple-system,"PingFang SC",sans-serif;margin:36px;color:#0f172a;line-height:1.55}
body:before{content:"SIMULATION ONLY — NOT CLINICAL OR REGULATORY EVIDENCE";display:block;padding:10px;margin-bottom:24px;background:#fff7ed;border:1px solid #f97316;color:#9a3412;font-weight:700}
h1{font-size:26px;border-bottom:2px solid #2563eb;padding-bottom:8px}h2{margin-top:30px}h3{margin-top:24px}
table{border-collapse:collapse;width:100%;font-size:12px;margin:12px 0}th,td{border:1px solid #cbd5e1;padding:6px 8px;vertical-align:top}th{background:#f8fafc}
.mono{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all}.source{white-space:pre-wrap;background:#f8fafc;padding:16px;border:1px solid #e2e8f0}
</style></head><body>
<h1>RWD 单臂外部对照注册研究报告</h1>
<p><strong>Report fingerprint:</strong> <span class="mono">${escapeHtml(report.reportFingerprint)}</span></p>
<div class="source">${escapeHtml(markdown)}</div>
<h2>AI 交互截图</h2>
${screenshotHtml}
</body></html>`;
}
