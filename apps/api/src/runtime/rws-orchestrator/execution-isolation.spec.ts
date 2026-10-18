import { BadRequestException } from "@nestjs/common";
import { RwsAssignmentEntity, RwsTaskEntity } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AttestationService } from "../digital-contract/attestation.service";
import { ContractService } from "../digital-contract/contract.service";
import { CatalogService } from "../catalog/catalog.service";
import { mockRepo } from "../test-utils/mock-repo";
import { L0ValidationMergeService } from "./l0-validation-merge";
import { MetaAnalysisService } from "./meta-analysis.service";
import { RwsAdmissionService } from "./rws-admission.service";
import {
  RwsOrchestratorService,
  aggregateSm3,
  readExecutionAnnotation,
} from "./rws-orchestrator.service";
import { toOrchestrationRecord, toPendingTask } from "./rws-persistence";

const SM3 = "b2760b0c56727fd77d0cc7d02d005400a0b31fa5b8894042c079e75618867ced";

describe("readExecutionAnnotation — 执行标注枚举校验 (5.5)", () => {
  it("缺失按 none 处理(旧版连接器)", () => {
    expect(readExecutionAnnotation({ cohortSize: 1, buckets: [] })).toEqual({
      isolation: "none",
    });
    expect(readExecutionAnnotation(null)).toEqual({ isolation: "none" });
  });

  it("非法标注值 → 400", () => {
    expect(() =>
      readExecutionAnnotation({ execution: { isolation: "hardware-tee" } }),
    ).toThrow(BadRequestException);
    expect(() =>
      readExecutionAnnotation({ execution: "wasm-sandbox" }),
    ).toThrow(/必须是对象/);
  });

  it("wasm-sandbox 必须带合法模块 SM3", () => {
    expect(() =>
      readExecutionAnnotation({ execution: { isolation: "wasm-sandbox" } }),
    ).toThrow(/必须携带 64 hex/);
    expect(
      readExecutionAnnotation({
        execution: { isolation: "wasm-sandbox", moduleSm3: SM3, abiVersion: 1 },
      }),
    ).toEqual({ isolation: "wasm-sandbox", moduleSm3: SM3, abiVersion: 1 });
  });

  it("isolation=none 时忽略多余字段", () => {
    expect(
      readExecutionAnnotation({ execution: { isolation: "none" } }),
    ).toEqual({ isolation: "none" });
  });
});

describe("派发记录:模块引用与执行隔离字段 (5.1/5.4)", () => {
  const baseAssignment = (over: Partial<RwsAssignmentEntity>) =>
    ({
      assignmentId: "a1",
      taskId: "t1",
      providerId: "p-demohospa",
      purpose: "PV",
      analysis: {
        type: "adverse-event-signal",
        drug: "D",
        designType: "cross-sectional",
        rationale: "药物警戒描述性失衡分析",
      },
      contract: { id: "c1" },
      status: "pending",
      progress: [],
      executionIsolation: "none",
      ...over,
    }) as RwsAssignmentEntity;

  it("合约固定了模块 → 派发携带 module 引用", () => {
    const pending = toPendingTask(
      baseAssignment({
        contract: {
          id: "c1",
          pinnedModules: { "adverse-event-signal": SM3 },
        } as never,
      }),
    );
    expect(pending.module).toEqual({
      analysisType: "adverse-event-signal",
      sm3: SM3,
    });
  });

  it("合约未固定模块 → 不携带 module", () => {
    expect(toPendingTask(baseAssignment({})).module).toBeUndefined();
  });

  it("任务级执行隔离取最弱", () => {
    const task = { taskId: "t1" } as RwsTaskEntity;
    const weakest = toOrchestrationRecord(task, [
      baseAssignment({
        assignmentId: "a1",
        status: "completed",
        executionIsolation: "wasm-sandbox",
      }),
      baseAssignment({
        assignmentId: "a2",
        status: "completed",
        executionIsolation: "none",
      }),
    ]);
    expect(weakest.executionIsolation).toBe("none");

    const allSandbox = toOrchestrationRecord(task, [
      baseAssignment({
        assignmentId: "a1",
        status: "completed",
        executionIsolation: "wasm-sandbox",
      }),
      baseAssignment({ assignmentId: "a2", status: "pending" }),
    ]);
    expect(allSandbox.executionIsolation).toBe("wasm-sandbox");

    const noneDone = toOrchestrationRecord(task, [
      baseAssignment({ assignmentId: "a2", status: "pending" }),
    ]);
    expect(noneDone.executionIsolation).toBeUndefined();
  });
});

