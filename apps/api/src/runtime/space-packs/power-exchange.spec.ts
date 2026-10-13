import { mockRepo } from "../test-utils/mock-repo";
import { ExchangeAttemptService } from "./exchange-attempt.service";
import {
  admitExchange,
  POWER_APPLICATIONS,
  powerEgress,
  powerOperators,
  rejectForbiddenOutput,
  reproducibleDigest,
  resolveMergePoint,
} from "@medtrust/domain-power";

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
      }).rejection,
    ).toBe("forbidden-output");

    const ok = admitted("elder-link");
    expect(ok).toEqual({
      contractId: "c-1",
      mergePoint: "tee",
      outputHash: null,
      rejection: null,
    });

    const attempts = mockRepo();
    const saved = await new ExchangeAttemptService(attempts).record({
      applicationId: "curtailment",
      callerSubjectId: "p-a",
      spaceMemberIds: ["p-a"],
      contract: { id: "c-9", status: "active", coversInputs: true },
      operatorDigest: DIGEST,
    });
    expect(saved).toEqual({
      contractId: "c-9",
      mergePoint: "tee",
      outputHash: null,
      rejection: null,
    });
    expect(Object.keys(saved).sort()).toEqual([
      "contractId",
      "mergePoint",
      "outputHash",
      "rejection",
    ]);
  });
});
