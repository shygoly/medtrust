import { ForbiddenException } from "@nestjs/common";
import {
  SecretFlowOrchestratorService,
  OrchestrateInput,
} from "./secretflow-orchestrator.service";

// D-CMP-2：合规预审闸门已从 orchestrator 的 compositionId 入口迁到统一准入
// （SecretFlowAdmissionService → PreReviewGate）。本套件验证：
// ① orchestrator 不再消费 compositionId、不再自带 L2 闸门；② 准入驳回即不派发。
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

describe("SecretFlowOrchestratorService — 准入即预审闸门 (D-CMP-2)", () => {
  let capability: any,
    transpiler: any,
    fsm: any,
    rounds: any,
    events: any,
    admission: any,
    attestation: any,
    settlement: any,
    loraDeliverable: any;
  let record: any;
  let svc: SecretFlowOrchestratorService;

  const admittedOk = () => ({
    consumerId: "pharma",
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
  });

  beforeEach(() => {
    record = { taskId: "t", spec: validSpec(), history: [], state: "PENDING" };
    capability = { plan: jest.fn(() => []) };
    transpiler = { transpile: jest.fn(() => "payload") };
    fsm = { create: jest.fn(() => record), transition: jest.fn() };
    rounds = {
      enqueue: jest.fn(async () => ({
        adapterDeltaJson: '{"w":[1]}',
        sampleCount: 1,
        localLoss: 0.5,
        message: "OK",
      })),
    };
    events = { broadcast: jest.fn() };
    admission = { admit: jest.fn(async () => admittedOk()) };
    attestation = {};
    settlement = {};
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
      loraDeliverable as any,
    );
  });

  function input(over: Partial<OrchestrateInput> = {}): OrchestrateInput {
    return { spec: validSpec() as any, contractIds: [], ...over };
  }

  it("准入通过 → 派发（预审复核在准入内完成）", async () => {
    await svc.orchestrate(input());
    expect(admission.admit).toHaveBeenCalledTimes(1);
    expect(rounds.enqueue).toHaveBeenCalledTimes(1);
  });

  it("请求体带 compositionId 被忽略：不再触发 orchestrator 层 L2 闸门，派发照常", async () => {
    await svc.orchestrate(input({ compositionId: "c1" } as never));
    expect(rounds.enqueue).toHaveBeenCalledTimes(1);
  });

  it("准入驳回（预审复核失败等）→ ForbiddenException，不派发", async () => {
    admission.admit.mockRejectedValue(
      new ForbiddenException("合约无合规预审快照"),
    );
    await expect(svc.orchestrate(input())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(rounds.enqueue).not.toHaveBeenCalled();
  });
});
