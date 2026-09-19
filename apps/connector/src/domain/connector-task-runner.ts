import { Injectable, Optional } from '@nestjs/common';
import { PolicyEnforcementPoint } from './policy-enforcement';
import { RwsExecutor } from './rws-executor';
import { OutputGate } from './output-gate';
import { TaskScratch } from './task-scratch';
import { RetentionEnforcer } from './retention';
import { ContractView, resolveContractMinCell } from './contract-view';
import { HeSecureAggregator } from './he-aggregator';
import { RwsAnalysis, AggregateResult } from './types';
import { SecretFlowTaskSpec } from './secretflow/secretflow-task-spec';
import { SecretFlowTaskRunResult, SecretFlowTaskRunner } from './secretflow/secretflow-task-runner';
import { FlPredictionTaskSpec } from './fl-prediction/fl-prediction-task-spec';
import { FlPartyTaskRunResult } from './fl-prediction/fl-task-runner';
import { DataProductLocalSource } from './data-product-local-source';
import { LocalStore } from './local-store';
import { TaskProgressReporter } from './task-progress-reporter';
import { AlgorithmValidationExecutor } from './algorithm-validation-executor';

export type ConnectorWorkloadType = 'rws' | 'secretflow' | 'federated_learning';

export interface ConnectorTask {
  taskId: string;
  purpose: string;
  workloadType?: ConnectorWorkloadType;
  analysis?: RwsAnalysis;
  secretflowSpec?: SecretFlowTaskSpec;
  flPredictionSpec?: FlPredictionTaskSpec;
  /** algorithm-sandbox:合约固定了模块时派发携带的模块引用。 */
  module?: { analysisType: string; sm3: string };
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
    @Optional() private readonly algorithmValidationExecutor?: AlgorithmValidationExecutor,
  ) {
    this.secretflowRunner = new SecretFlowTaskRunner(pep);
  }

  run(task: ConnectorTask & { workloadType?: 'rws' }, contract: ContractView): Promise<AggregateResult>;
  run(
    task: ConnectorTask & { workloadType: 'secretflow' },
    contract: ContractView,
  ): Promise<SecretFlowTaskRunResult>;
  run(
    task: ConnectorTask & { workloadType: 'federated_learning' },
    contract: ContractView,
  ): Promise<FlPartyTaskRunResult>;
  run(task: ConnectorTask, contract: ContractView): Promise<ConnectorRunResult>;
  async run(task: ConnectorTask, contract: ContractView): Promise<ConnectorRunResult> {
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
  async runEncrypted(
    task: ConnectorTask,
    contract: ContractView,
    he: HeSecureAggregator,
    consumerPublicKey: string,
    bucketSchema: string[],
  ): Promise<string> {
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
      {
        taskId: task.taskId,
        purpose: task.purpose,
        level: analysis.level,
        artifacts: analysis.allowedArtifacts ?? defaultArtifactsForAnalysis(analysis),
      },
      contract,
    );
    this.productSource?.ensureForContract(contract);
    this.scratch.put(task.taskId, { stage: 'cohort-extract' });
    const raw = await Promise.resolve(this.executor.run(analysis, task.taskId)); // in-TEE
    const ciphertext = he.encryptAggregate(consumerPublicKey, raw.buckets, bucketSchema);
    this.retention.apply(contract, task.taskId);
    return ciphertext;
  }

  /**
   * In-process trusted merge ONLY (PAPER P2 merge-then-gate).
   * Returns ungated aggregate that MUST NOT cross a network boundary;
   * caller must OutputGate.pass after merge. Audited as ungated-for-trusted-merge.
   */
  async runUngatedForTrustedMerge(
    task: ConnectorTask,
    contract: ContractView,
  ): Promise<AggregateResult> {
    return this.runRws(task, contract, { deferOutputGate: true });
  }

  private async runRws(
    task: ConnectorTask,
    contract: ContractView,
    opts?: { deferOutputGate?: boolean },
  ): Promise<AggregateResult> {
    const analysis = this.requireRwsAnalysis(task);

    // rws-algorithm-validation: L0 走独立执行器,产 2×2 混淆矩阵 + 准确性指标,
    // 不经 L1.5–L4 的 cohort/effect 路径,也不走中心 meta 合并 (D6 分列).
    if (analysis.type === 'algorithm-validation') {
      return this.runAlgorithmValidation(task, contract);
    }

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
      {
        taskId: task.taskId,
        purpose: task.purpose,
        level: analysis.level,
        artifacts: analysis.allowedArtifacts ?? defaultArtifactsForAnalysis(analysis),
        analysisType: analysis.type,
        moduleSm3: task.module?.sm3,
      },
      contract,
    );

    // Materialize local rows from catalog-declared path when contract carries dataProductId.
    this.productSource?.ensureForContract(contract);

    // materialize per-task intermediate data locally (subject to retention)
    this.scratch.put(task.taskId, { stage: 'cohort-extract' });

    // analysis runs in-enclave (TEE); raw rows never leave it
    void this.progress?.stage('compute', task.analysis?.type ?? 'rws');
    const outcome = await Promise.resolve(
      this.executor.runWithExecution(analysis, task.taskId, {
        pinnedModule: task.module,
      }),
    );
    const raw = outcome.aggregate;

    const minCell = resolveContractMinCell(contract);
    if (opts?.deferOutputGate) {
      void this.progress?.stage('retention', contract.retention);
      this.retention.apply(contract, task.taskId);
      return this.withExecution(raw, outcome.execution);
    }

    // 5.3/5.4 — output gate: block row-level, suppress small cells (threshold from contract)
    void this.progress?.stage('output-gate', `minCell=${minCell}`);
    const gated = this.gate.pass(raw, minCell, { contractId: contract.id });

    // 4.5 — apply retention (e.g. 阅后即焚 purges the intermediate data)
    void this.progress?.stage('retention', contract.retention);
    this.retention.apply(contract, task.taskId);
    // algorithm-sandbox D7:执行隔离标注写在输出闸门之后、规范化与算哈希之前,
    // 从而被结果 SM3 覆盖(篡改即验哈希失败)。
    return this.withExecution(gated, outcome.execution);
  }

  /** 把执行隔离标注写进聚合结果内部(受结果哈希保护)。 */
  private withExecution(
    aggregate: AggregateResult,
    execution: import('./types').ExecutionAnnotation,
  ): AggregateResult {
    return { ...aggregate, execution };
  }

  /**
   * L0 algorithm-validation path (rws-algorithm-validation). Same PEP →
   * execute → retention skeleton as runRws, but uses the
   * AlgorithmValidationExecutor and skips the L1.5/L2/L3 effect-estimate
   * routing. The returned AggregateResult carries `validationResult`.
   */
  private runAlgorithmValidation(task: ConnectorTask, contract: ContractView): AggregateResult {
    if (!this.algorithmValidationExecutor) {
      throw new Error('algorithm-validation 任务未注入 AlgorithmValidationExecutor');
    }
    const analysis = this.requireRwsAnalysis(task);
    // 4.4 — PEP check (L0 + validation_metrics authorization).
    void this.progress?.stage('pep-check', task.purpose);
    this.pep.check(
      {
        taskId: task.taskId,
        purpose: task.purpose,
        level: analysis.level ?? 'L0',
        artifacts: analysis.allowedArtifacts ?? ['validation_metrics'],
        analysisType: analysis.type,
        moduleSm3: task.module?.sm3,
      },
      contract,
    );
    this.productSource?.ensureForContract(contract);
    this.scratch.put(task.taskId, { stage: 'algorithm-validation' });
    void this.progress?.stage('compute', 'algorithm-validation');
    const minCell = resolveContractMinCell(contract);
    void this.progress?.stage('output-gate', `minCell=${minCell}`);
    const result = this.algorithmValidationExecutor.run(
      analysis,
      contract.providerId ?? 'local',
      task.taskId,
      minCell,
      contract.id,
    );
    void this.progress?.stage('retention', contract.retention);
    this.retention.apply(contract, task.taskId);
    // L0 目前只在连接器内置闭合语法求值器内执行(CTL-10),如实标注无隔离。
    return this.withExecution(result, { isolation: 'none' });
  }

  private requireRwsAnalysis(task: ConnectorTask): RwsAnalysis {
    if (!task.analysis) {
      throw new Error('RWS connector workload requires an analysis spec');
    }

    return task.analysis;
  }
}

/** Default egress artifacts when analysis.allowedArtifacts is omitted. */
function defaultArtifactsForAnalysis(analysis: RwsAnalysis): import('./types').RwsArtifactKind[] {
  switch (analysis.type) {
    case 'algorithm-validation':
      return ['validation_metrics'];
    case 'comparative-effect':
      return ['effect_estimate'];
    case 'causal-psm':
      return ['effect_estimate'];
    case 'causal-survival':
      return ['hazard_ratio', 'km_curve'];
    case 'disproportionality':
      return ['disproportionality'];
    case 'adverse-event-signal':
      return ['adverse_event_signal'];
    case 'condition-prevalence':
      return ['condition_prevalence'];
    case 'cohort-count':
      return ['cohort_count'];
    default:
      return analysis.allowedArtifacts ?? ['cohort_count', 'aggregate_metrics'];
  }
}
