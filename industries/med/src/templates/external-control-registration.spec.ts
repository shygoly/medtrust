// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExternalControlRegistrationPlan,
  type RegistrationExternalControlTemplateInput,
} from "./external-control-registration";

function fixture(): RegistrationExternalControlTemplateInput {
  return {
    purpose: "rws.external-control-registration",
    applicant: { org: "sponsor", project: "REG-ECA-001" },
    study: {
      studyId: "REG-ECA-001",
      product: "reference-product",
      indication: "reference-indication",
      design: "single-arm-with-external-control",
      objective: "superiority",
      evidenceRole: "primary",
      estimand: "ATT",
      estimator: "IPTW-ATT",
      timeZero: "treatment-start",
      outcome: "binary-primary-outcome",
      profileVersion: "registration-eca/1.0.0",
      protocolVersion: "protocol-1",
      sapVersion: "sap-1",
      synthetic: true,
      p0DecisionsFrozen: false,
    },
    trial: {
      participantId: "sponsor",
      dataProductId: "dp-trial",
      contractId: "ct-trial",
    },
    controls: [
      {
        participantId: "site-a",
        dataProductId: "dp-a",
        contractId: "ct-a",
      },
      {
        participantId: "site-b",
        dataProductId: "dp-b",
        contractId: "ct-b",
      },
    ],
    covariates: ["age", "sex", "severity"],
    missingness: "MAR",
    effectMeasure: "risk-ratio",
    truthRr: 0.65,
    contractBundle: { id: "bundle-reg-1", version: "v1", minCell: 10 },
    teeNode: "urn:tds:med:participant:tee",
    notBefore: "2026-10-17T00:00:00Z",
    notAfter: "2026-11-17T00:00:00Z",
  };
}

describe("registration external-control plan template", () => {
  it("binds each source to its own contract and the versioned registration operator", () => {
    const plan = buildExternalControlRegistrationPlan(fixture(), "med");
    assert.deepEqual(plan.contracts, ["ct-trial", "ct-a", "ct-b"]);
    assert.equal(plan.contractBundle?.id, "bundle-reg-1");
    assert.equal(plan.contractBindings?.length, 3);
    assert.deepEqual(
      plan.contractBindings?.map((binding) => binding.role),
      ["trial", "external-control-primary", "external-control-secondary"],
    );
    const registration = plan.stages.find((stage) => stage.id === "registration");
    assert.equal(registration?.op, "rws.external-control-registration@1.0.0");
    assert.equal(registration?.at, "urn:tds:med:participant:tee");
    const release = plan.stages.find((stage) => stage.id === "release");
    assert.equal(release?.params.minCell, 10);
  });

  it("real studies fail closed until P0 decisions are frozen; synthetic runs need truthRr", () => {
    const real = fixture();
    real.study = { ...real.study, synthetic: false };
    assert.throws(
      () => buildExternalControlRegistrationPlan(real, "med"),
      /P0/,
    );
    const synthetic = fixture();
    delete synthetic.truthRr;
    assert.throws(
      () => buildExternalControlRegistrationPlan(synthetic, "med"),
      /truthRr/,
    );
  });
});
