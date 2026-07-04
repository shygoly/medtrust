import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as yaml from 'js-yaml';
import { randomUUID } from 'crypto';
import {
  SecretFlowTaskSpec,
  isSecretFlowTaskSpec,
} from '../../compute-task/dto/secretflow-task-spec';
import { NodeCapabilityService } from './node-capability.service';
import { SecretFlowTranspilerService } from './transpiler.service';
import { OrchestratorFsmService } from './orchestrator-fsm.service';
import { AgentDispatchClient } from './agent-dispatch.client';
import { AgentLogBridge } from './agent-log-bridge.service';
import { SecretFlowAdmissionService, AdmittedContracts } from './secretflow-admission.service';
import { AttestationService } from '../digital-contract/attestation.service';
import { SettlementService } from '../settlement/settlement.service';
import { ComplianceService } from '../../capability/l2-compliance/compliance.service';
import { createHash } from 'crypto';
import { agentEndpointFor, isMultiConnectorFederation } from './agent-routing';
import type { AgentTaskResult } from './agent-dispatch.client';
import {
  NodeCapabilityProfile,
  NodePlan,
  OrchestrationRecord,
  SettlementLine,
  SettlementSummary,
} from './types';

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
  /** Connector-local Synthea/FHIR directory passed through to the agent spec. */
  dataPath?: string;
  /** 跨层组合 id;给定时触发 L2 合规闸门(与合约 PEP 并联)。 */
  compositionId?: string;
}