describe("RwsOrchestratorService — 结果入库与存证元数据 (5.5/5.6)", () => {
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue("active"),
  };
  const admission = { admit: jest.fn() };
  let taskRepo: ReturnType<typeof mockRepo<RwsTaskEntity>>;
  let assignmentRepo: ReturnType<typeof mockRepo<RwsAssignmentEntity>>;
  let attestation: AttestationService;
  let orchestrator: RwsOrchestratorService;

  beforeEach(() => {
    jest.clearAllMocks();
    taskRepo = mockRepo<RwsTaskEntity>();
    assignmentRepo = mockRepo<RwsAssignmentEntity>();
    attestation = new AttestationService(new GMCryptoService());
    orchestrator = new RwsOrchestratorService(
      admission as unknown as RwsAdmissionService,
      contracts as unknown as ContractService,
      new MetaAnalysisService(new GMCryptoService(), attestation),
      new L0ValidationMergeService(new GMCryptoService(), attestation),
      taskRepo,
      assignmentRepo,
      attestation,
    );
    admission.admit.mockResolvedValue([
      {
        id: "c1",
        dataProductId: "dp1",
        providerId: "p-demohospa",
        consumerId: "p-meddata",
        purpose: "PV",
        retention: "阅后即焚",
        output: "仅聚合",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        status: "active",
        pinnedModules: { "adverse-event-signal": SM3 },
      },
    ]);
  });

  async function submitAndPull(providerId = "p-demohospa") {
    const record = await orchestrator.submit({
      purpose: "PV",
      analysis: {
        type: "adverse-event-signal",
        drug: "D",
        designType: "cross-sectional",
        rationale: "药物警戒描述性失衡分析",
      },
      contractIds: ["c1"],
      consumerId: "p-meddata",
    });
    const [pending] = await orchestrator.pullPending(providerId);
    return { taskId: record.taskId, pending };
  }

  const l15Aggregate = (execution?: unknown) => ({
    analysisType: "adverse-event-signal",
    cohortSize: 10,
    buckets: [{ key: "ALT升高", count: 6, rate: 0.6, b: 0, c: 0, d: 4 }],
    ...(execution ? { execution } : {}),
  });

  it("wasm-sandbox 标注入库并写进存证元数据", async () => {
    const anchorSpy = jest.spyOn(attestation, "anchor");
    const { taskId, pending } = await submitAndPull();
    expect(pending.module).toEqual({
      analysisType: "adverse-event-signal",
      sm3: SM3,
    });

    const aggregate = l15Aggregate({
      isolation: "wasm-sandbox",
      moduleSm3: SM3,
      abiVersion: 1,
    });
    await orchestrator.completeAssignment(pending.assignmentId, "p-demohospa", {
      aggregate,
      aggregateHash: aggregateSm3(aggregate),
    });

    const [row] = await assignmentRepo.find({ where: { taskId } });
    expect(row.executionIsolation).toBe("wasm-sandbox");
    expect(row.moduleSm3).toBe(SM3);
    const record = await orchestrator.get(taskId);
    expect(record.executionIsolation).toBe("wasm-sandbox");
    expect(record.assignments[0].executionIsolation).toBe("wasm-sandbox");
    expect(record.assignments[0].moduleSm3).toBe(SM3);

    expect(anchorSpy).toHaveBeenCalled();
    const metadata = anchorSpy.mock.calls.at(-1)?.[1];
    expect(metadata).toMatchObject({
      executionIsolation: "wasm-sandbox",
      moduleSm3: [SM3],
    });
    // attestationLevel 保持不变(沙箱 ≠ TEE)
    const receipt = await anchorSpy.mock.results.at(-1)?.value;
    expect(receipt.attestationLevel).toBe("software");
  });

  it("缺失标注按 none 入库", async () => {
    const { taskId, pending } = await submitAndPull();
    const aggregate = l15Aggregate();
    await orchestrator.completeAssignment(pending.assignmentId, "p-demohospa", {
      aggregate,
      aggregateHash: aggregateSm3(aggregate),
    });
    const [row] = await assignmentRepo.find({ where: { taskId } });
    expect(row.executionIsolation).toBe("none");
    expect(row.moduleSm3).toBeNull();
    expect((await orchestrator.get(taskId)).executionIsolation).toBe("none");
  });

  it("非法标注被拒(400),且不入库", async () => {
    const { taskId, pending } = await submitAndPull();
    const aggregate = l15Aggregate({ isolation: "wasm-sandbox" });
    await expect(
      orchestrator.completeAssignment(pending.assignmentId, "p-demohospa", {
        aggregate,
        aggregateHash: aggregateSm3(aggregate),
      }),
    ).rejects.toThrow(/必须携带 64 hex/);
    const [row] = await assignmentRepo.find({ where: { taskId } });
    expect(row.status).not.toBe("completed");
  });

  it("标注被篡改 → 验哈希失败,拒绝入库", async () => {
    const { pending } = await submitAndPull();
    const aggregate = l15Aggregate({
      isolation: "wasm-sandbox",
      moduleSm3: SM3,
      abiVersion: 1,
    });
    const tampered = {
      ...aggregate,
      execution: { isolation: "none" },
    };
    await expect(
      orchestrator.completeAssignment(pending.assignmentId, "p-demohospa", {
        aggregate: tampered,
        aggregateHash: aggregateSm3(aggregate),
      }),
    ).rejects.toThrow(/哈希校验失败/);
  });
});

