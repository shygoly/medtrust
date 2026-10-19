import type { MdopPlanDsl } from "@medtrust/mdop";

/**
 * 医疗包标准 DSL 示例。实体全部是角色占位符，不含默认医院、数据产品或合约。
 * 示例只用于人工审阅与服务端模板展开；LLM 产出仍必须标为 llm-draft。
 */
function base(input: {
  templateId: string;
  sources: MdopPlanDsl["sources"];
  roles: MdopPlanDsl["roles"];
  contractRoles: string[];
  operators: MdopPlanDsl["operators"];
  release?: Record<string, unknown>;
  study?: MdopPlanDsl["study"];
}): MdopPlanDsl {
  return {
    dslVersion: "mdop.plan/v1",
    template: { id: input.templateId, version: "1.0.0" },
    draft: "frozen",
    purpose: "${purpose}",
    applicant: { org: "${applicantOrg}", project: "${project}" },
    sources: input.sources,
    roles: input.roles,
    contracts: input.contractRoles.map((role) => `\${${role}Contract}`),
    contractBundle: {
      bundleId: "${contractBundleId}",
      version: "${contractBundleVersion}",
      members: input.contractRoles.map((role) => ({
        role,
        contractId: `\${${role}Contract}`,
      })),
    },
    ...(input.study ? { study: input.study } : {}),
    operators: input.operators,
    placement: {},
    release: input.release ?? { artifact: "aggregate" },
    ethics: { required: "${ethicsRequired}" },
    budget: { maxQueries: "${maxQueries}" },
    window: { notBefore: "${notBefore}", notAfter: "${notAfter}" },
    evidence: { receipt: true },
  };
}

