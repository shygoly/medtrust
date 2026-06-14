import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ConnectorTaskRunner } from './connector-task-runner';
import { ContractView } from './contract-view';
import { AuditService } from './audit';
import { HeSecureAggregator } from './he-aggregator';
import { RwsAnalysis, AggregateResult } from './types';

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
  constructor(private readonly audit: AuditService) {}

  run(req: RwsTaskRequest, targets: HospitalNode[], contracts: Map<string, ContractView>): OrchestrationResult {
    const dispatched: string[] = [];
    const skipped: { org: string; reason: string }[] = [];
    const perNode: { org: string; aggregate: AggregateResult }[] = [];
    const policyHashes: string[] = [];

    for (const node of targets) {
      const contract = contracts.get(node.id);
      const status = this.effectiveStatus(contract);
      if (status !== 'active') {
        // 6.2 — no effective contract → do NOT dispatch to this target
        skipped.push({ org: node.org, reason: contract ? `合约${status}` : '无生效合约' });
        this.audit.record({ action: 'not-dispatched', actor: node.org, allowed: false, detail: `${status}` });
        continue;
      }
      // 6.3 — dispatch; the connector runs PEP + TEE + output gate locally and
      // returns ONLY the gated aggregate.
      const aggregate = node.runner.run(
        { taskId: req.taskId, purpose: req.purpose, analysis: req.analysis },
        contract!,
      );
      perNode.push({ org: node.org, aggregate });
      dispatched.push(node.org);
      policyHashes.push(this.hash('policy:' + contract!.id));
    }

    const merged = this.merge(req.analysis, perNode.map((p) => p.aggregate));
    const attestation = this.attest(req, dispatched, policyHashes, merged);
    return { merged, perNode, dispatched, skipped, attestation };
  }

  // HE path: hospitals return ENCRYPTED aggregates; the control plane sums the
  // ciphertexts blind (no secret key) and never sees any hospital's values —
  // not even the aggregate. Only the consumer (药企) can decrypt the merged
  // result, then applies small-cell suppression on the merged total.
  runEncrypted(
    req: RwsTaskRequest,
    targets: HospitalNode[],
    contracts: Map<string, ContractView>,
    he: HeSecureAggregator,
    consumerPublicKey: string,
    bucketSchema: string[],
  ): EncryptedOrchestrationResult {
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
        node.runner.runEncrypted(
          { taskId: req.taskId, purpose: req.purpose, analysis: req.analysis },
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

  // SM3 stand-in (SHA-256). Production uses GMCryptoService.sm3Hash on the control plane.
  private hash(s: string): string {
    return 'SM3:' + createHash('sha256').update(s).digest('hex').slice(0, 16);
  }
}
