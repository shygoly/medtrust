import { Injectable, Optional } from '@nestjs/common';
import { PolicyEnforcementPoint } from './policy-enforcement';
import { RwsExecutor } from './rws-executor';
import { OutputGate } from './output-gate';
import { TaskScratch } from './task-scratch';
import { RetentionEnforcer } from './retention';
import { ContractView } from './contract-view';
import { HeSecureAggregator } from './he-aggregator';
import { RwsAnalysis, AggregateResult } from './types';
import { SecretFlowTaskSpec } from './secretflow/secretflow-task-spec';
import { SecretFlowTaskRunResult, SecretFlowTaskRunner } from './secretflow/secretflow-task-runner';
import { DataProductLocalSource } from './data-product-local-source';
import { TaskProgressReporter } from './task-progress-reporter';

export type ConnectorWorkloadType = 'rws' | 'secretflow';

export interface ConnectorTask {
  taskId: string;
  purpose: string;
  workloadType?: ConnectorWorkloadType;
  analysis?: RwsAnalysis;
  secretflowSpec?: SecretFlowTaskSpec;
}

export type ConnectorRunResult = AggregateResult | SecretFlowTaskRunResult;

// Ties the connector-side task lifecycle together: PEP gate → execute locally →
// enforce retention. The aggregate is returned only if the contract permits it.
@Injectable()
export class ConnectorTaskRunner {
  private readonly secretflowRunner: SecretFlowTaskRunner;

  constructor(
    private readonly pep: PolicyEnforcementPoint,
    private readonly executor: RwsExecutor,
    private readonly gate: OutputGate,
    private readonly scratch: TaskScratch,
    private readonly retention: RetentionEnforcer,
    @Optional() private readonly productSource?: DataProductLocalSource,
    @Optional() private readonly progress?: TaskProgressReporter,
  ) {
    this.secretflowRunner = new SecretFlowTaskRunner(pep);
  }

  run(task: ConnectorTask & { workloadType?: 'rws' }, contract: ContractView): AggregateResult;
  run(
    task: ConnectorTask & { workloadType: 'secretflow' },
    contract: ContractView,
  ): SecretFlowTaskRunResult;
  run(task: ConnectorTask, contract: ContractView): ConnectorRunResult;
  run(task: ConnectorTask, contract: ContractView): ConnectorRunResult {
    const workloadType = task.workloadType ?? 'rws';

    if (workloadType === 'rws') {
      return this.runRws(task, contract);
    }

    if (workloadType === 'secretflow') {
      return this.secretflowRunner.run(
        task.taskId,
        task.purpose,
        task.secretflowSpec,
        contract,
      );
    }

    throw new Error(`Unsupported connector workload type: ${workloadType}`);
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
    const workloadType = task.workloadType ?? 'rws';
    if (workloadType !== 'rws') {
      throw new Error(
        `Connector workload ${workloadType} does not support encrypted RWS aggregation`,
      );
    }

    const analysis = this.requireRwsAnalysis(task);

    this.pep.check({ taskId: task.taskId, purpose: task.purpose }, contract);
    this.productSource?.ensureForContract(contract);
    this.scratch.put(task.taskId, { stage: 'cohort-extract' });
    const raw = this.executor.run(analysis); // in-TEE
    const ciphertext = he.encryptAggregate(consumerPublicKey, raw.buckets, bucketSchema);
    this.retention.apply(contract, task.taskId);
    return ciphertext;
  }

  private runRws(task: ConnectorTask, contract: ContractView): AggregateResult {
    const analysis = this.requireRwsAnalysis(task);

    // 4.4 — refuse anything not covered by an active, matching, unexpired contract
    void this.progress?.stage('pep-check', task.purpose);
    this.pep.check({ taskId: task.taskId, purpose: task.purpose }, contract);

    // Materialize local rows from catalog-declared path when contract carries dataProductId.
    this.productSource?.ensureForContract(contract);

    // materialize per-task intermediate data locally (subject to retention)
    this.scratch.put(task.taskId, { stage: 'cohort-extract' });

    // analysis runs in-enclave (TEE); raw rows never leave it
    void this.progress?.stage('compute', task.analysis?.type ?? 'rws');
    const raw = this.executor.run(analysis);

    // 5.3/5.4 — output gate: block row-level, suppress small cells
    void this.progress?.stage('output-gate');
    const gated = this.gate.pass(raw);

    // 4.5 — apply retention (e.g. 阅后即焚 purges the intermediate data)
    void this.progress?.stage('retention', contract.retention);
    this.retention.apply(contract, task.taskId);
    return gated;
  }

  private requireRwsAnalysis(task: ConnectorTask): RwsAnalysis {
    if (!task.analysis) {
      throw new Error('RWS connector workload requires an analysis spec');
    }

    return task.analysis;
  }
}
