import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as yaml from "js-yaml";
import { randomUUID } from "crypto";
import {
  SecretFlowTaskSpec,
  isSecretFlowTaskSpec,
} from "../../compute-task/dto/secretflow-task-spec";
import { NodeCapabilityService } from "./node-capability.service";
import { SecretFlowTranspilerService } from "./transpiler.service";
import { OrchestratorFsmService } from "./orchestrator-fsm.service";
import { FlRoundQueueService } from "./fl-round-queue.service";
import { SecretFlowEventsGateway } from "./secretflow-events.gateway";
import { toConnectorContractPayload } from "../shared/connector-contract-payload";
import {
  SecretFlowAdmissionService,
  AdmittedContracts,
} from "./secretflow-admission.service";
import { AttestationService } from "../digital-contract/attestation.service";
import { SettlementService } from "../settlement/settlement.service";
import {
  applyFedAvgDeltas,
  decodeAdapter,
  encodeAdapter,
  loraHashFromAdapter,
  type AdapterState,
} from "./fed-adapter-merge";
import {
  LoraDeliverableService,
  loraDeliverableFilename,
} from "./lora-deliverable.service";
import { DEMO_CONSUMER_SM2_KEYS } from "./demo-consumer-keys";
import {
  NodeCapabilityProfile,
  NodePlan,
  OrchestrationRecord,
  SettlementLine,
  SettlementSummary,
} from "./types";

export interface TaskBudget {
  amount: number;
  currency: string;
}

export interface OrchestrateInput {
  taskId?: string;
  specYaml?: string;
  spec?: Record<string, unknown>;
  profiles?: NodeCapabilityProfile[];
  contractIds?: string[];
  purpose?: string;
  budget?: TaskBudget;
}

const DEFAULT_BUDGET: TaskBudget = { amount: 100, currency: "CNY" };

export interface PlanPreview {
  taskId: string;
  spec: SecretFlowTaskSpec;
  nodePlan: NodePlan[];
  transpiledPayload: string;
}

/**
 * Space Orchestrator (design §2.1 / §3): the declarative-config-driven control
 * core. Validates the spec, evaluates node heterogeneity, transpiles the
 * SecretFlow payload, dispatches over gRPC, and bridges the live training-log
 * stream — all tracked by the FSM.
 */
@Injectable()
export class SecretFlowOrchestratorService {
  private readonly logger = new Logger(SecretFlowOrchestratorService.name);

  constructor(
    private readonly capability: NodeCapabilityService,
    private readonly transpiler: SecretFlowTranspilerService,
    private readonly fsm: OrchestratorFsmService,
    private readonly rounds: FlRoundQueueService,
    private readonly events: SecretFlowEventsGateway,
    private readonly admission: SecretFlowAdmissionService,
    private readonly attestation: AttestationService,
    private readonly settlement: SettlementService,
    private readonly loraDeliverable: LoraDeliverableService,
  ) {}

  /** Validate + plan + transpile without dispatching (UI preview, no agent). */
  preview(input: OrchestrateInput): PlanPreview {
    const spec = this.parseAndValidate(input);
    const taskId = input.taskId ?? randomUUID();
    const nodePlan = this.capability.plan(spec, input.profiles ?? []);
    const transpiledPayload = this.transpiler.transpile(taskId, spec, nodePlan);
    return { taskId, spec, nodePlan, transpiledPayload };
  }

