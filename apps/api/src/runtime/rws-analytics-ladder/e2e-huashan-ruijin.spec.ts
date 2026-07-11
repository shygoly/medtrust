/**
 * OpenSpec rws-analytics-ladder 组7.1 + 7.2 — API 侧华山+瑞金 CKD 阶梯 E2E.
 */
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ComputeTaskStatus } from "@medtrust/database";
import { ckdEsrdRiskFlPredictionSpec } from "../../compute-task/dto/fl-prediction-task-spec";
import {
  buildMockFlPartyRunResult,
} from "../../compute-task/dto/fl-run-result";
import { ComputeTaskService } from "../../compute-task/compute-task.service";
import { ContractService } from "../digital-contract/contract.service";
import { AttestationService } from "../digital-contract/attestation.service";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { mockRepo } from "../test-utils/mock-repo";
import {
  FlPredictionAssignmentEntity,
  FlPredictionTaskEntity,
  RwsAssignmentEntity,
  RwsTaskEntity,
} from "@medtrust/database";
import { FlAdmissionService } from "../fl-orchestrator/fl-admission.service";
import { FlAttestationService } from "../fl-orchestrator/fl-attestation.service";
import { FlOrchestratorService } from "../fl-orchestrator/fl-orchestrator.service";
import { RwsAdmissionService } from "../rws-orchestrator/rws-admission.service";
import { MetaAnalysisService } from "../rws-orchestrator/meta-analysis.service";
import { RwsOrchestratorService } from "../rws-orchestrator/rws-orchestrator.service";

const flSpec = ckdEsrdRiskFlPredictionSpec();
const PV = "药物警戒";

function mockPvContract(providerId: string, id: string) {
  return {
    id,
    dataProductId: providerId === "p-huashan" ? "dp-ckd-ehr" : "dp-dkd-cohort",
    providerId,
    consumerId: "p-meddata",
    purpose: PV,
    retention: "阅后即焚",
    output: "仅聚合",
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    status: "active",
  };
}

function disproportionalityAgg(cohortSize: number) {
  return {
    analysisType: "disproportionality",
    cohortSize,
    buckets: [
      { key: "ALT升高", count: 4, rate: 0.1, b: 6, c: 2, d: 28 },
    ],
  };
}

function comparativeAgg(beta: number, se: number) {
  return {
    analysisType: "comparative-effect",
    cohortSize: 80,
    outcome: "ALT升高",
    buckets: [{ key: "40-49", count: 8, rate: 0.1, b: 12, c: 3, d: 57 }],
    effectEstimate: {
      measure: "log_or" as const,
      beta,
      standardError: se,
      covariance: [
        [0.1, 0],
        [0, se * se],
      ],
      ci95: [beta - 0.2, beta + 0.2] as [number, number],
      mantelHaenszel: {
        logOr: beta,
        or: Math.exp(beta),
        standardError: se,
        ci95: [beta - 0.2, beta + 0.2] as [number, number],
      },
    },
  };
}

function causalSurvivalAgg(beta: number, se: number) {
  return {
    analysisType: "causal-survival",
    cohortSize: 120,
    buckets: [],
    effectEstimate: {
      measure: "log_hr" as const,
      beta,
      standardError: se,
      ci95: [beta - 0.15, beta + 0.15] as [number, number],
    },
    kmCurve: {
      binWidthDays: 30,
      bins: [
        { t: 0, survival: 1, atRisk: 120 },
        { t: 180, survival: 0.85, atRisk: 80 },
      ],
    },
  };
}

