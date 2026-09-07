import { Injectable } from '@nestjs/common';
import { ConnectorTaskRunner } from './connector-task-runner';
import { ContractView, resolveContractMinCell } from './contract-view';
import { AuditService } from './audit';
import { HeSecureAggregator } from './he-aggregator';
import { SettlementService, SettlementRecord, ContributionInput, Pricing } from './settlement';
import { RwsAnalysis, AggregateResult } from './types';
import { sm3Fingerprint } from './sm3';
import { OutputGate, DEFAULT_MIN_CELL } from './output-gate';

// A hospital participant: its connector's task runner (PEP→TEE→gate→retention).
export interface HospitalNode {
  id: string;
  org: string;
  runner: ConnectorTaskRunner;
}

export interface RwsTaskRequest {
  taskId: string;
  purpose: string;
  analysis: RwsAnalysis;
  initiator: string; // pharma org
}

// On-chain task attestation — hashes/metadata only, never medical data (6.4).
export interface TaskAttestation {
  taskHash: string;
  participants: string[];
  policyHashes: string[];
  inputFingerprint: string;
  outputHash: string;
  timestamp: string;
}

export interface OrchestrationResult {
  merged: AggregateResult;
  perNode: { org: string; aggregate: AggregateResult }[];
  dispatched: string[];
  skipped: { org: string; reason: string }[];
  attestation: TaskAttestation;
  settlement?: SettlementRecord; // value-settlement: 按贡献分账(合约含计价时)
}

export interface EncryptedOrchestrationResult {
  mergedCiphertext: string; // only the consumer can decrypt this
  bucketSchema: string[];
  dispatched: string[];
  skipped: { org: string; reason: string }[];
  attestation: TaskAttestation;
}

// 端到端 RWS 编排(控制面侧职责)。校验每个目标的数字合约,只向有生效合约的
// 连接器下发;连接器在本地 TEE 执行并经输出闸门回传聚合;最后跨域存证上链。
@Injectable()
export class RwsOrchestrator {
  constructor(
    private readonly audit: AuditService,
    private readonly settlement: SettlementService = new SettlementService(),
  ) {}

  async run(req: RwsTaskRequest, targets: HospitalNode[], contracts: Map<string, ContractView>): Promise<OrchestrationResult> {
    return this.runInternal(req, targets, contracts, { mergeThenGate: false });
  }

  /**
   * P2 / PAPER §3.3 — merge-then-gate (in-process trusted federation only).
   * Each site returns ungated aggregates that MUST NOT egress; orchestrator merges
   * then applies OutputGate once. Contrast with default gate-then-merge in run().
   */
  async runMergeThenGate(
    req: RwsTaskRequest,
    targets: HospitalNode[],
    contracts: Map<string, ContractView>,
    gate: OutputGate,
  ): Promise<OrchestrationResult> {
    return this.runInternal(req, targets, contracts, { mergeThenGate: true, gate });
  }

  private async runInternal(
    req: RwsTaskRequest,
    targets: HospitalNode[],
    contracts: Map<string, ContractView>,
    opts: { mergeThenGate: boolean; gate?: OutputGate },
  ): Promise<OrchestrationResult> {
    const dispatched: string[] = [];
    const skipped: { org: string; reason: string }[] = [];
    const perNode: { org: string; aggregate: AggregateResult }[] = [];
    const policyHashes: string[] = [];
    const contributions: ContributionInput[] = [];
    let pricing: Pricing | undefined;
    let minCell = DEFAULT_MIN_CELL;

    for (const node of targets) {
      const contract = contracts.get(node.id);
      const status = this.effectiveStatus(contract);
      if (status !== 'active') {
        skipped.push({ org: node.org, reason: contract ? `合约${status}` : '无生效合约' });
        this.audit.record({ action: 'not-dispatched', actor: node.org, allowed: false, detail: `${status}` });
        continue;
      }
      const task = {
        taskId: req.taskId,
        purpose: req.purpose,
        workloadType: 'rws' as const,
        analysis: req.analysis,
      };
      const aggregate = opts.mergeThenGate
        ? await node.runner.runUngatedForTrustedMerge(task, contract!)
        : await node.runner.run(task, contract!);
      perNode.push({ org: node.org, aggregate });
      dispatched.push(node.org);
      policyHashes.push(this.hash('policy:' + contract!.id));
      contributions.push({ org: node.org, participantId: node.id, contribution: aggregate.cohortSize });
      if (!pricing && contract!.pricing) pricing = contract!.pricing;
      minCell = Math.max(minCell, resolveContractMinCell(contract));
    }

    let merged = this.merge(req.analysis, perNode.map((p) => p.aggregate));
    if (opts.mergeThenGate) {
      if (!opts.gate) throw new Error('runMergeThenGate requires OutputGate');
      this.audit.record({
        action: 'merge-then-gate',
        actor: 'rws-orchestrator',
        allowed: true,
        detail: `merged ${dispatched.length} ungated aggregates then OutputGate minCell=${minCell}`,
      });
      merged = opts.gate.pass(merged, minCell, { contractId: `merge:${req.taskId}` });
    }

    const attestation = this.attest(req, dispatched, policyHashes, merged);
    const settlement = pricing
      ? this.settlement.settle(req.taskId, req.initiator, pricing, contributions, attestation.taskHash)
      : undefined;
    return { merged, perNode, dispatched, skipped, attestation, settlement };
  }

