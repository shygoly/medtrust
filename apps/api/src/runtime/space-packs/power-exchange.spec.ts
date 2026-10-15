import { mockRepo } from "../test-utils/mock-repo";
import { ExchangeAttemptService } from "./exchange-attempt.service";
import {
  admitExchange,
  createPowerPackBundle,
  POWER_APPLICATIONS,
  powerEgress,
  powerOperators,
  powerPackManifest,
  powerTerminology,
  rejectForbiddenOutput,
  reproducibleDigest,
  resolveMergePoint,
} from "@medtrust/domain-power";
import { PackRegistry } from "@medtrust/space-kernel";

const DIGEST = "ab".repeat(32);

function admitted(applicationId: string, plaintextInputs: string[] = []) {
  return admitExchange({
    applicationId,
    callerSubjectId: "p-a",
    spaceMemberIds: ["p-a"],
    contract: {
      id: "c-1",
      status: "active",
      coversInputs: true,
      plaintextInputs,
    },
    operatorDigest: DIGEST,
    registeredDigests: [DIGEST],
  });
}

describe("电力交换与出域", () => {
  it("缺省白名单不再包含电力包时，出域只允许聚合且最小计数为基座缺省", () => {
    const policy = powerEgress.resolve({ spaceId: "s1" });
    expect(policy.allowedArtifacts).toEqual(["aggregate"]);
    expect(policy.minimumCount).toBe(5);
    expect(powerOperators.declareOperators({ spaceId: "s1" })).toEqual([]);
    expect(reproducibleDigest("n/a")).toBe(false);
    expect(reproducibleDigest("placeholder")).toBe(false);
    expect(rejectForbiddenOutput(["meter-series"])).toBe("forbidden-output");
    expect(rejectForbiddenOutput(["registry-detail"])).toBe("forbidden-output");
    expect(rejectForbiddenOutput(["grid-warning"])).toBeNull();
  });

  it("八个应用的缺省合并点", () => {
    expect(POWER_APPLICATIONS).toHaveLength(8);
    expect(resolveMergePoint("flood-warning")).toBe("tee");
    expect(resolveMergePoint("fire-score")).toBe("tee");
    expect(resolveMergePoint("elder-link")).toBe("tee");
    expect(resolveMergePoint("bid-quote")).toBe("federated-coordinator");
    expect(resolveMergePoint("curtailment")).toBe("tee");
    expect(resolveMergePoint("ancillary")).toBe("tee");
    expect(resolveMergePoint("v2g-capacity")).toBe("aggregator-connector");
    expect(resolveMergePoint("smart-charge")).toBe("operator-connector");
  });

  it("合约逐项允许后，弃电比较与辅助服务改到持有方连接器", () => {
    expect(
      resolveMergePoint("curtailment", ["section-margin", "net-load", "agc"]),
    ).toBe("holder-connector");
    expect(resolveMergePoint("curtailment", ["section-margin"])).toBe("tee");
    expect(resolveMergePoint("ancillary", ["price", "reserve-demand"])).toBe(
      "holder-connector",
    );
    expect(resolveMergePoint("ancillary", ["price"])).toBe("tee");
    expect(() =>
      resolveMergePoint("ancillary", [
        "price",
        "reserve-demand",
        "plant-flexibility",
      ]),
    ).toThrow(/plant-flexibility-forbidden/);
  });

  it("非空间成员、无合约、占位摘要或户表输出都在执行前拒绝", async () => {
    expect(
      admitExchange({
        applicationId: "flood-warning",
        callerSubjectId: "outsider",
        spaceMemberIds: ["p-a"],
        contract: { id: "c-1", status: "active", coversInputs: true },
        operatorDigest: DIGEST,
      }).rejection,
    ).toBe("not-space-member");

    const memberNoContract = admitExchange({
      applicationId: "flood-warning",
      callerSubjectId: "p-a",
      spaceMemberIds: ["p-a"],
      contract: null,
      operatorDigest: DIGEST,
    });
    expect(memberNoContract.rejection).toBe("no-contract");
    expect(memberNoContract.mergePoint).toBeNull();
    expect(memberNoContract.outputHash).toBeNull();

    expect(
      admitExchange({
        applicationId: "bid-quote",
        callerSubjectId: "p-a",
        spaceMemberIds: ["p-a"],
        contract: { id: "c-1", status: "active", coversInputs: true },
        operatorDigest: "placeholder",
      }).rejection,
    ).toBe("operator-digest-missing");

    expect(
      admitExchange({
        applicationId: "fire-score",
        callerSubjectId: "p-a",
        spaceMemberIds: ["p-a"],
        contract: { id: "c-1", status: "active", coversInputs: true },
        operatorDigest: DIGEST,
        outputFields: ["household-curve"],
        registeredDigests: [DIGEST],
      }).rejection,
    ).toBe("forbidden-output");

    expect(
      admitExchange({
        applicationId: "flood-warning",
        callerSubjectId: "p-a",
        spaceMemberIds: ["p-a"],
        contract: { id: "c-1", status: "active", coversInputs: true },
        operatorDigest: DIGEST,
      }).rejection,
    ).toBe("operator-digest-unregistered");

    const ok = admitted("elder-link");
    expect(ok).toEqual({
      contractId: "c-1",
      mergePoint: "tee",
      outputHash: null,
      rejection: null,
    });

    expect(() =>
      powerTerminology.deidentify({ spaceId: "hn-power" }, { meterId: "m-1" }),
    ).toThrow(/power-deidentify-not-wired/);

    const attempts = mockRepo();
    const members = mockRepo();
    const contracts = mockRepo();
    await members.save({
      id: "m-1",
      spaceId: "hn-power",
      subjectType: "org",
      subjectId: "p-grid-hn",
      role: "provider",
      status: "active",
    });
    await contracts.save({
      id: "c-9",
      spaceId: "hn-power",
      status: "active",
      dataProductId: "dp-pwr-grid-asset",
      providerId: "p-grid-hn",
      consumerId: "p-market-hn",
      outputPolicy: { plaintextInputs: [] },
    });
    const collaborations = mockRepo();
    await collaborations.save({
      id: "col-1",
      spaceId: "hn-power",
      status: "active",
      participants: ["p-grid-hn", "p-market-hn"],
      dataProductIds: ["dp-pwr-grid-asset"],
    });
    const registry = new PackRegistry(["power"]);
    registry.register(powerPackManifest, createPowerPackBundle());
    registry.enable({ spaceId: "hn-power" }, "power");
    const service = new ExchangeAttemptService(
      attempts,
      members,
      contracts,
      collaborations,
      { registry } as never,
    );
    const saved = await service.attempt({
      spaceId: "hn-power",
      applicationId: "flood-warning",
      caller: { orgId: "p-grid-hn" },
      contractId: "c-9",
      operatorDigest: DIGEST,
    });
    expect(saved.rejection).toBe("operator-digest-unregistered");
    expect(saved.spaceId).toBe("hn-power");
    expect(saved.mergePoint).toBeNull();
    expect(saved.contractId).toBe("c-9");

    const collided = await service.attempt({
      spaceId: "hn-power",
      applicationId: "flood-warning",
      caller: { userId: "p-grid-hn" },
      contractId: "c-9",
      operatorDigest: DIGEST,
    });
    expect(collided.rejection).toBe("not-space-member");

    await members.save({
      id: "m-other",
      spaceId: "hn-power",
      subjectType: "org",
      subjectId: "p-weather-hn",
      role: "provider",
      status: "active",
    });
    const outsider = await service.attempt({
      spaceId: "hn-power",
      applicationId: "flood-warning",
      caller: { orgId: "p-weather-hn" },
      contractId: "c-9",
      operatorDigest: DIGEST,
    });
    expect(outsider.rejection).toBe("not-contract-party");

    await members.save({
      id: "m-civic",
      spaceId: "hn-power",
      subjectType: "org",
      subjectId: "p-civic-hn",
      role: "provider",
      status: "active",
    });
    await contracts.save({
      id: "c-10",
      spaceId: "hn-power",
      status: "active",
      dataProductId: "dp-pwr-grid-asset",
      providerId: "p-civic-hn",
      consumerId: "p-market-hn",
      outputPolicy: { plaintextInputs: [] },
    });
    const outsideCollaboration = await service.attempt({
      spaceId: "hn-power",
      applicationId: "flood-warning",
      caller: { orgId: "p-civic-hn" },
      contractId: "c-10",
      operatorDigest: DIGEST,
    });
    expect(outsideCollaboration.rejection).toBe("not-collaboration-member");
  });
});
