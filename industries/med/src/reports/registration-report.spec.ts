// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REQUIRED_SCREENSHOT_STEPS,
  buildRegistrationReport,
  renderRegistrationReportHtml,
  renderRegistrationReportMarkdown,
  type RegistrationReportInput,
} from "./registration-report";

const H64 = (character: string) => character.repeat(64);

function fixture(): RegistrationReportInput {
  const messages = REQUIRED_SCREENSHOT_STEPS.map((step, index) => ({
    id: `msg-${step}`,
    role: index % 2 === 0 ? ("assistant" as const) : ("user" as const),
    at: `2026-10-18T00:0${index}:00Z`,
    text:
      index === 0
        ? "模拟演示账号 demo@example.invalid / demo-simulation-only"
        : `${step} 模拟助手交互`,
    cardType: index === 0 ? ("form" as const) : ("status" as const),
  }));
  const toolNames = [
    "auth_session",
    "draft_registration_study",
    "validate_registration_profile",
    "resolve_registration_sources",
    "review_registration_plan",
    "prepare_synthetic_registration",
    "submit_external_control_registration",
    "get_registration_job",
    "build_registration_report",
    "download_registration_report",
  ];
  return {
    metadata: {
      generatedAt: "2026-10-18T00:10:00Z",
      language: "zh-CN",
      syntheticOnly: true,
    },
    assistantSession: {
      sessionId: "chat-report-sim-1",
      userRole: "consumer",
      credentialPolicy: "fictional-fixture-only",
      messages,
      toolCalls: toolNames.map((name, index) => ({
        id: `tool-${index}`,
        name,
        at: `2026-10-18T00:0${index}:10Z`,
        success: true,
        requestDigest: H64(String(index)),
        responseDigest: H64("a"),
      })),
      screenshots: REQUIRED_SCREENSHOT_STEPS.map((step, index) => ({
        stepId: step,
        title: `步骤 ${step}`,
        screenshot: `screenshots/${step}.png`,
        screenshotSha256: H64("b"),
        capturedAt: `2026-10-18T00:0${index}:20Z`,
        sessionId: "chat-report-sim-1",
        assistantMessageId: `msg-${step}`,
        cardType: index === 0 ? "form" : "status",
        toolName: toolNames[index]!,
        toolRequestDigest: H64(String(index)),
        toolResponseDigest: H64("a"),
        backendResource: { jobId: "job-report-sim" },
        credentialDisplay: index === 0 ? "fictional-only" : "none",
      })),
    },
    study: {
      studyId: "REG-ECA-001",
      product: "SIM-MAB-01",
      indication: "SIM-DERM-01",
      evidenceRole: "supportive",
      design: "single-arm-with-external-control",
      objective: "superiority",
    },
    protocol: {
      protocolVersion: "reference-protocol-1",
      protocolDigest: H64("1"),
      sapVersion: "reference-sap-1",
      sapDigest: H64("2"),
      p0Decisions: [
        { id: "P0-01", decision: "SIM-MAB-01", status: "frozen" },
      ],
    },
    targetTrial: {
      population: "Adults 18-80 with synthetic SIM-DERM-01",
      treatmentStrategies: {
        trial: "SIM-MAB-01 plus standard care",
        externalControl: "Standard care",
      },
      timeZero: "First qualifying treatment/index visit",
      followUp: "24 weeks",
      outcome: "Week-24 binary response",
      intercurrentEvents: "Treatment policy",
    },
    estimand: {
      type: "ATT",
      summaryMeasure: "risk-ratio",
      sensitivityPolicy: "Pre-specified",
    },
    sources: [
      {
        role: "trial",
        participantId: "sponsor",
        dataProductId: "dp-trial",
        contractId: "ct-trial",
        sourceVersion: "v1",
        sourceDigest: H64("3"),
        projectionDigest: H64("4"),
      },
      {
        role: "external-control-primary",
        participantId: "site-a",
        dataProductId: "dp-a",
        contractId: "ct-a",
        sourceVersion: "v1",
        sourceDigest: H64("5"),
        projectionDigest: H64("6"),
      },
      {
        role: "external-control-secondary",
        participantId: "site-b",
        dataProductId: "dp-b",
        contractId: "ct-b",
        sourceVersion: "v1",
        sourceDigest: H64("7"),
        projectionDigest: H64("8"),
      },
    ],
    cohort: {
      trialN: 240,
      controlPoolN: 5000,
      analysisTrialN: 230,
      analysisControlN: 4800,
      exclusions: [{ reason: "outside age range", count: 40 }],
    },
    methods: {
      propensityModel: "logistic",
      covariates: ["age", "sex", "severity"],
      trimLow: 0.05,
      trimHigh: 0.95,
      missingPlan: "deterministic simulation imputation",
      censoringPlan: "administrative and loss to follow-up",
      failClosedRules: ["max weight > 20"],
    },
    result: {
      riskTreated: 0.23,
      riskControl: 0.35,
      riskDifference: -0.12,
      riskRatio: 0.657,
      riskDifferenceCi: [-0.18, -0.06],
      riskRatioCi: [0.54, 0.81],
    },
    diagnostics: {
      balance: [
        { covariate: "age", smdBefore: 0.31, smdAfter: 0.03 },
        { covariate: "severity", smdBefore: 0.44, smdAfter: 0.05 },
      ],
      overlap: {
        minPropensity: 0.02,
        maxPropensity: 0.96,
        trimmed: 12,
        eesTrial: 225,
        eesControl: 1180,
      },
      weights: {
        maxWeight: 4.2,
        p99Weight: 2.8,
        truncatedFraction: 0.01,
        effectiveSampleSize: 1405,
      },
      missingness: { mode: "MAR", missingFraction: 0.04, imputedN: 120 },
      censoring: { observedN: 2400, censoredN: 80, competingRiskN: 4 },
    },
    sensitivity: [
      {
        id: "overlap-trimming-10pct",
        estimate: 0.66,
        ciLow: 0.55,
        ciHigh: 0.8,
        direction: "same-direction",
      },
    ],
    truthRecovery: {
      truthRr: 0.65,
      adjustedRr: 0.657,
      crudeRr: 0.81,
      adjustedAbsoluteError: 0.007,
      crudeAbsoluteError: 0.16,
      withinExpectedRange: true,
      answerKeyDigest: `sm3:${H64("d")}`,
    },
    heterogeneity: {
      primaryRr: 0.657,
      secondaryRr: 0.69,
      conclusion: "same direction",
    },
    bias: {
      negativeControl: "no material effect",
      quantitativeBias: "not material",
    },
    limitations: ["Synthetic data only", "Deterministic mean imputation"],
    execution: {
      jobId: "job-report-sim",
      logicalPlanHash: `sm3:${H64("9")}`,
      planHash: `sm3:${H64("a")}`,
      operatorRef: "rws.external-control-registration@1.0.0",
      operatorSm3: `sm3:${H64("c")}`,
      teePolicy: "hardware",
      receipts: [
        {
          node: "urn:tee",
          auditReceiptDigest: `sm3:${H64("d")}`,
          purgeReceiptDigest: `sm3:${H64("e")}`,
        },
      ],
      chainsValid: true,
    },
    evidence: { evidenceManifestDigest: `sm3:${H64("f")}` },
    independentReview: {
      reviewerId: "reviewer-sim-1",
      reviewedAt: "2026-10-18T00:09:00Z",
      protocolDigest: H64("1"),
      sapDigest: H64("2"),
      verdict: "approved",
      conclusion: "Synthetic review passed; no regulatory conclusion.",
    },
    deviations: [],
  };
}

