import { ForbiddenException } from "@nestjs/common";
import { CKD_PURPOSE, coreSecretFlowSpec } from "@medtrust/demo-scenario";
import { SecretFlowAdmissionService } from "./secretflow-admission.service";
import { ContractService } from "../digital-contract/contract.service";
import { SecretFlowTaskSpec } from "../../compute-task/dto/secretflow-task-spec";
import { DigitalContract } from "@medtrust/database";
import { PreReviewGate } from "../../capability/l2-compliance/pre-review-gate";

const SPEC: SecretFlowTaskSpec = {
  ...(coreSecretFlowSpec() as SecretFlowTaskSpec),
  privacy: { teeRequired: false, heuEnabled: true },
  outputPolicy: { allowedArtifacts: ["lora_delta_hash"] },
};

function contract(over: Partial<DigitalContract>): DigitalContract {
  return {
    id: over.id ?? "c1",
    dataProductId: "dp-insulin-panc-demohospa",
    providerId: "p-demohospa",
    consumerId: "p-meddata",
    purpose: CKD_PURPOSE,
    retention: "burn-after-read",
    output: "aggregate",
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    status: "active",
    hash: "SM3:" + (over.id ?? "c1"),
    ...over,
  } as DigitalContract;
}

function makeContracts(list: DigitalContract[]): ContractService {
  return {
    get: (id: string) => list.find((c) => c.id === id),
    effectiveStatus: (c: DigitalContract) =>
      new Date(c.validUntil).getTime() < Date.now() ? "expired" : c.status,
  } as unknown as ContractService;
}

// 默认 no-op 网关：本套件聚焦合约匹配，预审复核在 pre-review-gate.spec 单测。
function noopGate(): PreReviewGate {
  return { check: jest.fn(async () => undefined) } as unknown as PreReviewGate;
}

function mk(list: DigitalContract[], gate: PreReviewGate = noopGate()) {
  return new SecretFlowAdmissionService(makeContracts(list), gate);
}

describe("SecretFlowAdmissionService", () => {
  it("admits when every provider has an active matching contract", async () => {
    const svc = mk([
      contract({ id: "c1", providerId: "p-demohospa" }),
      contract({ id: "c2", providerId: "p-demohospb" }),
      contract({ id: "c3", providerId: "p-demohospc" }),
    ]);
    const admitted = await svc.admit(SPEC, { contractIds: ["c1", "c2", "c3"] });
    expect(admitted.consumerId).toBe("p-meddata");
    expect(admitted.contractHashes).toEqual(["SM3:c1", "SM3:c2", "SM3:c3"]);
  });

  it("rejects when a provider has no contract", async () => {
    const svc = mk([contract({ id: "c1", providerId: "p-demohospa" })]);
    await expect(svc.admit(SPEC, { contractIds: ["c1"] })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("rejects an expired contract", async () => {
    const svc = mk([
      contract({
        id: "c1",
        providerId: "p-demohospa",
        validUntil: new Date(Date.now() - 1000).toISOString(),
      }),
      contract({ id: "c2", providerId: "p-demohospb" }),
      contract({ id: "c3", providerId: "p-demohospc" }),
    ]);
    await expect(
      svc.admit(SPEC, { contractIds: ["c1", "c2", "c3"] }),
    ).rejects.toThrow(/p-demohospa/);
  });

  it("rejects a revoked contract", async () => {
    const svc = mk([
      contract({ id: "c1", providerId: "p-demohospa", status: "revoked" }),
      contract({ id: "c2", providerId: "p-demohospb" }),
      contract({ id: "c3", providerId: "p-demohospc" }),
    ]);
    await expect(
      svc.admit(SPEC, { contractIds: ["c1", "c2", "c3"] }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects on consumer mismatch", async () => {
    const svc = mk([
      contract({ id: "c1", providerId: "p-demohospa", consumerId: "other" }),
      contract({ id: "c2", providerId: "p-demohospb" }),
      contract({ id: "c3", providerId: "p-demohospc" }),
    ]);
    await expect(
      svc.admit(SPEC, { contractIds: ["c1", "c2", "c3"] }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("enforces purpose when provided", async () => {
    const list = [
      contract({ id: "c1", providerId: "p-demohospa", purpose: CKD_PURPOSE }),
      contract({ id: "c2", providerId: "p-demohospb", purpose: CKD_PURPOSE }),
      contract({ id: "c3", providerId: "p-demohospc", purpose: CKD_PURPOSE }),
    ];
    await expect(
      mk(list).admit(SPEC, {
        contractIds: ["c1", "c2", "c3"],
        purpose: "cardio",
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      mk(list).admit(SPEC, {
        contractIds: ["c1", "c2", "c3"],
        purpose: CKD_PURPOSE,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects with no contracts at all (fail-closed)", async () => {
    await expect(mk([]).admit(SPEC, {})).rejects.toThrow(ForbiddenException);
  });

  // D-CMP-2：合约匹配后再过预审复核，网关拒绝即不予准入（fail-closed）。
  it("routes matched contracts through the pre-review gate; gate rejection blocks admission", async () => {
    const gate = {
      check: jest.fn(async () => {
        throw new ForbiddenException("合约无合规预审快照");
      }),
    } as unknown as PreReviewGate;
    const svc = mk(
      [
        contract({ id: "c1", providerId: "p-demohospa" }),
        contract({ id: "c2", providerId: "p-demohospb" }),
        contract({ id: "c3", providerId: "p-demohospc" }),
      ],
      gate,
    );
    await expect(
      svc.admit(SPEC, { contractIds: ["c1", "c2", "c3"] }),
    ).rejects.toThrow(/预审/);
    expect(gate.check).toHaveBeenCalled();
  });
});