  // HE path: hospitals return ENCRYPTED aggregates; the control plane sums the
  // ciphertexts blind (no secret key) and never sees any hospital's values —
  // not even the aggregate. Only the consumer (药企) can decrypt the merged
  // result, then applies small-cell suppression on the merged total.
  async runEncrypted(
    req: RwsTaskRequest,
    targets: HospitalNode[],
    contracts: Map<string, ContractView>,
    he: HeSecureAggregator,
    consumerPublicKey: string,
    bucketSchema: string[],
  ): Promise<EncryptedOrchestrationResult> {
    const dispatched: string[] = [];
    const skipped: { org: string; reason: string }[] = [];
    const ciphertexts: string[] = [];
    const policyHashes: string[] = [];

    for (const node of targets) {
      const contract = contracts.get(node.id);
      const status = this.effectiveStatus(contract);
      if (status !== 'active') {
        skipped.push({ org: node.org, reason: contract ? `合约${status}` : '无生效合约' });
        this.audit.record({ action: 'not-dispatched', actor: node.org, allowed: false, detail: status });
        continue;
      }
      ciphertexts.push(
        await node.runner.runEncrypted(
          { taskId: req.taskId, purpose: req.purpose, workloadType: 'rws', analysis: req.analysis },
          contract!,
          he,
          consumerPublicKey,
          bucketSchema,
        ),
      );
      dispatched.push(node.org);
      policyHashes.push(this.hash('policy:' + contract!.id));
    }

    const mergedCiphertext = he.sum(ciphertexts); // blind sum, no secret key
    const attestation: TaskAttestation = {
      taskHash: this.hash(`${req.taskId}:${req.purpose}`),
      participants: dispatched,
      policyHashes,
      inputFingerprint: this.hash(`input:${req.taskId}:${dispatched.join(',')}`),
      outputHash: this.hash(mergedCiphertext),
      timestamp: new Date().toISOString(),
    };
    return { mergedCiphertext, bucketSchema, dispatched, skipped, attestation };
  }

  private effectiveStatus(c?: ContractView): string {
    if (!c) return 'absent';
    if (c.status !== 'active') return c.status;
    if (new Date(c.validUntil).getTime() < Date.now()) return 'expired';
    return 'active';
  }

  private merge(analysis: RwsAnalysis, aggregates: AggregateResult[]): AggregateResult {
    const counts = new Map<string, number>();
    let cohortSize = 0;
    for (const a of aggregates) {
      cohortSize += a.cohortSize;
      for (const b of a.buckets) counts.set(b.key, (counts.get(b.key) ?? 0) + b.count);
    }
    const n = cohortSize || 1;
    return {
      analysisType: aggregates[0]?.analysisType ?? analysis.type,
      cohortSize,
      buckets: [...counts.entries()]
        .map(([key, count]) => ({ key, count, rate: +(count / n).toFixed(4) }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // 6.4 — anchor task/participants/policy/input/output digests. No plaintext data.
  private attest(req: RwsTaskRequest, participants: string[], policyHashes: string[], merged: AggregateResult): TaskAttestation {
    return {
      taskHash: this.hash(`${req.taskId}:${req.purpose}`),
      participants,
      policyHashes,
      inputFingerprint: this.hash(`input:${req.taskId}:${participants.join(',')}`),
      outputHash: this.hash(JSON.stringify(merged)),
      timestamp: new Date().toISOString(),
    };
  }

  // 真国密 SM3(不再以 sha256 冒充)。与控制面 GMCryptoService.sm3Hash 口径一致。
  private hash(s: string): string {
    return sm3Fingerprint(s);
  }
}
