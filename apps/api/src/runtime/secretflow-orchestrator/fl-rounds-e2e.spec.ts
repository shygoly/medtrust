/**
 * 联邦训练经连接器中转的端到端（outbound-longpoll-agent-auth 5.4）：
 * 两院多轮经轮次队列下发/回传能收敛；某院超时被踢出本轮后，下一轮能恢复参与。
 */
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AttestationService } from "../digital-contract/attestation.service";
import { SettlementService } from "../settlement/settlement.service";
import { ConnectorTaskNotifier } from "../connector-tasks/connector-task-notifier.service";
import { FlRoundQueueService } from "./fl-round-queue.service";
import { LoraDeliverableService } from "./lora-deliverable.service";
import { NodeCapabilityService } from "./node-capability.service";
import { OrchestratorFsmService } from "./orchestrator-fsm.service";
import { SecretFlowEventsGateway } from "./secretflow-events.gateway";
import { SecretFlowAdmissionService } from "./secretflow-admission.service";
import { SecretFlowOrchestratorService } from "./secretflow-orchestrator.service";
import { encodeAdapter, type AdapterState } from "./fed-adapter-merge";

const CONTRACT = (providerId: string) => ({
  id: `c-${providerId}`,
  dataProductId: `dp-${providerId}`,
  providerId,
  consumerId: "p-meddata",
  purpose: "联邦训练",
  retention: "阅后即焚",
  output: "仅模型增量",
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: "active" as const,
});

const SPEC = {
  purpose: "联邦训练",
  parties: [
    { participantId: "p-meddata", role: "consumer" as const },
    { participantId: "p-demohospa", role: "provider" as const },
    { participantId: "p-demohospb", role: "provider" as const },
  ],
  modalities: [{ type: "structured_ehr" as const, dataProductId: "dp-x" }],
  llmBackbone: { modelType: "clinical-lora", modelNameOrPath: "demo/model" },
  peftStrategy: {
    type: "lora" as const,
    r: 8,
    alpha: 16,
    targetModules: ["q_proj"],
  },
  privacy: { teeRequired: false, heuEnabled: false },
  outputPolicy: {
    preset: "model_only" as const,
    allowedArtifacts: [
      "encrypted_delta_ref" as const,
      "aggregate_metrics" as const,
    ],
    minCell: 5,
  },
  epochs: 3,
};

function delta(scale: number, key = "lora_a"): string {
  const values = new Float32Array([scale, scale, scale, scale]);
  const state: AdapterState = {
    [key]: {
      shape: [4],
      data: Buffer.from(values.buffer).toString("base64"),
    },
  };
  return encodeAdapter(state);
}

interface Harness {
  orchestrator: SecretFlowOrchestratorService;
  rounds: FlRoundQueueService;
  events: { broadcast: jest.Mock };
  connectors: Array<{ stop: () => Promise<void> }>;
}

/** 测试结束后确保模拟连接器循环停止(否则 jest 因未清定时器不退出)。 */
const liveConnectors: Array<{ stop: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(liveConnectors.splice(0).map((c) => c.stop()));
  delete process.env.SF_ROUND_TIMEOUT_MS;
});