const DEFAULT_BUDGET: TaskBudget = { amount: 100, currency: 'CNY' };

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
    private readonly agent: AgentDispatchClient,
    private readonly bridge: AgentLogBridge,
    private readonly admission: SecretFlowAdmissionService,
    private readonly attestation: AttestationService,
    private readonly settlement: SettlementService,
    private readonly compliance: ComplianceService,
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

    const record = this.fsm.create(taskId, spec, [], '');
    record.contractRefs = admitted.contractHashes;

    // L2 合规闸门(与合约 PEP 并联, fail-closed): 仅 auto_approve 可自动派发。
    if (input.compositionId) {
      const verdict = await this.compliance.evaluate(input.compositionId);
      record.complianceEvaluationId = verdict.id;
      if (verdict.autoVerdict === 'block') {
        const why = verdict.blockingRulesMatched.join(', ') || '命中阻断规则';
        this.fsm.transition(taskId, 'FAILED', `L2 阻断: ${why}`);
        throw new ForbiddenException(`L2 合规阻断: ${why}`);
      }
      if (verdict.autoVerdict === 'manual_review') {
        this.fsm.transition(taskId, 'FAILED', 'L2 需人工审批');
        throw new ForbiddenException('L2 合规需人工审批,不可自动派发(走审批工作流后重试)');
      }
    }

    this.fsm.transition(taskId, 'VALIDATING');

    const nodePlan = this.capability.plan(spec, input.profiles ?? []);
    record.nodePlan = nodePlan;
    this.fsm.transition(taskId, 'PLANNING');

    const transpiledPayload = this.transpiler.transpile(taskId, spec, nodePlan);
    record.transpiledPayload = transpiledPayload;
    this.fsm.transition(taskId, 'DISPATCHING');

    if (isMultiConnectorFederation(spec)) {
      return this.orchestrateMulti(
        taskId,
        spec,
        record,
        nodePlan,
        transpiledPayload,
        admitted,
        budget,
      );
    }

    let dispatch;
    try {
      dispatch = await this.agent.submitFLTask({
        taskId,
        specYaml: JSON.stringify(spec),
        transpiledPayload,
        nodePlan,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fsm.transition(taskId, 'FAILED', `dispatch failed: ${message}`);
      record.error = message;
      throw new ServiceUnavailableException(
        `Local Data Agent unreachable at ${this.agent.endpoint()}: ${message}`,
      );
    }

    if (dispatch.ackStatus !== 'ACCEPTED') {
      this.fsm.transition(taskId, 'FAILED', `agent rejected: ${dispatch.message}`);
      throw new BadRequestException(`Agent rejected task: ${dispatch.message}`);
    }

    record.taskStreamUrl = dispatch.taskStreamUrl;
    this.fsm.transition(taskId, 'TRAINING');
    this.bridge.connect(taskId, dispatch.taskStreamUrl, (rec) => {
      void this.settleCompletedTask(rec, admitted, budget).catch((e) =>
        this.logger.error(
          `settlement failed for task ${taskId}: ${e instanceof Error ? e.message : e}`,
        ),
      );
    });

    return record;
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
      | { state?: string; attestation?: { reportHash?: string }; contributions?: Array<{ participantId: string; share: number }> }
      | undefined;
    if (!result || result.state === 'FAILED' || record.settlement) {
      return;
    }

    const reportHash = result.attestation?.reportHash ?? `task:${record.taskId}`;
    const receipt = this.attestation.anchor(reportHash); // on-chain attestation

    const providerIds = new Set(
      record.spec.parties.filter((p) => p.role === 'provider').map((p) => p.participantId),
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
      throw new NotFoundException(`No SecretFlow orchestration for task ${taskId}`);
    }
    return record;
  }

  async result(taskId: string): Promise<unknown> {
    const record = this.fsm.get(taskId);
    if (!record) {
      throw new NotFoundException(`No SecretFlow orchestration for task ${taskId}`);
    }
    if (record.result) {
      return record.result;
    }
    // Fall back to a direct gRPC pull if the stream result hasn't landed yet.
    return this.agent.getTaskResult(taskId);
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
      throw new BadRequestException('Provide a spec or specYaml');
    }
    if (!isSecretFlowTaskSpec(raw)) {
      throw new BadRequestException(
        'Invalid SecretFlowTaskSpec: requires parties, modalities, llmBackbone, peftStrategy, privacy, outputPolicy',
      );
    }
    const spec = raw as SecretFlowTaskSpec & { dataPath?: string };
    if (input.dataPath?.trim()) {
      spec.dataPath = input.dataPath.trim();
    }
    return spec;
  }

  /** Dispatch each provider to its own connector agent, then merge safe results. */
  private async orchestrateMulti(
    taskId: string,
    spec: SecretFlowTaskSpec,
    record: OrchestrationRecord,
    nodePlan: NodePlan[],
    transpiledPayload: string,
    admitted: AdmittedContracts,
    budget: TaskBudget,
  ): Promise<OrchestrationRecord> {
    const providers = spec.parties.filter((p) => p.role === 'provider');
    const dispatches: Array<{ participantId: string; streamUrl: string }> = [];

    for (const party of providers) {
      const endpoint = agentEndpointFor(party.participantId);
      const subId = `${taskId}::${party.participantId}`;
      const subSpec: SecretFlowTaskSpec = {
        ...spec,
        parties: spec.parties.filter(
          (p) =>
            p.participantId === party.participantId ||
            p.role === 'consumer' ||
            p.role === 'coordinator',
        ),
      };
      const subPlan = nodePlan.filter((n) => n.participantId === party.participantId);
      let dispatch;
      try {
        dispatch = await this.agent.submitFLTask({
          taskId: subId,
          specYaml: JSON.stringify(subSpec),
          transpiledPayload,
          nodePlan: subPlan.length ? subPlan : nodePlan.slice(0, 1),
          target: endpoint,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.fsm.transition(taskId, 'FAILED', `dispatch ${party.participantId} failed: ${message}`);
        record.error = message;
        throw new ServiceUnavailableException(
          `Agent unreachable for ${party.participantId} at ${endpoint}: ${message}`,
        );
      }
      if (dispatch.ackStatus !== 'ACCEPTED') {
        this.fsm.transition(taskId, 'FAILED', `agent rejected ${party.participantId}`);
        throw new BadRequestException(`Agent rejected ${party.participantId}: ${dispatch.message}`);
      }
      dispatches.push({ participantId: party.participantId, streamUrl: dispatch.taskStreamUrl });
      this.logger.log(`dispatched ${subId} -> ${endpoint}`);
    }

    record.taskStreamUrl = dispatches[0]?.streamUrl;
    this.fsm.transition(taskId, 'TRAINING');
    if (dispatches[0]) {
      this.bridge.connect(taskId, dispatches[0].streamUrl);
    }
    void this.finishMultiAgentTask(taskId, providers, record, admitted, budget);
    return record;
  }

  private async finishMultiAgentTask(
    taskId: string,
    providers: Array<{ participantId: string }>,
    record: OrchestrationRecord,
    admitted: AdmittedContracts,
    budget: TaskBudget,
  ): Promise<void> {
    const deadline = Date.now() + 120_000;
    try {
      let partials: AgentTaskResult[] | null = null;
      while (Date.now() < deadline) {
        const results = await Promise.all(
          providers.map((p) =>
            this.agent
              .getTaskResult(`${taskId}::${p.participantId}`, agentEndpointFor(p.participantId))
              .catch(() => null),
          ),
        );
        if (results.every((r) => r && r.state === 'COMPLETED')) {
          partials = results as AgentTaskResult[];
          break;
        }
        if (results.some((r) => r && r.state === 'FAILED')) {
          throw new Error('One or more connector agents failed');
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!partials) {
        throw new Error('Multi-connector federation timed out');
      }
      const merged = this.mergeAgentResults(taskId, providers, partials);
      record.result = merged;
      this.fsm.transition(taskId, 'COMPLETED', 'multi-connector merge');
      await this.settleCompletedTask(record, admitted, budget);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fsm.transition(taskId, 'FAILED', message);
      record.error = message;
      this.logger.error(`multi-agent task ${taskId} failed: ${message}`);
    }
  }

  private mergeAgentResults(
    taskId: string,
    providers: Array<{ participantId: string }>,
    partials: AgentTaskResult[],
  ): Record<string, unknown> {
    const share = 1 / Math.max(1, providers.length);
    const metricsList = partials.map((p) => {
      try {
        return JSON.parse(p.metricsJson || '{}') as Record<string, number>;
      } catch {
        return {};
      }
    });
    const avg = (key: string) =>
      metricsList.reduce((s, m) => s + (Number(m[key]) || 0), 0) / metricsList.length;

    const combinedHash =
      'LORA:' +
      createHash('sha256')
        .update(partials.map((p) => p.loraDeltaHash).join('|'))
        .digest('hex')
        .slice(0, 16);

    return {
      taskId,
      state: 'COMPLETED',
      roundsCompleted: Math.min(...partials.map((p) => p.roundsCompleted)),
      loraDeltaHash: combinedHash,
      metrics: {
        trainLoss: avg('trainLoss'),
        initialLoss: avg('initialLoss'),
        lossReduction: avg('lossReduction'),
        partyCount: providers.length,
        federatedConnectors: providers.map((p) => p.participantId),
      },
      contributions: providers.map((p) => ({ participantId: p.participantId, share })),
      privacySummary: {
        safeOutputOnly: true,
        multiConnector: true,
        connectorCount: providers.length,
      },
      attestation: {
        reportHash: `ATT:${combinedHash.slice(5)}`,
        runtime: partials.map((p) => p.runtime).join('+'),
      },
    };
  }
}