  /** Full orchestration: PEP admission → dispatch → stream → settle. */
  async orchestrate(input: OrchestrateInput): Promise<OrchestrationRecord> {
    const spec = this.parseAndValidate(input);
    const taskId = input.taskId ?? randomUUID();
    const budget = input.budget ?? DEFAULT_BUDGET;

    // PEP admission (fail-closed): no authorizing contract → ForbiddenException.
    const admitted = await this.admission.admit(spec, {
      contractIds: input.contractIds,
      purpose: input.purpose,
    });

    const record = this.fsm.create(taskId, spec, [], "");
    record.contractRefs = admitted.contractHashes;

    // D-CMP-2:合规预审复核已在准入(SecretFlowAdmissionService.admit → PreReviewGate)统一执行,
    // 闸门以每份合约上的预审快照为准;请求体不再接受 compositionId。

    this.fsm.transition(taskId, "VALIDATING");

    const nodePlan = this.capability.plan(spec, input.profiles ?? []);
    record.nodePlan = nodePlan;
    this.fsm.transition(taskId, "PLANNING");

    const transpiledPayload = this.transpiler.transpile(taskId, spec, nodePlan);
    record.transpiledPayload = transpiledPayload;
    this.fsm.transition(taskId, "DISPATCHING");

    // outbound-longpoll-agent-auth D1/D3:控制面不再直接调用 agent。
    // 每院每轮的训练任务经连接器长轮询下发,由连接器在院内调用本院 agent。
    return this.orchestrateViaRounds(
      taskId,
      spec,
      record,
      nodePlan,
      transpiledPayload,
      admitted,
      budget,
    );
  }

  /**
   * Completion hook (business closure): anchor the run's attestation on-chain
   * and write a contribution-weighted settlement ledger entry. Only provider
   * parties earn; shares come from the agent's safe result.
   */
  private async settleCompletedTask(
    record: OrchestrationRecord,
    admitted: AdmittedContracts,
    budget: TaskBudget,
  ): Promise<void> {
    const result = record.result as
      | {
          state?: string;
          attestation?: { reportHash?: string };
          contributions?: Array<{ participantId: string; share: number }>;
        }
      | undefined;
    if (!result || result.state === "FAILED" || record.settlement) {
      return;
    }

    const reportHash =
      result.attestation?.reportHash ?? `task:${record.taskId}`;
    const receipt = await this.attestation.anchor(reportHash); // on-chain attestation

    const providerIds = new Set(
      record.spec.parties
        .filter((p) => p.role === "provider")
        .map((p) => p.participantId),
    );
    const providerShares = (result.contributions ?? []).filter((c) =>
      providerIds.has(c.participantId),
    );
    const shareSum = providerShares.reduce((s, c) => s + c.share, 0) || 1;

    const lines: SettlementLine[] = providerShares.map((c) => ({
      org: c.participantId,
      participantId: c.participantId,
      contribution: Math.round((c.share / shareSum) * 100),
      amount: Math.round((c.share / shareSum) * budget.amount),
    }));

    const summary: SettlementSummary = {
      id: `st-${record.taskId}`,
      taskId: record.taskId,
      taskRef: receipt.hash,
      consumerId: admitted.consumerId,
      currency: budget.currency,
      total: budget.amount,
      contributionTotal: lines.reduce((s, l) => s + l.contribution, 0),
      lines,
      txHash: receipt.txHash,
      block: receipt.block,
      at: new Date().toISOString(),
    };

    await this.settlement.record({
      id: summary.id,
      taskId: summary.taskId,
      taskRef: summary.taskRef,
      consumer: admitted.consumerId,
      consumerId: admitted.consumerId,
      currency: summary.currency,
      contributionTotal: summary.contributionTotal,
      total: summary.total,
      lines: summary.lines,
      hash: receipt.txHash,
      at: summary.at,
    });
    record.settlement = summary;
    this.logger.log(
      `settled task=${record.taskId} total=${budget.amount}${budget.currency} block=${receipt.block}`,
    );
  }

  list(): OrchestrationRecord[] {
    return this.fsm.list();
  }

  status(taskId: string): OrchestrationRecord {
    const record = this.fsm.get(taskId);
    if (!record) {
      throw new NotFoundException(
        `No SecretFlow orchestration for task ${taskId}`,
      );
    }
    return record;
  }

  async result(taskId: string): Promise<unknown> {
    const record = this.fsm.get(taskId);
    if (!record) {
      throw new NotFoundException(
        `No SecretFlow orchestration for task ${taskId}`,
      );
    }
    if (record.result) {
      return record.result;
    }
    // 控制面不再直接访问 agent（D1）：结果只能来自连接器回传的轮次。
    if (record.state === "FAILED") {
      throw new BadRequestException(record.error ?? "联邦训练任务失败");
    }
    throw new ServiceUnavailableException(
      `联邦训练任务尚未完成(state=${record.state})`,
    );
  }