export const MED_DSL_EXAMPLES: Record<string, MdopPlanDsl> = {
  "cohort-count": base({
    templateId: "rws.cohort-count",
    sources: {
      site: {
        participant: "${site}",
        dataProduct: "${siteProduct}",
        role: "site-cohort",
        contract: "${siteContract}",
        projection: "scalar-category",
      },
    },
    roles: { "site-cohort": "site" },
    contractRoles: ["site"],
    operators: [
      {
        id: "count",
        op: "rws.distinct-count@1.0.0",
        inputs: ["site"],
        placement: "${siteNode}",
        parameters: { strataKeys: "${strataKeys}" },
      },
      {
        id: "release",
        op: "declassify.small_cell@1.0.0",
        inputs: ["count"],
        placement: "${siteNode}",
        parameters: { minCell: "${minCell}" },
      },
    ],
  }),
  "external-control": base({
    templateId: "rws.external-control",
    sources: {
      trial: {
        participant: "${trial}",
        dataProduct: "${trialProduct}",
        role: "sponsor-trial",
        contract: "${trialContract}",
        projection: "sponsor-trial",
      },
      controls: {
        participant: "${controls}",
        dataProduct: "${controlsProduct}",
        role: "hospital-controls",
        contract: "${controlsContract}",
        projection: "hospital-controls",
      },
    },
    roles: {
      "sponsor-trial": "trial",
      "hospital-controls": "controls",
    },
    contractRoles: ["trial", "controls"],
    operators: [
      {
        id: "match",
        op: "rws.external-control@1.0.0",
        inputs: ["trial", "controls"],
        placement: "${teeNode}",
        parameters: {
          strataKeys: "${strataKeys}",
          caliperDays: "${caliperDays}",
          ratioK: "${ratioK}",
        },
      },
      {
        id: "release",
        op: "declassify.small_cell@1.0.0",
        inputs: ["match"],
        placement: "${teeNode}",
        parameters: { minCell: "${minCell}" },
      },
    ],
  }),
  "external-control-registration": base({
    templateId: "rws.external-control-registration",
    sources: {
      trial: {
        participant: "${trial}",
        dataProduct: "${trialProduct}",
        role: "trial",
        contract: "${trialContract}",
        projection: "sponsor-trial",
      },
      primary: {
        participant: "${controlPrimary}",
        dataProduct: "${controlPrimaryProduct}",
        role: "external-control-primary",
        contract: "${controlPrimaryContract}",
        projection: "hospital-controls",
      },
      secondary: {
        participant: "${controlSecondary}",
        dataProduct: "${controlSecondaryProduct}",
        role: "external-control-secondary",
        contract: "${controlSecondaryContract}",
        projection: "hospital-controls",
      },
    },
    roles: {
      trial: "trial",
      "external-control-primary": "primary",
      "external-control-secondary": "secondary",
    },
    contractRoles: ["trial", "controlPrimary", "controlSecondary"],
    study: {
      studyId: "${studyId}",
      design: "single-arm-with-external-control",
      objective: "superiority",
      evidenceRole: "primary",
      estimand: "ATT",
      estimator: "IPTW-ATT",
      timeZero: "${timeZero}",
      outcome: "${outcome}",
      profileVersion: "${studyProfileVersion}",
      protocolVersion: "${protocolVersion}",
      sapVersion: "${sapVersion}",
      synthetic: "${synthetic}",
      frozen: "${studyFrozen}",
      p0DecisionsFrozen: "${p0DecisionsFrozen}",
    } as unknown as MdopPlanDsl["study"],
    operators: [
      {
        id: "registration",
        op: "rws.external-control-registration@1.0.0",
        inputs: ["trial", "primary", "secondary"],
        placement: "${teeNode}",
        parameters: {
          roles: {
            trial: "${trial}",
            controls: ["${controlPrimary}", "${controlSecondary}"],
          },
          covariates: "${covariates}",
          missingness: "${missingness}",
          effectMeasure: "${effectMeasure}",
          synthetic: "${synthetic}",
          truthRr: "${truthRr}",
          study: {
            profileVersion: "${studyProfileVersion}",
            timeZero: "${timeZero}",
            estimandSapVersion: "${sapVersion}",
          },
        },
      },
      {
        id: "release",
        op: "declassify.small_cell@1.0.0",
        inputs: ["registration"],
        placement: "${teeNode}",
        parameters: { minCell: "${minCell}" },
      },
    ],
    release: {
      artifact: "aggregate",
      primaryAnalysis: "ATT/IPW-ATT",
      sensitivity: "${sensitivityAnalyses}",
    },
  }),
  "cross-site-dedup": base({
    templateId: "rws.dedup-incidence",
    sources: {
      siteA: {
        participant: "${siteA}",
        dataProduct: "${siteAProduct}",
        role: "site-a",
        contract: "${siteAContract}",
        projection: "dedup-cohort",
      },
      siteB: {
        participant: "${siteB}",
        dataProduct: "${siteBProduct}",
        role: "site-b",
        contract: "${siteBContract}",
        projection: "dedup-cohort",
      },
    },
    roles: { "site-a": "a", "site-b": "b" },
    contractRoles: ["siteA", "siteB"],
    operators: [
      {
        id: "dedup",
        op: "rws.dedup-incidence@1.0.0",
        inputs: ["siteA", "siteB"],
        placement: "${teeNode}",
        parameters: { strataKeys: "${strataKeys}" },
      },
      {
        id: "release",
        op: "declassify.small_cell@1.0.0",
        inputs: ["dedup"],
        placement: "${teeNode}",
        parameters: { minCell: "${minCell}" },
      },
    ],
  }),
  "federated-prediction": base({
    templateId: "rws.l4.fl-prediction",
    sources: {
      siteA: {
        participant: "${siteA}",
        dataProduct: "${siteAProduct}",
        role: "federated-site",
        contract: "${siteAContract}",
        projection: "federated-features",
      },
      siteB: {
        participant: "${siteB}",
        dataProduct: "${siteBProduct}",
        role: "federated-site",
        contract: "${siteBContract}",
        projection: "federated-features",
      },
    },
    roles: { "federated-site": "site" },
    contractRoles: ["siteA", "siteB"],
    operators: [
      {
        id: "train",
        op: "rws.l4-train@1.0.0",
        inputs: ["siteA", "siteB"],
        placement: "${siteANode}",
        parameters: { model: "${model}", target: "${target}" },
      },
      {
        id: "merge",
        op: "merge.fedavg@1.0.0",
        inputs: ["train"],
        placement: "${platformNode}",
        parameters: { rounds: "${rounds}" },
      },
    ],
  }),
  "c2-matching": base({
    templateId: "rws.c2-matching",
    sources: {
      index: {
        participant: "${indexSite}",
        dataProduct: "${indexProduct}",
        role: "index-site",
        contract: "${indexContract}",
        projection: "c2-index",
      },
      outcome: {
        participant: "${outcomeSite}",
        dataProduct: "${outcomeProduct}",
        role: "outcome-site",
        contract: "${outcomeContract}",
        projection: "c2-outcome",
      },
    },
    roles: { "index-site": "index", "outcome-site": "outcome" },
    contractRoles: ["index", "outcome"],
    operators: [
      {
        id: "match",
        op: "rws.pairing@1.0.0",
        inputs: ["index", "outcome"],
        placement: "${teeNode}",
        parameters: { strataKeys: "${strataKeys}" },
      },
      {
        id: "release",
        op: "declassify.small_cell@1.0.0",
        inputs: ["match"],
        placement: "${teeNode}",
        parameters: { minCell: "${minCell}" },
      },
    ],
  }),
};
