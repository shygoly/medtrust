import { Injectable, Optional } from '@nestjs/common';
import { ContractView } from '../contract-view';
import { DataProductLocalSource } from '../data-product-local-source';
import { PolicyEnforcementPoint } from '../policy-enforcement';
import { isFlPredictionTaskSpec, FlParty, FlPredictionTaskSpec } from './fl-prediction-task-spec';
import { createFlRuntimeAdapter } from './http-fl-adapter';
import { HttpFlAdapter } from './http-fl-adapter';
import { FlPartyRunResult } from './fl-run-result';
import { FlRuntimeAdapter, FlRuntimeContext } from './fl-runtime-adapter';
import { materializeFlTabularRows } from './fl-tabular-materializer';
import { assertDpCompliance, finalizePartyResultWithDp } from './fl-dp-gate';
import { FlPredictionArtifactKind } from './fl-prediction-task-spec';
import { trainLocalLogisticParty } from './local-logistic';
import { assertSafeFlPartyRunResult } from './fl-output-guard';
import { RwsArtifactKind } from '../types';

export type FlPartyTaskRunResult = FlPartyRunResult & { workloadType: 'federated_learning' };

@Injectable()
export class FlTaskRunner {
  private readonly participantId: string;
  private readonly flRunnerAdapter: FlRuntimeAdapter;

  constructor(
    private readonly pep: PolicyEnforcementPoint,
    @Optional() adapter?: FlRuntimeAdapter,
    @Optional() private readonly productSource?: DataProductLocalSource,
    @Optional() participantId?: string,
  ) {
    this.flRunnerAdapter = adapter ?? createFlRuntimeAdapter();
    this.participantId = participantId ?? process.env.CONNECTOR_PARTICIPANT_ID ?? '';
  }

  async run(
    taskId: string,
    purpose: string,
    flPredictionSpec: unknown,
    contract: ContractView,
  ): Promise<FlPartyTaskRunResult> {
    if (!isFlPredictionTaskSpec(flPredictionSpec)) {
      throw new Error('FL prediction workload requires a valid flPredictionSpec');
    }

    const spec = flPredictionSpec;
    const localParty = this.resolveLocalProviderParty(spec);

    // 数据来源由合约决定：spec 里本院 party 声明的数据产品必须恰为合约授权的那个（PEP 拒绝并留痕）。
    this.pep.check(
      {
        taskId,
        purpose,
        level: 'L4',
        artifacts: mapFlArtifactsForPep(spec.outputPolicy.allowedArtifacts),
        dataProductId: localParty.dataProductId,
      },
      contract,
    );
    const tabularRows = this.materializeTabularRows(taskId, spec, contract);

    const environment =
      this.flRunnerAdapter instanceof HttpFlAdapter
        ? await this.flRunnerAdapter.validateEnvironmentAsync()
        : this.flRunnerAdapter.validateEnvironment();
    if (!environment.ready) {
      throw new Error(`FL prediction runtime unavailable: ${environment.details ?? 'unknown'}`);
    }

    // In-connector FedAvg logistic (pancreatitis demo) — no ML sidecar required.
    if (spec.modelType === 'logistic_regression' && spec.aggregation === 'fedavg') {
      const trained = trainLocalLogisticParty({
        taskId,
        participantId: localParty.participantId,
        rows: tabularRows,
        spec,
      });
      const allowWeights = spec.outputPolicy.allowedArtifacts.includes('model_weights');
      const raw = assertSafeFlPartyRunResult({
        taskId,
        participantId: localParty.participantId,
        roundsCompleted: spec.rounds,
        sampleCount: trained.sampleCount,
        localMetrics: trained.localMetrics,
        localModelHash: trained.localModelHash,
        trainingMode: trained.trainingMode,
        modelParams: allowWeights ? trained.modelParams : undefined,
      });
      const finalized = finalizePartyResultWithDp(spec, raw);
      assertDpCompliance(spec, finalized);
      return { ...finalized, workloadType: 'federated_learning' };
    }

    const runtimeContext: FlRuntimeContext = {
      taskId,
      spec,
      participantId: localParty.participantId,
      sampleCount: tabularRows.length,
      tabularRows,
    };
    const prepared = this.flRunnerAdapter.prepare(runtimeContext);

    try {
      const result = await Promise.resolve(
        this.flRunnerAdapter.run(prepared, spec, runtimeContext),
      );
      const finalized = finalizePartyResultWithDp(spec, result);
      assertDpCompliance(spec, finalized);
      return { ...finalized, workloadType: 'federated_learning' };
    } finally {
      this.flRunnerAdapter.cleanup(prepared);
    }
  }

  private resolveLocalProviderParty(spec: FlPredictionTaskSpec): FlParty {
    if (!this.participantId) {
      throw new Error('CONNECTOR_PARTICIPANT_ID is required for FL prediction workload');
    }

    const party = spec.parties.find(
      (p) => p.participantId === this.participantId && p.role === 'provider',
    );
    if (!party) {
      throw new Error(
        `FL prediction spec has no provider party for participant ${this.participantId}`,
      );
    }
    return party;
  }

  /**
   * 训练行只从**合约授权的数据产品**来：按合约取数、就地物化成表格行，不读也不替换
   * 共享的 LocalStore（执行队列有并发，别的任务可能正在用它）。CDM 产品在这里即拒。
   */
  private materializeTabularRows(
    taskId: string,
    spec: FlPredictionTaskSpec,
    contract: ContractView,
  ): Record<string, unknown>[] {
    if (!this.productSource) {
      throw new Error('连接器未装配数据产品源：FL 预测无从按合约取数（fail-closed）');
    }
    const rows = this.productSource.withProductRecords(
      contract,
      `fl-prediction:${taskId}`,
      (records) => materializeFlTabularRows(records, spec),
    );
    if (rows.length === 0) {
      throw new Error(`数据产品 ${contract.dataProductId} 没有可用于训练的记录`);
    }
    return rows;
  }
}

function mapFlArtifactsForPep(allowed: FlPredictionArtifactKind[]): RwsArtifactKind[] {
  const out = new Set<RwsArtifactKind>();
  for (const a of allowed) {
    if (a === 'model_hash' || a === 'model_weights') out.add('model_hash');
    if (
      a === 'aggregate_metrics' ||
      a === 'auc' ||
      a === 'f1' ||
      a === 'precision' ||
      a === 'recall'
    ) {
      out.add('aggregate_metrics');
    }
  }
  return [...out];
}