function harness(opts: {
  /** 某院在指定轮次不回传（模拟超时/掉线）。 */
  silent?: (participantId: string, round: number) => boolean;
}): Harness {
  const notifier = new ConnectorTaskNotifier();
  const rounds = new FlRoundQueueService(notifier);
  const events = { broadcast: jest.fn() };
  const contracts = [CONTRACT("p-demohospa"), CONTRACT("p-demohospb")];

  const orchestrator = new SecretFlowOrchestratorService(
    {
      plan: () => [
        {
          participantId: "p-demohospa",
          tier: "teeu_full",
          device: "H100",
          offloadAggregation: false,
          localEpochs: 2,
          rationale: "test",
        },
        {
          participantId: "p-demohospb",
          tier: "pyu_only",
          device: "CPU",
          offloadAggregation: false,
          localEpochs: 1,
          rationale: "test",
        },
      ],
    } as unknown as NodeCapabilityService,
    { transpile: () => "payload" } as never,
    new OrchestratorFsmService(),
    rounds,
    events as unknown as SecretFlowEventsGateway,
    {
      admit: jest.fn().mockResolvedValue({
        consumerId: "p-meddata",
        contracts,
        contractHashes: contracts.map((c) => `${c.id}:hash`),
      }),
    } as unknown as SecretFlowAdmissionService,
    new AttestationService(new GMCryptoService()),
    { record: jest.fn() } as unknown as SettlementService,
    {
      sealAndStore: jest
        .fn()
        .mockResolvedValue({ encryptedDeltaRef: "enc:demo" }),
    } as unknown as LoraDeliverableService,
  );

  // 模拟各院连接器：长轮询领轮次 → 在院内训练 → 回传结果
  const connectors = ["p-demohospa", "p-demohospb"].map((participantId) => {
    let stopped = false;
    const loop = (async () => {
      while (!stopped) {
        for (const round of rounds.pullPendingRounds(participantId)) {
          if (opts.silent?.(participantId, round.round)) continue; // 本轮不回传 → 超时
          rounds.complete(round.roundTaskId, participantId, {
            adapterDeltaJson: delta(participantId === "p-demohospa" ? 1 : 3),
            sampleCount: participantId === "p-demohospa" ? 10 : 30,
            localLoss: 1 / (round.round + 2),
            message: "OK",
          });
        }
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    return {
      stop: async () => {
        stopped = true;
        await loop;
      },
    };
  });
  liveConnectors.push(...connectors);
  return { orchestrator, rounds, events, connectors };
}

describe("联邦训练经连接器中转 (D1/D3)", () => {
  it("两院多轮经连接器回传后收敛并完成", async () => {
    const h = harness({});
    const record = await h.orchestrator.orchestrate({
      spec: SPEC,
      contractIds: ["c-p-demohospa", "c-p-demohospb"],
    });
    expect(record.state).toBe("TRAINING");

    const final = await waitForTerminal(h.orchestrator, record.taskId);
    expect(final.state).toBe("COMPLETED");
    expect(final.error).toBeUndefined();
    const result = final.result as {
      roundsCompleted: number;
      metrics: { trainLoss: number; initialLoss: number };
    };
    expect(result.roundsCompleted).toBe(3);
    // 每轮 loss = 1/(round+2):0.5 → 0.333 → 0.25 → 收敛
    expect(result.metrics.trainLoss).toBeLessThan(result.metrics.initialLoss);
    expect(result.metrics.trainLoss).toBeCloseTo(0.25, 3);

    // 前端事件:baseline + 每轮 round_complete + result/done
    const phases = h.events.broadcast.mock.calls.map((c) => c[0].phase);
    expect(phases.filter((p) => p === "round_complete")).toHaveLength(3);
    expect(phases).toContain("baseline");
    expect(phases).toContain("result");
    expect(phases).toContain("done");
  }, 30_000);

  it("某院本轮超时被踢出,下一轮恢复参与", async () => {
    // 示范乙在第 1 轮(round=1)静默 → 该轮被补偿踢出;round=2 恢复
    process.env.SF_ROUND_TIMEOUT_MS = "300";
    const h = harness({
      silent: (pid, round) => pid === "p-demohospb" && round === 1,
    });
    const record = await h.orchestrator.orchestrate({
      spec: SPEC,
      contractIds: ["c-p-demohospa", "c-p-demohospb"],
    });
    const final = await waitForTerminal(h.orchestrator, record.taskId);

    // 任务最终完成:第 2 轮示范乙不在,第 3 轮恢复后仍计入贡献
    expect(final.state).toBe("COMPLETED");
    expect(final.droppedParties).toContain("p-demohospb");
    const result = final.result as {
      contributions: Array<{ participantId: string; share: number }>;
      metrics: { partyCount: number };
    };
    const reijin = result.contributions.find(
      (c) => c.participantId === "p-demohospb",
    );
    expect(reijin?.share ?? 0).toBeGreaterThan(0);
    // 补偿事件已推给前端
    expect(
      h.events.broadcast.mock.calls.some(
        (c) =>
          c[0].phase === "compensation" && c[0].participantId === "p-demohospb",
      ),
    ).toBe(true);
  }, 30_000);

  it("任务 spec 指定院内目录(dataPath)→ 控制面直接拒绝,不下发任何轮次(omop-data-source-access 4.3)", async () => {
    const h = harness({});
    for (const key of ["dataPath", "data_path"]) {
      await expect(
        h.orchestrator.orchestrate({
          spec: { ...SPEC, [key]: "/data/synthea/ingested" } as typeof SPEC,
          contractIds: ["c-p-demohospa", "c-p-demohospb"],
        }),
      ).rejects.toThrow(/dataPath 已废弃/);
    }
    expect(h.rounds.pendingCount()).toBe(0);
  });

  it("全部医院不回传 → 轮次超时后任务失败", async () => {
    // 用短超时覆盖环境默认值
    process.env.SF_ROUND_TIMEOUT_MS = "30";
    const h = harness({ silent: () => true });
    try {
      const record = await h.orchestrator.orchestrate({
        spec: SPEC,
        contractIds: ["c-p-demohospa", "c-p-demohospb"],
      });
      const final = await waitForTerminal(h.orchestrator, record.taskId);
      expect(final.state).toBe("FAILED");
      expect(final.error).toMatch(/第 1 轮全部医院未回传/);
      expect(
        h.events.broadcast.mock.calls.some((c) => c[0].phase === "failed"),
      ).toBe(true);
    } finally {
      delete process.env.SF_ROUND_TIMEOUT_MS;
    }
  }, 30_000);
});

async function waitForTerminal(
  orchestrator: SecretFlowOrchestratorService,
  taskId: string,
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = orchestrator.status(taskId);
    if (record.state === "COMPLETED" || record.state === "FAILED")
      return record;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`任务未在 ${timeoutMs}ms 内结束`);
}
