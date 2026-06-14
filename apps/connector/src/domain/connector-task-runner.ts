import { Injectable } from '@nestjs/common';
import { PolicyEnforcementPoint } from './policy-enforcement';
import { RwsExecutor } from './rws-executor';
import { OutputGate } from './output-gate';
import { TaskScratch } from './task-scratch';
import { RetentionEnforcer } from './retention';
import { ContractView } from './contract-view';
import { HeSecureAggregator } from './he-aggregator';
import { RwsAnalysis, AggregateResult } from './types';

export interface ConnectorTask {
  taskId: string;
  purpose: string;
  analysis: RwsAnalysis;
}

// Ties the connector-side task lifecycle together: PEP gate → execute locally →
// enforce retention. The aggregate is returned only if the contract permits it.
@Injectable()
export class ConnectorTaskRunner {
  constructor(
    private readonly pep: PolicyEnforcementPoint,
    private readonly executor: RwsExecutor,
    private readonly gate: OutputGate,
    private readonly scratch: TaskScratch,
    private readonly retention: RetentionEnforcer,
  ) {}

  run(task: ConnectorTask, contract: ContractView): AggregateResult {
    // 4.4 — refuse anything not covered by an active, matching, unexpired contract
    this.pep.check({ taskId: task.taskId, purpose: task.purpose }, contract);

    // materialize per-task intermediate data locally (subject to retention)
    this.scratch.put(task.taskId, { stage: 'cohort-extract' });

    // analysis runs in-enclave (TEE); raw rows never leave it
    const raw = this.executor.run(task.analysis);

    // 5.3/5.4 — output gate: block row-level, suppress small cells
    const gated = this.gate.pass(raw);

    // 4.5 — apply retention (e.g. 阅后即焚 purges the intermediate data)
    this.retention.apply(contract, task.taskId);
    return gated;
  }

  // HE path: same gates, but the aggregate leaves the connector ENCRYPTED under
  // the consumer's public key. The control plane never sees this hospital's
  // values — not even the aggregate. Small-cell suppression is deferred to the
  // consumer after decrypting the merged result (the center can't see cells
  // anyway). Returns a serialized ciphertext.
  runEncrypted(
    task: ConnectorTask,
    contract: ContractView,
    he: HeSecureAggregator,
    consumerPublicKey: string,
    bucketSchema: string[],
  ): string {
    this.pep.check({ taskId: task.taskId, purpose: task.purpose }, contract);
    this.scratch.put(task.taskId, { stage: 'cohort-extract' });
    const raw = this.executor.run(task.analysis); // in-TEE
    const ciphertext = he.encryptAggregate(consumerPublicKey, raw.buckets, bucketSchema);
    this.retention.apply(contract, task.taskId);
    return ciphertext;
  }
}