describe("7.2 e2e — 华山+瑞金 analytics ladder", () => {
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue("active"),
  };
  const rwsAdmission = { admit: jest.fn() };
  const rwsTaskRepo = mockRepo<RwsTaskEntity>();
  const rwsAssignmentRepo = mockRepo<RwsAssignmentEntity>();
  let rwsOrchestrator: RwsOrchestratorService;

  beforeEach(() => {
    jest.clearAllMocks();
    rwsOrchestrator = new RwsOrchestratorService(
      rwsAdmission as unknown as RwsAdmissionService,
      contracts as unknown as ContractService,
      new MetaAnalysisService(
        new GMCryptoService(),
        new AttestationService(new GMCryptoService()),
      ),
      rwsTaskRepo,
      rwsAssignmentRepo,
    );
    rwsAdmission.admit.mockResolvedValue([
      mockPvContract("p-huashan", "c-h"),
      mockPvContract("p-ruijin", "c-r"),
    ]);
  });

  it("L1.5 disproportionality: two sites merge without row-level payload", async () => {
    const record = await rwsOrchestrator.submit({
      purpose: PV,
      analysis: { type: "disproportionality", level: "L1.5", drug: "目标药" },
      contractIds: ["c-h", "c-r"],
      consumerId: "p-meddata",
    });
    const h = await rwsOrchestrator.pullPending("p-huashan");
    await rwsOrchestrator.completeAssignment(h[0].assignmentId, "p-huashan", {
      aggregate: disproportionalityAgg(40),
    });
    const r = await rwsOrchestrator.pullPending("p-ruijin");
    const done = await rwsOrchestrator.completeAssignment(
      r[0].assignmentId,
      "p-ruijin",
      { aggregate: disproportionalityAgg(30) },
    );
    expect(done.status).toBe("completed");
    expect(done.merged?.cohortSize).toBe(70);
    expect(JSON.stringify(done.merged)).not.toContain("subjectKey");
  });

  it("L2 comparative-effect: gate → meta pooled OR", async () => {
    const record = await rwsOrchestrator.submit({
      purpose: PV,
      analysis: {
        type: "comparative-effect",
        level: "L2",
        drug: "目标药",
        outcome: "ALT升高",
      },
      contractIds: ["c-h", "c-r"],
      consumerId: "p-meddata",
    });
    const h = await rwsOrchestrator.pullPending("p-huashan");
    await rwsOrchestrator.completeAssignment(h[0].assignmentId, "p-huashan", {
      aggregate: comparativeAgg(0.55, 0.18),
    });
    const r = await rwsOrchestrator.pullPending("p-ruijin");
    const done = await rwsOrchestrator.completeAssignment(
      r[0].assignmentId,
      "p-ruijin",
      { aggregate: comparativeAgg(0.42, 0.2) },
    );
    expect(done.merged?.metaPooled?.merged).toBe(true);
    if (done.merged?.metaPooled?.merged) {
      expect(done.merged.metaPooled.pooledOr).toBeGreaterThan(0);
    }
    expect(record.taskId).toBeDefined();
  });

  it("L3 causal-survival: gate → meta pooled HR", async () => {
    await rwsOrchestrator.submit({
      purpose: PV,
      analysis: {
        type: "causal-survival",
        level: "L3",
        method: "cox",
        tte: {
          exposureArm: "drug:目标药",
          comparatorArm: "drug:对照药",
          timeZeroRule: "index_date",
          inclusion: ["age>=18"],
          exclusion: [],
          outcome: { type: "time_to_event", event: "renal_failure" },
        },
      },
      contractIds: ["c-h", "c-r"],
      consumerId: "p-meddata",
    });
    const h = await rwsOrchestrator.pullPending("p-huashan");
    await rwsOrchestrator.completeAssignment(h[0].assignmentId, "p-huashan", {
      aggregate: causalSurvivalAgg(-0.22, 0.09),
    });
    const r = await rwsOrchestrator.pullPending("p-ruijin");
    const done = await rwsOrchestrator.completeAssignment(
      r[0].assignmentId,
      "p-ruijin",
      { aggregate: causalSurvivalAgg(-0.31, 0.11) },
    );
    expect(done.merged?.metaPooled?.merged).toBe(true);
    if (done.merged?.metaPooled?.merged) {
      expect(done.merged.metaPooled.pooledHr).toBeGreaterThan(0);
    }
  });
});

