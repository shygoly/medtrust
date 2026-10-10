import { ForbiddenException } from "@nestjs/common";
import { ComputeTaskStatus } from "@medtrust/database";
import { ckdEsrdRiskFlPredictionSpec } from "../../compute-task/dto/fl-prediction-task-spec";
import { buildMockFlPartyRunResult } from "../../compute-task/dto/fl-run-result";
import { ComputeTaskService } from "../../compute-task/compute-task.service";
import { ContractService } from "../digital-contract/contract.service";
import { mockRepo } from "../test-utils/mock-repo";
import {
  FlPredictionAssignmentEntity,
  FlPredictionTaskEntity,
} from "@medtrust/database";
import { FlAdmissionService } from "./fl-admission.service";
import { FlAttestationService } from "./fl-attestation.service";
import { FlOrchestratorService } from "./fl-orchestrator.service";

const spec = ckdEsrdRiskFlPredictionSpec();

function mockContract(providerId: string, dataProductId: string) {
  return {
    id: `c-${providerId}`,
    dataProductId,
    providerId,
    consumerId: "p-meddata",
    purpose: spec.purpose,
    retention: "阅后即焚",
    output: "仅聚合",
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    status: "active",
  };
}

describe("FlAdmissionService", () => {
  let admission: FlAdmissionService;
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue("active"),
  };
  // 预审复核在 pre-review-gate.spec 单测；此处 no-op，聚焦合约匹配。
  const preReviewGate = { check: jest.fn(async () => undefined) };

  beforeEach(() => {
    jest.clearAllMocks();
    admission = new FlAdmissionService(
      contracts as unknown as ContractService,
      preReviewGate as never,
    );
  });

  it("admits contracts covering all provider parties", async () => {
    contracts.get.mockImplementation(async (id: string) => {
      if (id === "c-demohospa")
        return mockContract("p-demohospa", "dp-insulin-panc-demohospa");
      if (id === "c-demohospb")
        return mockContract("p-demohospb", "dp-insulin-panc-demohospb");
      return null;
    });
    const out = await admission.admit(
      ["c-demohospa", "c-demohospb"],
      "p-meddata",
      spec,
    );
    expect(out).toHaveLength(2);
  });

  it("denies when data product mismatches spec", async () => {
    contracts.get.mockResolvedValue(mockContract("p-demohospa", "wrong-product"));
    await expect(
      admission.admit(["c-demohospa", "c-demohospb"], "p-meddata", spec),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("FlOrchestratorService", () => {
  let orchestrator: FlOrchestratorService;
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue("active"),
  };
  const admission = { admit: jest.fn() };
  const computeTasks = { updateStatus: jest.fn() };
  const flAttestation = {
    attestMergedResult: jest.fn((r: unknown) => r),
  };
  const taskRepo = mockRepo<FlPredictionTaskEntity>();
  const assignmentRepo = mockRepo<FlPredictionAssignmentEntity>();

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new FlOrchestratorService(
      admission as unknown as FlAdmissionService,
      contracts as unknown as ContractService,
      computeTasks as unknown as ComputeTaskService,
      flAttestation as unknown as FlAttestationService,
      taskRepo,
      assignmentRepo,
    );
  });

  it("pull → complete from two providers merges FL run result", async () => {
    admission.admit.mockResolvedValue([
      mockContract("p-demohospa", "dp-insulin-panc-demohospa"),
      mockContract("p-demohospb", "dp-insulin-panc-demohospb"),
    ]);

    const record = await orchestrator.submit({
      flPredictionSpec: spec,
      contractIds: ["c-demohospa", "c-demohospb"],
      consumerId: "p-meddata",
      computeTaskId: 42,
    });

    const pendingA = await orchestrator.pullPending("p-demohospa");
    const pendingB = await orchestrator.pullPending("p-demohospb");
    expect(pendingA).toHaveLength(1);
    expect(pendingB).toHaveLength(1);

    await orchestrator.completeAssignment(
      pendingA[0].assignmentId,
      "p-demohospa",
      {
        partyResult: buildMockFlPartyRunResult(
          record.taskId,
          "p-demohospa",
          59,
          spec.rounds,
        ),
      },
    );

    const partial = await orchestrator.get(record.taskId);
    expect(partial.status).toBe("running");

    const done = await orchestrator.completeAssignment(
      pendingB[0].assignmentId,
      "p-demohospb",
      {
        partyResult: buildMockFlPartyRunResult(
          record.taskId,
          "p-demohospb",
          41,
          spec.rounds,
        ),
      },
    );

    expect(done.status).toBe("completed");
    expect(done.merged?.modelHash).toMatch(/^FL:/);
    expect(done.resultSummary?.auc).toBeDefined();
    // top-level attestation lifted from merged.attestation for direct access
    expect(done.attestation?.reportHash).toBeDefined();
    expect(done.attestation).toEqual(
      (done.merged as { attestation?: unknown }).attestation,
    );
    expect(flAttestation.attestMergedResult).toHaveBeenCalled();
    expect(computeTasks.updateStatus).toHaveBeenCalledWith(42, {
      status: ComputeTaskStatus.COMPLETED,
      resultSummary: done.resultSummary,
    });
  });
});