describe("合同固定模块条款计入哈希 (5.7)", () => {
  function service(registry?: { manifest: (sm3: string) => unknown }) {
    const gm = new GMCryptoService();
    const catalog = {
      get: async () => ({
        id: "dp-1",
        urn: "urn:test",
        homeSpace: "sh-med",
        providerId: "p-demohospa",
        title: "t",
        productType: "data",
        rightsConfirmed: true,
        recordCount: 1,
        fhirSchema: null,
      }),
    } as unknown as CatalogService;
    return new ContractService(
      gm,
      mockRepo() as never,
      catalog,
      undefined,
      registry as never,
    );
  }

  const registry = {
    manifest: (sm3: string) =>
      sm3 === SM3
        ? { analysisType: "adverse-event-signal", abiVersion: 1 }
        : undefined,
  };
  const base = {
    dataProductId: "dp-1",
    providerId: "p-demohospa",
    consumerId: "p-meddata",
    purpose: "PV",
    retention: "阅后即焚",
    output: "仅聚合",
    validDays: 90,
  };

  it("固定模块改变合约哈希(可存证、事后不可改)", async () => {
    const without = await service(registry).approve({ ...base });
    const withModule = await service(registry).approve({
      ...base,
      pinnedModules: { "adverse-event-signal": SM3 },
    });
    expect(withModule.hash).not.toBe(without.hash);
    expect(withModule.pinnedModules).toEqual({ "adverse-event-signal": SM3 });
  });

  it("条款归一化后哈希稳定(键序/大小写不敏感)", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-18T00:00:00Z") });
    try {
      const a = await service(registry).approve({
        ...base,
        pinnedModules: { "adverse-event-signal": SM3.toUpperCase() },
      });
      const b = await service(registry).approve({
        ...base,
        pinnedModules: { "adverse-event-signal": SM3 },
      });
      expect(a.hash).toBe(b.hash);
      expect(a.pinnedModules).toEqual({ "adverse-event-signal": SM3 });
    } finally {
      jest.useRealTimers();
    }
  });

  it("未登记模块 / 分析类型不符 / SM3 非法 → 拒绝", async () => {
    await expect(
      service(registry).approve({
        ...base,
        pinnedModules: { "adverse-event-signal": "c".repeat(64) },
      }),
    ).rejects.toThrow(/不在平台算法模块注册表内/);

    await expect(
      service({
        manifest: () => ({ analysisType: "comparative-effect", abiVersion: 1 }),
      }).approve({
        ...base,
        pinnedModules: { "adverse-event-signal": SM3 },
      }),
    ).rejects.toThrow(/分析类型不符/);

    await expect(
      service(registry).approve({
        ...base,
        pinnedModules: { "adverse-event-signal": "not-a-sm3" },
      }),
    ).rejects.toThrow(/SM3 非法/);
  });
});
