import {
  assertBundleCoversNode,
  buildContractBundle,
  explainContractBundle,
  type ContractBundleMemberFact,
} from "./contract-bundle";

const baseMember: ContractBundleMemberFact = {
  contractId: "ct-trial",
  participantId: "p-trial",
  dataProductId: "dp-trial",
  role: "trial",
  status: "active",
  mdopStatus: "active",
  holderSigned: true,
  platformCountersigned: true,
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2027-01-01T00:00:00.000Z",
  purposeCode: "study-purpose",
  minCell: 5,
  retentionDays: 90,
  teePolicy: "software",
  recipients: ["urn:platform", "urn:tee-a", "urn:sponsor"],
  allowedOperators: ["rws.external-control@1.0.0", "declassify.small_cell@1.0.0"],
  stageBindings: [
    {
      stageId: "extCtl",
      operators: ["rws.external-control@1.0.0"],
      sourceRoles: ["trial", "controls"],
    },
  ],
};

const controlMember: ContractBundleMemberFact = {
  ...baseMember,
  contractId: "ct-control",
  participantId: "p-control",
  dataProductId: "dp-control",
  role: "controls",
  validFrom: "2026-02-01T00:00:00.000Z",
  validUntil: "2026-12-01T00:00:00.000Z",
  minCell: 10,
  retentionDays: 30,
  rareConditionMaxPrevalence: 0.0001,
  teePolicy: "hardware",
  recipients: ["urn:platform", "urn:tee-a"],
  stageBindings: [
    {
      stageId: "decTee",
      operators: ["declassify.small_cell@1.0.0"],
      sourceRoles: ["controls"],
    },
    {
      stageId: "extCtl",
      operators: ["rws.external-control@1.0.0"],
      sourceRoles: ["controls"],
    },
  ],
};

describe("ContractBundle", () => {
  it("派生最严格策略：时间交集、minCell 最大值、留存最短、TEE 最严、接收方交集", () => {
    const bundle = buildContractBundle({
      purpose: "study-purpose",
      studyRef: "study-1",
      members: [baseMember, controlMember],
      createdAt: "2026-03-01T00:00:00.000Z",
    });

    expect(bundle.status).toBe("active");
    expect(bundle.effectivePolicySnapshot).toMatchObject({
      validFrom: "2026-02-01T00:00:00.000Z",
      validUntil: "2026-12-01T00:00:00.000Z",
      minCell: 10,
      retentionDays: 30,
      rareConditionMaxPrevalence: 0.0001,
      teePolicy: "hardware",
      recipients: ["urn:platform", "urn:tee-a"],
    });
    expect(bundle.effectivePolicySnapshot.allowedOperatorsByStage.extCtl).toEqual([
      "rws.external-control@1.0.0",
    ]);
    expect(bundle.effectivePolicySnapshot.sourceRolesByStage.extCtl).toEqual([
      "controls",
      "trial",
    ]);
    expect(explainContractBundle(bundle).join("\n")).toContain("ct-control");
  });

  it("版本由成员合约快照决定；续签/成员变化产生不同版本", () => {
    const first = buildContractBundle({
      purpose: "study-purpose",
      studyRef: "study-1",
      members: [baseMember, controlMember],
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    const same = buildContractBundle({
      purpose: "study-purpose",
      studyRef: "study-1",
      members: [baseMember, controlMember],
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    const renewed = buildContractBundle({
      purpose: "study-purpose",
      studyRef: "study-1",
      members: [
        baseMember,
        { ...controlMember, contractId: "ct-control-v2", validUntil: "2027-02-01T00:00:00.000Z" },
      ],
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    expect(first.bundleId).toBe(same.bundleId);
    expect(first.version).toBe(same.version);
    expect(renewed.version).not.toBe(first.version);
  });

  it("任一成员撤销后 bundle 不再 active，新作业 fail-closed", () => {
    const bundle = buildContractBundle({
      purpose: "study-purpose",
      studyRef: "study-1",
      members: [
        baseMember,
        { ...controlMember, status: "revoked", revokedAt: "2026-03-02T00:00:00.000Z" },
      ],
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    expect(bundle.status).toBe("revoked");
    expect(() =>
      assertBundleCoversNode(bundle, {
        involvedRoles: ["trial", "controls"],
        fragmentStages: [
          {
            id: "extCtl",
            op: "rws.external-control@1.0.0",
            inputs: [],
            params: {},
          },
        ],
      }),
    ).toThrow(/禁止执行/);
  });

  it("每份成员用途必须与 bundle 一致，防止用途漂移", () => {
    expect(() =>
      buildContractBundle({
        purpose: "study-purpose",
        studyRef: "study-1",
        members: [{ ...baseMember, purposeCode: "other-purpose" }],
      }),
    ).toThrow(/用途/);
  });
});
