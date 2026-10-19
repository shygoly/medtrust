import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PlanInputError } from "@medtrust/mdop";
import type { SpiContext } from "@medtrust/space-kernel-spi";
import {
  EXTERNAL_CONTROL_REGISTRATION_TEMPLATE_ID,
  keyForTemplate,
} from "../runtime/orchestration/orchestration.channels";
import { resolveTemplateOrThrow } from "./template-registry";

const INPUT = {
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
      dataProductId: "dp-controls-a",
      contractId: "ct-controls-a",
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

const CTX = { spaceId: "med" } as SpiContext;

function build(over: Record<string, unknown> = {}) {
  const template = resolveTemplateOrThrow(
    EXTERNAL_CONTROL_REGISTRATION_TEMPLATE_ID,
  );
  return template.build({ ...INPUT, ...over }, CTX) as {
    contracts: string[];
    contractBundle?: { id: string; version: string };
    contractBindings?: Array<{
      contractId: string;
      participantId: string;
      role: string;
      stages: string[];
    }>;
    stages: Array<{
      id: string;
      op: string;
      params?: Record<string, unknown>;
      at?: string;
    }>;
  };
}

describe("注册型外部对照的 MDOP API 入口", () => {
  it("从注册表解析模板并生成完整、可追溯的计划", () => {
    const plan = build();

    expect(plan.contracts).toEqual(["ct-trial", "ct-controls-a"]);
    expect(plan.contractBundle).toEqual({
      id: "bundle-reg-1",
      version: "v1",
    });
    expect(plan.contractBindings?.map((binding) => binding.role)).toEqual([
      "trial",
      "external-control-primary",
    ]);
    expect(plan.stages.map((stage) => stage.id)).toEqual([
      "src_trial",
      "seal_trial",
      "src_externalcontrolprimary",
      "seal_externalcontrolprimary",
      "registration",
      "release",
    ]);

    const registration = plan.stages.find(
      (stage) => stage.id === "registration",
    );
    expect(registration).toMatchObject({
      op: "rws.external-control-registration@1.0.0",
      at: INPUT.teeNode,
      params: {
        roles: {
          trial: "urn:tds:med:participant:sponsor",
          controls: ["urn:tds:med:participant:site-a"],
        },
        covariates: ["age", "sex", "severity"],
        synthetic: true,
        truthRr: 0.65,
        study: {
          profileVersion: "registration-eca/1.0.0",
          timeZero: "treatment-start",
          estimandSapVersion: "sap-1",
        },
      },
    });

    const release = plan.stages.find((stage) => stage.id === "release");
    expect(release?.params).toMatchObject({
      minCell: 10,
      contractIds: ["ct-trial", "ct-controls-a"],
      contractBundleId: "bundle-reg-1",
      contractBundleVersion: "v1",
      contractBundleMinCell: 10,
    });
  });

  it("台账映射到独立 mdop-native 条目", () => {
    expect(keyForTemplate(EXTERNAL_CONTROL_REGISTRATION_TEMPLATE_ID)).toBe(
      "mdop.external-control-registration",
    );

    const ledger = JSON.parse(
      readFileSync(
        join(
          __dirname,
          "../runtime/orchestration/orchestration.migration.json",
        ),
        "utf8",
      ),
    ) as { channels: Array<Record<string, unknown>> };
    expect(
      ledger.channels.find(
        (entry) => entry.key === "mdop.external-control-registration",
      ),
    ).toMatchObject({
      kind: "mdop-native",
      channel: "mdop",
      state: "migrated",
      mdopTemplate: "rws.external-control-registration",
    });
  });

  it("真实研究未冻结 P0 时在作业提交前拒绝", () => {
    expect(() =>
      build({
        study: { ...INPUT.study, synthetic: false },
      }),
    ).toThrow(PlanInputError);
  });
});
