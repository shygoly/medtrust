// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRegistrationEvidenceManifest,
  type RegistrationEvidenceInput,
} from "./registration-study-evidence";

const digest = (n: number) => `sm3:${n.toString(16).repeat(64).slice(0, 64)}`;

function input(): RegistrationEvidenceInput {
  return {
    createdAt: "2026-10-17T12:00:00.000Z",
    study: {
      studyId: "REG-ECA-001",
      purpose: "rws.external-control-registration",
      product: "reference-product",
      indication: "reference-indication",
      design: "single-arm-with-external-control",
      objective: "superiority",
      evidenceRole: "supportive",
      estimand: "ATT",
      estimator: "IPTW-ATT",
      timeZero: "treatment-start",
      outcome: "binary-primary-outcome",
      synthetic: true,
      profileVersion: "registration-eca/1.0.0",
      protocolVersion: "protocol-1",
      protocolDigest: digest(1),
      sapVersion: "sap-1",
      sapDigest: digest(2),
      dslVersion: "mdop.plan/v1",
      dslDigest: digest(3),
      gates: {
        clinicalFeasibility: false,
        protocolFrozen: false,
        sapFrozen: false,
        sourceAgreements: false,
        regulatoryCommunication: false,
      },
    },
    sources: [
      {
        role: "trial",
        participantId: "urn:participant:trial",
        dataProductId: "dp-trial",
        contractId: "ct-trial",
        sourceVersion: "trial-v1",
        sourceDigest: digest(4),
        projectionDigest: digest(5),
      },
      {
        role: "external-control-primary",
        participantId: "urn:participant:control",
        dataProductId: "dp-control",
        contractId: "ct-control",
        sourceVersion: "control-v1",
        sourceDigest: digest(6),
        projectionDigest: digest(7),
      },
    ],
    contractBundle: {
      bundleId: "bundle-1",
      version: "bundle-v1",
      digest: digest(8),
      minCell: 10,
      retentionDays: 30,
      teePolicy: "hardware",
    },
    operator: {
      ref: "rws.external-control-registration@1.0.0",
      sm3: digest(9),
    },
    plan: {
      jobId: "job-1",
      logicalPlanHash: digest(10),
      planHash: digest(11),
      executionAttestationDigest: digest(12),
    },
    result: {
      digest: digest(13),
      summary: {
        trialN: 480,
        controlPoolN: 18000,
        analysisTrialN: 460,
        analysisControlN: 17500,
        effectEstimate: 0.61,
        ciLow: 0.48,
        ciHigh: 0.78,
        maxAbsSmdAfter: 0.07,
        overlapPassed: true,
        missingMode: "MAR",
        censoredN: 1140,
        sensitivityIds: ["overlap-trimming", "alternative-ps-model"],
        syntheticTruthWithinRange: true,
      },
    },
    receipts: [
      {
        node: "urn:tee:registration",
        auditReceiptDigest: digest(14),
        purgeReceiptDigest: digest(15),
      },
    ],
  };
}

describe("注册研究证据清单", () => {
  it("固定版本、哈希、聚合结果与回执，合成数据标记不可冒充注册结论", () => {
    const manifest = buildRegistrationEvidenceManifest(input());
    assert.equal(manifest.study.boundary, "synthetic-method-validation");
    assert.match(manifest.manifestDigest, /^sm3:[0-9a-f]{64}$/);
    assert.deepEqual(manifest.result.summary.sensitivityIds, [
      "alternative-ps-model",
      "overlap-trimming",
    ]);
    assert.equal(manifest.receipts[0]?.purgeReceiptDigest, digest(15));
    assert.equal("rows" in manifest.sources[0]!, false);
  });

  it("内容和时间相同则摘要相同；任何证据变化都会改摘要", () => {
    const a = buildRegistrationEvidenceManifest(input());
    const b = buildRegistrationEvidenceManifest(input());
    assert.equal(a.manifestDigest, b.manifestDigest);

    const changed = input();
    changed.plan.planHash = digest(16);
    assert.notEqual(
      buildRegistrationEvidenceManifest(changed).manifestDigest,
      a.manifestDigest,
    );
  });

  it("真实研究任一临床/合规门未确认即拒绝打包", () => {
    const real = input();
    real.study.synthetic = false;
    assert.throws(
      () => buildRegistrationEvidenceManifest(real),
      /临床可行性/,
    );

    real.study.gates = {
      clinicalFeasibility: true,
      protocolFrozen: true,
      sapFrozen: true,
      sourceAgreements: true,
      regulatoryCommunication: true,
    };
    assert.equal(
      buildRegistrationEvidenceManifest(real).study.boundary,
      "real-regulatory-study",
    );
  });

  it("非劣效、缺失答案键、重复合约或缺失回执均 fail-closed", () => {
    const nonInferior = input();
    nonInferior.study.objective = "non-inferiority" as never;
    assert.throws(
      () => buildRegistrationEvidenceManifest(nonInferior),
      /非劣效/,
    );

    const noTruth = input();
    delete noTruth.result.summary.syntheticTruthWithinRange;
    assert.throws(
      () => buildRegistrationEvidenceManifest(noTruth),
      /答案键/,
    );

    const sameContract = input();
    sameContract.sources[1]!.contractId = sameContract.sources[0]!.contractId;
    assert.throws(
      () => buildRegistrationEvidenceManifest(sameContract),
      /独立/,
    );

    const noReceipt = input();
    noReceipt.receipts = [];
    assert.throws(
      () => buildRegistrationEvidenceManifest(noReceipt),
      /回执/,
    );
  });
});