  private parseAndValidate(input: OrchestrateInput): SecretFlowTaskSpec {
    let raw: unknown = input.spec;
    if (!raw && input.specYaml) {
      try {
        raw = yaml.load(input.specYaml);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(`Invalid YAML: ${message}`);
      }
    }
    if (!raw) {
      throw new BadRequestException("Provide a spec or specYaml");
    }
    if (!isSecretFlowTaskSpec(raw)) {
      throw new BadRequestException(
        "Invalid SecretFlowTaskSpec: requires parties, modalities, llmBackbone, peftStrategy, privacy, outputPolicy",
      );
    }
    // omop-data-source-access 4.3(D-CN-6):训练数据只由各院连接器按合约的数据产品投影提供,
    // 任务 spec 不得再指定院内目录——在控制面就拒,而不是等 agent 拒。
    const specRecord = raw as unknown as Record<string, unknown>;
    if (
      specRecord.dataPath !== undefined ||
      specRecord.data_path !== undefined
    ) {
      throw new BadRequestException(
        "dataPath 已废弃:训练数据由各院连接器按合约的数据产品提供,任务 spec 不得指定院内目录",
      );
    }
    return raw as SecretFlowTaskSpec;
  }

  /**
   * 每院每轮的训练任务入队（经连接器长轮询下发），等各院回传后做加权平均。
   * 控制面不再直接调用 agent（outbound-longpoll-agent-auth D1/D3）。
   */
  private orchestrateViaRounds(
    taskId: string,
    spec: SecretFlowTaskSpec,
    record: OrchestrationRecord,
    nodePlan: NodePlan[],
    _transpiledPayload: string,
    admitted: AdmittedContracts,
    budget: TaskBudget,
  ): OrchestrationRecord {
    const providers = spec.parties.filter((p) => p.role === "provider");
    this.fsm.transition(taskId, "TRAINING");
    void this.finishRoundBasedFedAvg(
      taskId,
      spec,
      providers,
      nodePlan,
      record,
      admitted,
      budget,
    ).catch((err) => {
      // 失败已写进 FSM;这里只兜底日志,避免未处理的 rejection。
      this.logger.error(
        `联邦训练轮次编排异常 task=${taskId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return record;
  }

  /**
   * 轮次制 FedAvg（design D3）：每轮为各院入队一个轮次任务并等待回传。
   * 某院本轮超时/失败 → 踢出本轮（补偿），下一轮仍可重新参与。
   */
  private async finishRoundBasedFedAvg(
    taskId: string,
    spec: SecretFlowTaskSpec,
    providers: Array<{ participantId: string }>,
    nodePlan: NodePlan[],
    record: OrchestrationRecord,
    admitted: AdmittedContracts,
    budget: TaskBudget,
  ): Promise<void> {
    const rounds = spec.epochs ?? 3;
    const specYaml = JSON.stringify(spec);
    let globalAdapter: AdapterState | null = null;
    const contributionWeight: Record<string, number> = {};
    const roundLosses: number[] = [];
    let initialLoss = 0;
    const contractFor = (participantId: string) => {
      const contract = admitted.contracts.find(
        (c) => c.providerId === participantId,
      );
      if (!contract) {
        throw new Error(`缺少 provider ${participantId} 的合约快照`);
      }
      return toConnectorContractPayload(contract);
    };

    try {
      for (let round = 0; round < rounds; round += 1) {
        const globalJson = globalAdapter ? encodeAdapter(globalAdapter) : "";
        const settled = await Promise.allSettled(
          providers.map((party) => {
            const subPlan = nodePlan.filter(
              (n) => n.participantId === party.participantId,
            );
            return this.rounds.enqueue({
              taskId,
              participantId: party.participantId,
              round,
              purpose: spec.purpose ?? "",
              specYaml,
              globalAdapterJson: globalJson,
              nodePlan: subPlan.length ? subPlan : nodePlan.slice(0, 1),
              contract: contractFor(party.participantId),
            });
          }),
        );

        // 本轮未在时限内回传的医院踢出本轮（下一轮重新参与）。
        const fulfilledProviders: string[] = [];
        settled.forEach((outcome, index) => {
          const party = providers[index];
          if (outcome.status === "fulfilled") {
            fulfilledProviders.push(party.participantId);
            return;
          }
          const reason =
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason);
          this.logger.warn(
            `第 ${round + 1} 轮 ${party.participantId} 未回传,本轮踢出: ${reason}`,
          );
          this.fsm.compensate(taskId, party.participantId, "round_timeout");
          this.events.broadcast({
            taskId,
            phase: "compensation",
            participantId: party.participantId,
            round,
            reason,
            state: this.fsm.get(taskId)?.state,
          });
        });

        const roundResults = settled
          .filter(
            (
              outcome,
            ): outcome is PromiseFulfilledResult<
              Awaited<ReturnType<FlRoundQueueService["enqueue"]>>
            > => outcome.status === "fulfilled",
          )
          .map((outcome, index) => ({
            participantId: fulfilledProviders[index],
            ...outcome.value,
          }));
        if (roundResults.length === 0) {
          throw new Error(`第 ${round + 1} 轮全部医院未回传,任务失败`);
        }

        const weighted = roundResults.map((r) => ({
          participantId: r.participantId,
          delta: decodeAdapter(r.adapterDeltaJson),
          weight: r.sampleCount,
          localLoss: r.localLoss,
        }));
        for (const res of roundResults) {
          contributionWeight[res.participantId] =
            (contributionWeight[res.participantId] ?? 0) + res.sampleCount;
        }

        const meanLoss =
          roundResults.reduce((s, r) => s + r.localLoss, 0) /
          Math.max(1, roundResults.length);
        if (round === 0) {
          initialLoss = meanLoss;
          this.events.broadcast({
            taskId,
            phase: "baseline",
            round,
            globalLoss: meanLoss,
            state: this.fsm.get(taskId)?.state,
          });
        }
        roundLosses.push(meanLoss);
        globalAdapter = applyFedAvgDeltas(globalAdapter, weighted);
        this.events.broadcast({
          taskId,
          phase: "round_complete",
          round,
          loss: meanLoss,
          globalLoss: meanLoss,
          participants: roundResults.map((r) => r.participantId),
          state: this.fsm.get(taskId)?.state,
        });
        this.logger.log(
          `task ${taskId} FedAvg round ${round + 1}/${rounds} meanLoss=${meanLoss.toFixed(4)}`,
        );
      }

      if (!globalAdapter) {
        throw new Error("FedAvg produced no global adapter");
      }

      record.result = await this.buildFedAvgMergedResult(
        taskId,
        admitted.consumerId,
        providers,
        globalAdapter,
        rounds,
        roundLosses,
        initialLoss,
        contributionWeight,
      );
      this.fsm.transition(taskId, "COMPLETED", "multi-connector FedAvg");
      this.events.broadcast({
        taskId,
        phase: "result",
        result: record.result,
        state: "COMPLETED",
      });
      this.events.broadcast({ taskId, phase: "done", state: "COMPLETED" });
      await this.settleCompletedTask(record, admitted, budget);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fsm.transition(taskId, "FAILED", message);
      record.error = message;
      this.events.broadcast({
        taskId,
        phase: "failed",
        reason: message,
        state: "FAILED",
      });
      this.logger.error(`联邦训练任务 ${taskId} 失败: ${message}`);
    }
  }

  private async buildFedAvgMergedResult(
    taskId: string,
    consumerId: string,
    providers: Array<{ participantId: string }>,
    globalAdapter: AdapterState,
    roundsCompleted: number,
    roundLosses: number[],
    initialLoss: number,
    contributionWeight: Record<string, number>,
  ): Promise<Record<string, unknown>> {
    const combinedHash = loraHashFromAdapter(globalAdapter);
    const trainLoss = roundLosses.at(-1) ?? initialLoss;
    const totalWeight = Object.values(contributionWeight).reduce(
      (a, b) => a + b,
      0,
    );

    let encryptedDeltaRef: string | undefined;
    let deliverableAvailable = false;
    try {
      const sealed = await this.loraDeliverable.sealAndStore({
        taskId,
        consumerId,
        adapter: globalAdapter,
        loraDeltaHash: combinedHash,
      });
      encryptedDeltaRef = sealed.encryptedDeltaRef;
      deliverableAvailable = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`LoRA seal skipped for ${taskId}: ${message}`);
    }

    return {
      taskId,
      state: "COMPLETED",
      roundsCompleted,
      loraDeltaHash: combinedHash,
      encryptedDeltaRef,
      deliverableAvailable,
      metrics: {
        trainLoss,
        initialLoss,
        lossReduction: initialLoss - trainLoss,
        partyCount: providers.length,
        federatedConnectors: providers.map((p) => p.participantId),
      },
      contributions: providers.map((p) => ({
        participantId: p.participantId,
        share:
          totalWeight > 0
            ? Math.round(
                ((contributionWeight[p.participantId] ?? 0) / totalWeight) *
                  1e6,
              ) / 1e6
            : 1 / Math.max(1, providers.length),
      })),
      privacySummary: {
        safeOutputOnly: true,
        multiConnector: true,
        connectorCount: providers.length,
        aggregationMode: "fedavg",
        demoStandInModel: true,
      },
      attestation: {
        reportHash: `ATT:${combinedHash.slice(5)}`,
        runtime: "torch+fedavg-coordinator",
      },
    };
  }

  async downloadLoraDeliverable(
    taskId: string,
    user: { role?: string; participantId?: string },
  ): Promise<Record<string, unknown>> {
    const record = this.fsm.get(taskId);
    if (!record || record.state !== "COMPLETED") {
      throw new NotFoundException(`Task ${taskId} is not completed`);
    }

    const deliverable = await this.loraDeliverable.require(taskId);
    const role = user.role ?? "";
    if (role === "operator") {
      // audit / ops
    } else if (role === "consumer") {
      const owns = await this.settlement.consumerOwnsTask(
        taskId,
        user.participantId ?? "",
      );
      if (!owns || deliverable.consumerId !== user.participantId) {
        throw new ForbiddenException(
          "No settlement authorization for this deliverable",
        );
      }
    } else {
      throw new ForbiddenException(
        "Only the paying consumer or operator may download LoRA deliverables",
      );
    }

    return {
      taskId: deliverable.taskId,
      filename: loraDeliverableFilename(taskId),
      format: deliverable.format,
      algorithm: deliverable.algorithm,
      encryptedDeltaRef: deliverable.encryptedDeltaRef,
      loraDeltaHash: deliverable.loraDeltaHash,
      sha256: deliverable.sha256,
      byteSize: deliverable.byteSize,
      sealedAt: deliverable.sealedAt,
      encryptedData: deliverable.encryptedData,
      encryptedDEK: deliverable.encryptedDEK,
      decryptionNote:
        "Decrypt with your institution SM2 private key (demo: pharma-demo key in API demo-consumer-keys.ts).",
    };
  }

  async verifyDemoLoraDeliverable(
    taskId: string,
    user: { role?: string; participantId?: string },
  ) {
    const record = this.fsm.get(taskId);
    if (!record || record.state !== "COMPLETED") {
      throw new NotFoundException(`Task ${taskId} is not completed`);
    }

    const deliverable = await this.loraDeliverable.require(taskId);
    const role = user.role ?? "";
    if (role === "operator") {
      // audit / ops
    } else if (role === "consumer") {
      const owns = await this.settlement.consumerOwnsTask(
        taskId,
        user.participantId ?? "",
      );
      if (!owns || deliverable.consumerId !== user.participantId) {
        throw new ForbiddenException(
          "No settlement authorization for this deliverable",
        );
      }
    } else {
      throw new ForbiddenException(
        "Only the paying consumer or operator may verify LoRA deliverables",
      );
    }

    const consumerId = deliverable.consumerId ?? "pharma-demo";
    const keyEntry = DEMO_CONSUMER_SM2_KEYS[consumerId];
    if (!keyEntry) {
      throw new BadRequestException(
        `No demo SM2 private key configured for consumer ${consumerId}`,
      );
    }

    const report = this.loraDeliverable.verifyDemo(
      deliverable,
      keyEntry.privateKey,
      deliverable.loraDeltaHash,
    );

    return {
      ...report,
      consumerId,
      demoKeyLabel: keyEntry.label,
      cliHint: `pnpm --filter @medtrust/api verify:lora -- lora-adapter-${taskId}.enc.json`,
    };
  }
}