describe("7.2 e2e — L4 FL 轨道 (华山+瑞金 CKD)", () => {
  const flSpec = ckdEsrdRiskFlPredictionSpec();
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue("active"),
  };
  const admission = { admit: jest.fn() };
  const computeTasks = { updateStatus: jest.fn() };
  const flAttestation = { attestMergedResult: jest.fn((r: unknown) => r) };
  const taskRepo = mockRepo<FlPredictionTaskEntity>();
  const assignmentRepo = mockRepo<FlPredictionAssignmentEntity>();
  let flOrchestrator: FlOrchestratorService;

  beforeEach(() => {
    jest.clearAllMocks();
    flOrchestrator = new FlOrchestratorService(
      admission as unknown as FlAdmissionService,
      contracts as unknown as ContractService,
      computeTasks as unknown as ComputeTaskService,
      flAttestation as unknown as FlAttestationService,
      taskRepo,
      assignmentRepo,
    );
    admission.admit.mockResolvedValue([
      {
        id: "c-h",
        dataProductId: "dp-ckd-ehr",
        providerId: "p-huashan",
        consumerId: "p-meddata",
        purpose: flSpec.purpose,
        retention: "阅后即焚",
        output: "仅聚合",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        status: "active",
      },
      {
        id: "c-r",
        dataProductId: "dp-dkd-cohort",
        providerId: "p-ruijin",
        consumerId: "p-meddata",
        purpose: flSpec.purpose,
        retention: "阅后即焚",
        output: "仅聚合",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        status: "active",
      },
    ]);
  });

  it("pull → complete → merged AUC/F1/modelHash + attestation", async () => {
    const record = await flOrchestrator.submit({
      flPredictionSpec: flSpec,
      contractIds: ["c-h", "c-r"],
      consumerId: "p-meddata",
      computeTaskId: 7,
    });
    const h = await flOrchestrator.pullPending("p-huashan");
    const r = await flOrchestrator.pullPending("p-ruijin");
    await flOrchestrator.completeAssignment(h[0].assignmentId, "p-huashan", {
      partyResult: buildMockFlPartyRunResult(record.taskId, "p-huashan", 59, flSpec.rounds),
    });
    const done = await flOrchestrator.completeAssignment(
      r[0].assignmentId,
      "p-ruijin",
      {
        partyResult: buildMockFlPartyRunResult(record.taskId, "p-ruijin", 41, flSpec.rounds),
      },
    );
    expect(done.status).toBe("completed");
    expect(done.merged?.modelHash).toMatch(/^FL:/);
    expect(done.resultSummary?.auc).toBeDefined();
    expect(flAttestation.attestMergedResult).toHaveBeenCalled();
    expect(computeTasks.updateStatus).toHaveBeenCalledWith(7, {
      status: ComputeTaskStatus.COMPLETED,
      resultSummary: done.resultSummary,
    });
  });
});

describe("7.1 scenario registry — federated-meta-analysis", () => {
  it("rejects row-level meta input (scenario: 拒绝个体行输入)", () => {
    const meta = new MetaAnalysisService(
      new GMCryptoService(),
      new AttestationService(new GMCryptoService()),
    );
    expect(() =>
      meta.mergeSiteEffects([{ siteId: "p1", effect: 0.1, standardError: 0.05, subjectKey: "x" }]),
    ).toThrow();
  });

  it("skips merge with single site (scenario: 参与方不足无法合并)", () => {
    const meta = new MetaAnalysisService(
      new GMCryptoService(),
      new AttestationService(new GMCryptoService()),
    );
    const out = meta.mergeSiteEffects([
      { siteId: "p-huashan", effect: 0.5, standardError: 0.2 },
    ]);
    expect(out.merged).toBe(false);
  });
});

describe("7.1 scenario registry — usage-control admission", () => {
  it("denies FL when contract data product mismatches (产物/合约越界路径)", async () => {
    const contracts = {
      get: jest.fn().mockResolvedValue({
        id: "c1",
        providerId: "p-huashan",
        consumerId: "p-meddata",
        purpose: flSpec.purpose,
        dataProductId: "wrong",
        status: "active",
      }),
      effectiveStatus: jest.fn().mockReturnValue("active"),
    };
    const admission = new FlAdmissionService(contracts as unknown as ContractService);
    await expect(
      admission.admit(["c1"], "p-meddata", ckdEsrdRiskFlPredictionSpec()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("7.1 scenario registry — orchestrator guards", () => {
  it("rejects completion from wrong provider", async () => {
    const contracts = {
      get: jest.fn(),
      effectiveStatus: jest.fn().mockReturnValue("active"),
    };
    const admission = { admit: jest.fn().mockResolvedValue([mockPvContract("p-ruijin", "c1")]) };
    const orch = new RwsOrchestratorService(
      admission as unknown as RwsAdmissionService,
      contracts as unknown as ContractService,
      new MetaAnalysisService(
        new GMCryptoService(),
        new AttestationService(new GMCryptoService()),
      ),
      mockRepo<RwsTaskEntity>(),
      mockRepo<RwsAssignmentEntity>(),
    );
    await orch.submit({
      purpose: PV,
      analysis: { type: "cohort-count" },
      contractIds: ["c1"],
      consumerId: "p-meddata",
    });
    const pending = await orch.pullPending("p-ruijin");
    await expect(
      orch.completeAssignment(pending[0].assignmentId, "p-huashan", {
        aggregate: { analysisType: "cohort-count", cohortSize: 1, buckets: [] },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
