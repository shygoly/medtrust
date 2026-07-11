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
import { FlPredictionTaskSpec } from './fl-prediction/fl-prediction-task-spec';
import { FlPartyTaskRunResult } from './fl-prediction/fl-task-runner';
import { DataProductLocalSource } from './data-product-local-source';
import { LocalStore } from './local-store';
import { TaskProgressReporter } from './task-progress-reporter';

export type ConnectorWorkloadType = 'rws' | 'secretflow' | 'federated_learning';

export interface ConnectorTask {
  taskId: string;
  purpose: string;
  workloadType?: ConnectorWorkloadType;
  analysis?: RwsAnalysis;
  secretflowSpec?: SecretFlowTaskSpec;
  flPredictionSpec?: FlPredictionTaskSpec;
}

export type ConnectorRunResult = AggregateResult | SecretFlowTaskRunResult | FlPartyTaskRunResult;

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
    @Optional() private readonly store?: LocalStore,
    @Optional() private readonly progress?: TaskProgressReporter,
  ) {
    this.secretflowRunner = new SecretFlowTaskRunner(pep);
  }

  run(task: ConnectorTask & { workloadType?: 'rws' }, contract: ContractView): AggregateResult;
  run(
    task: ConnectorTask & { workloadType: 'secretflow' },
    contract: ContractView,
  ): SecretFlowTaskRunResult;
  run(
    task: ConnectorTask & { workloadType: 'federated_learning' },
    contract: ContractView,
  ): FlPartyTaskRunResult;
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

    if (workloadType === 'federated_learning') {
      throw new Error(
        'FL prediction workload is async — use FlTaskRunner.run() from ConnectorWorkerService',
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

    const level = analysis.level ?? 'L1';
    if (level !== 'L1') {
      throw new Error(`RWS 分析层级 ${level} 尚未实现(rws-analytics-ladder 组2–5)`);
    }
    this.pep.check(
      { taskId: task.taskId, purpose: task.purpose, level: analysis.level, artifacts: analysis.allowedArtifacts },
      contract,
    );
    this.productSource?.ensureForContract(contract);
    this.scratch.put(task.taskId, { stage: 'cohort-extract' });
    const raw = this.executor.run(analysis, task.taskId); // in-TEE
    const ciphertext = he.encryptAggregate(consumerPublicKey, raw.buckets, bucketSchema);
    this.retention.apply(contract, task.taskId);
    return ciphertext;
  }

  private runRws(task: ConnectorTask, contract: ContractView): AggregateResult {
    const analysis = this.requireRwsAnalysis(task);

    // rws-analytics-ladder: L1 + L1.5 + L2 + L3(causal) 已实现;L4 在组6.
    const level = analysis.level ?? 'L1';
    if (level === 'L2' && analysis.type !== 'comparative-effect') {
      throw new Error(`L2 比较任务须使用 analysis.type=comparative-effect,收到 ${analysis.type}`);
    }
    if (
      level === 'L3' &&
      analysis.type !== 'causal-psm' &&
      analysis.type !== 'causal-survival'
    ) {
      throw new Error(
        `L3 因果任务须使用 analysis.type=causal-psm 或 causal-survival,收到 ${analysis.type}`,
      );
    }
    if (level === 'L4') {
      throw new Error(
        'L4 预测建模须走 federated_learning 轨道(fl-prediction),不可经 RWS 同步路径',
      );
    }
    if (level !== 'L1' && level !== 'L1.5' && level !== 'L2' && level !== 'L3') {
      throw new Error(`RWS 分析层级 ${level} 尚未实现,拒绝执行`);
    }

    // 4.4 — refuse anything not covered by an active, matching, unexpired contract
    void this.progress?.stage('pep-check', task.purpose);
    this.pep.check(
      { taskId: task.taskId, purpose: task.purpose, level: analysis.level, artifacts: analysis.allowedArtifacts },
      contract,
    );

    // Materialize local rows from catalog-declared path when contract carries dataProductId.
    this.productSource?.ensureForContract(contract);

    // materialize per-task intermediate data locally (subject to retention)
    this.scratch.put(task.taskId, { stage: 'cohort-extract' });

    // analysis runs in-enclave (TEE); raw rows never leave it
    void this.progress?.stage('compute', task.analysis?.type ?? 'rws');
    const raw = this.executor.run(analysis, task.taskId);

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