describe("registration report", () => {
  it("builds a deterministic report with every assistant screenshot", () => {
    const first = buildRegistrationReport(fixture());
    const second = buildRegistrationReport(fixture());
    assert.equal(first.reportFingerprint, second.reportFingerprint);
    assert.equal(first.assistantSession.screenshots.length, 10);
    assert.match(first.boundary, /SIMULATION ONLY/);
    assert.match(renderRegistrationReportMarkdown(first), /AI 交互截图附录/);
    assert.match(renderRegistrationReportHtml(first), /A01/);
  });

  it("rejects missing screenshots and incomplete chains", () => {
    const missing = fixture();
    missing.assistantSession.screenshots.pop();
    assert.throws(() => buildRegistrationReport(missing), /screenshots|A10/);

    const broken = fixture();
    broken.execution.chainsValid = false;
    assert.throws(() => buildRegistrationReport(broken), /receipt chains/);
  });

  it("enforces the credential-display boundary in both directions", () => {
    const real = fixture();
    real.metadata.syntheticOnly = false;
    assert.throws(() => buildRegistrationReport(real), /redact credentials/);

    const maskedSynthetic = fixture();
    maskedSynthetic.assistantSession.screenshots[0]!.credentialDisplay = "masked";
    assert.throws(
      () => buildRegistrationReport(maskedSynthetic),
      /synthetic reports must not display real credentials/,
    );

    const fictionalReal = fixture();
    fictionalReal.metadata.syntheticOnly = false;
    fictionalReal.assistantSession.credentialPolicy = "real-credentials-redacted";
    fictionalReal.assistantSession.screenshots[0]!.credentialDisplay = "fictional-only";
    assert.throws(
      () => buildRegistrationReport(fictionalReal),
      /fictional-only credentials are allowed only for synthetic reports/,
    );
  });

  it("rejects secret-like text and row-level identifiers", () => {
    const secret = fixture();
    secret.assistantSession.messages[1]!.text = "Authorization: Bearer abc.def";
    assert.throws(() => buildRegistrationReport(secret), /secret material/);

    const row = fixture() as RegistrationReportInput & { linkKey?: string };
    row.linkKey = "lk-1";
    assert.throws(() => buildRegistrationReport(row), /unknown field|row-level/);
  });

  it("fails closed when synthetic answer-key or independent review evidence is missing", () => {
    const noAnswerKey = fixture() as RegistrationReportInput & {
      truthRecovery: RegistrationReportInput["truthRecovery"] & {
        answerKeyDigest?: string;
      };
    };
    const truth = noAnswerKey.truthRecovery as {
      answerKeyDigest?: string;
    };
    delete truth.answerKeyDigest;
    assert.throws(
      () => buildRegistrationReport(noAnswerKey),
      /answerKeyDigest/,
    );

    const noReview = fixture() as RegistrationReportInput & {
      independentReview?: RegistrationReportInput["independentReview"];
    };
    const review = noReview as {
      independentReview?: RegistrationReportInput["independentReview"];
    };
    delete review.independentReview;
    assert.throws(
      () => buildRegistrationReport(noReview),
      /independentReview/,
    );
  });
});
