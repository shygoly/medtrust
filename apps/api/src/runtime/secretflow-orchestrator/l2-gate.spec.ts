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
    agent: any,
    bridge: any,
    admission: any,
    attestation: any,
    settlement: any,
    compliance: any;
  let record: any;
  let svc: SecretFlowOrchestratorService;

  beforeEach(() => {
    record = { taskId: "t", spec: validSpec(), history: [], state: "PENDING" };
    capability = { plan: jest.fn(() => []) };
    transpiler = { transpile: jest.fn(() => "payload") };
    fsm = { create: jest.fn(() => record), transition: jest.fn() };
    agent = {
      submitFLTask: jest.fn(async () => ({
        ackStatus: "ACCEPTED",
        taskStreamUrl: "ws://x",
        message: "ok",
      })),
      endpoint: jest.fn(() => "ep"),
    };
    bridge = { connect: jest.fn() };
    admission = {
      admit: jest.fn(() => ({
        consumerId: "pharma",
        contracts: [],
        contractHashes: [],
      })),
    };
    attestation = {};
    settlement = {};
    compliance = { evaluate: jest.fn() };
    svc = new SecretFlowOrchestratorService(
      capability,
      transpiler,
      fsm,
      agent,
      bridge,
      admission,
      attestation,
      settlement,
      compliance,
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
    expect(agent.submitFLTask).not.toHaveBeenCalled();
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
    expect(agent.submitFLTask).not.toHaveBeenCalled();
  });

  it("verdict=auto_approve → proceeds to dispatch, records evaluation id", async () => {
    compliance.evaluate.mockResolvedValue({
      id: "e3",
      autoVerdict: "auto_approve",
      blockingRulesMatched: [],
    });
    await svc.orchestrate(input({ compositionId: "c1" }));
    expect(agent.submitFLTask).toHaveBeenCalledTimes(1);
    expect(record.complianceEvaluationId).toBe("e3");
  });

  it("no compositionId → L2 gate skipped, dispatch proceeds", async () => {
    await svc.orchestrate(input());
    expect(compliance.evaluate).not.toHaveBeenCalled();
    expect(agent.submitFLTask).toHaveBeenCalledTimes(1);
  });
});
