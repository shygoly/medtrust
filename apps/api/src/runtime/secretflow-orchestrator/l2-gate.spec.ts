import { ForbiddenException } from "@nestjs/common";
import {
  SecretFlowOrchestratorService,
  OrchestrateInput,
} from "./secretflow-orchestrator.service";

// 聚焦 P2 的 L2 闸门: 直接 new 服务 + mock 依赖,验证 verdict 对派发的门控。
function validSpec() {
  return {
    parties: [
      { participantId: "hospital-a", role: "provider" },
      { participantId: "pharma", role: "consumer" },
    ],
    modalities: [{ type: "clinical_text" }],
    llmBackbone: { modelType: "llm", modelNameOrPath: "meditron-7b" },
    peftStrategy: { type: "lora", r: 8, alpha: 16, targetModules: ["q_proj"] },
    privacy: { teeRequired: true, heuEnabled: false },
    outputPolicy: { allowedArtifacts: ["lora_delta_hash"] },
  };
}

describe("SecretFlowOrchestratorService — L2 admission gate (P2)", () => {
  let capability: any,
    transpiler: any,
    fsm: any,
    rounds: any,
    events: any,
    admission: any,
    attestation: any,
    settlement: any,
    compliance: any,
    loraDeliverable: any;
  let record: any;
  let svc: SecretFlowOrchestratorService;

  beforeEach(() => {
    record = { taskId: "t", spec: validSpec(), history: [], state: "PENDING" };
    capability = { plan: jest.fn(() => []) };
    transpiler = { transpile: jest.fn(() => "payload") };
    fsm = { create: jest.fn(() => record), transition: jest.fn() };
    // 控制面不再直连 agent:派发 = 轮次入队(经连接器长轮询下发)
    rounds = {
      enqueue: jest.fn(async () => ({
        adapterDeltaJson: '{"w":[1]}',
        sampleCount: 1,
        localLoss: 0.5,
        message: "OK",
      })),
    };
    events = { broadcast: jest.fn() };
    admission = {
      admit: jest.fn(() => ({
        consumerId: "pharma",
        // 轮次任务要带合约快照(连接器据此做 PEP),因此准入必须返回每个 provider 的合约
        contracts: [
          {
            id: "c-1",
            dataProductId: "dp-1",
            providerId: "hospital-a",
            consumerId: "pharma",
            purpose: "研究",
            retention: "阅后即焚",
            output: "仅模型增量",
            validUntil: new Date(Date.now() + 86_400_000).toISOString(),
            status: "active",
          },
        ],
        contractHashes: [],
      })),
    };
    attestation = {};
    settlement = {};
    compliance = { evaluate: jest.fn() };
    loraDeliverable = { submitWorkPackage: jest.fn(), checkStatus: jest.fn() };
    svc = new SecretFlowOrchestratorService(
      capability,
      transpiler,
      fsm,
      rounds,
      events,
      admission,
      attestation,
      settlement,
      compliance,
      loraDeliverable as any,
    );
  });

  function input(over: Partial<OrchestrateInput> = {}): OrchestrateInput {
    return { spec: validSpec() as any, contractIds: [], ...over };
  }

  it("verdict=block → ForbiddenException, no dispatch", async () => {
    compliance.evaluate.mockResolvedValue({
      id: "e1",
      autoVerdict: "block",
      blockingRulesMatched: ["block-high-partial"],
    });
    await expect(
      svc.orchestrate(input({ compositionId: "c1" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rounds.enqueue).not.toHaveBeenCalled();
  });

  it("verdict=manual_review → ForbiddenException, no dispatch", async () => {
    compliance.evaluate.mockResolvedValue({
      id: "e2",
      autoVerdict: "manual_review",
      blockingRulesMatched: [],
    });
    await expect(
      svc.orchestrate(input({ compositionId: "c1" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rounds.enqueue).not.toHaveBeenCalled();
  });

  it("verdict=auto_approve → proceeds to dispatch, records evaluation id", async () => {
    compliance.evaluate.mockResolvedValue({
      id: "e3",
      autoVerdict: "auto_approve",
      blockingRulesMatched: [],
    });
    await svc.orchestrate(input({ compositionId: "c1" }));
    expect(rounds.enqueue).toHaveBeenCalledTimes(1);
    expect(record.complianceEvaluationId).toBe("e3");
  });

  it("no compositionId → L2 gate skipped, dispatch proceeds", async () => {
    await svc.orchestrate(input());
    expect(compliance.evaluate).not.toHaveBeenCalled();
    expect(rounds.enqueue).toHaveBeenCalledTimes(1);
  });
});
