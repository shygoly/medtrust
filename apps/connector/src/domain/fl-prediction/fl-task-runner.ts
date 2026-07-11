import { Injectable, Optional } from '@nestjs/common';
import { ContractView } from '../contract-view';
import { DataProductLocalSource } from '../data-product-local-source';
import { LocalStore } from '../local-store';
import { PolicyEnforcementPoint } from '../policy-enforcement';
import { isFlPredictionTaskSpec, FlParty, FlPredictionTaskSpec } from './fl-prediction-task-spec';
import { createFlRuntimeAdapter } from './http-fl-adapter';
import { HttpFlAdapter } from './http-fl-adapter';
import { FlPartyRunResult } from './fl-run-result';
import { FlRuntimeAdapter, FlRuntimeContext } from './fl-runtime-adapter';
import { materializeFlTabularRows } from './fl-tabular-materializer';
import { assertDpCompliance, finalizePartyResultWithDp } from './fl-dp-gate';
import { FlPredictionArtifactKind } from './fl-prediction-task-spec';
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
    @Optional() private readonly store?: LocalStore,
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

    this.pep.check(
      {
        taskId,
        purpose,
        level: 'L4',
        artifacts: mapFlArtifactsForPep(spec.outputPolicy.allowedArtifacts),
      },
      contract,
    );
    this.materializeLocalData(localParty, contract);

    const environment =
      this.flRunnerAdapter instanceof HttpFlAdapter
        ? await this.flRunnerAdapter.validateEnvironmentAsync()
        : this.flRunnerAdapter.validateEnvironment();
    if (!environment.ready) {
      throw new Error(`FL prediction runtime unavailable: ${environment.details ?? 'unknown'}`);
    }

    const tabularRows = this.buildTabularRows(spec);
    const cohortSize = tabularRows.length || this.store?.count() || 0;
    const runtimeContext: FlRuntimeContext = {
      taskId,
      spec,
      participantId: localParty.participantId,
      sampleCount: cohortSize > 0 ? cohortSize : 40,
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

  private materializeLocalData(party: FlParty, contract: ContractView): void {
    if (!this.productSource) {
      return;
    }

    const contractWithProduct: ContractView =
      contract.dataProductId === party.dataProductId
        ? contract
        : { ...contract, dataProductId: party.dataProductId };

    this.productSource.ensureForContract(contractWithProduct);
  }

  private buildTabularRows(spec: FlPredictionTaskSpec): Record<string, unknown>[] {
    if (!this.store) {
      return [];
    }
    return this.store.aggregateInternal(
      { origin: 'internal', actor: 'fl-tabular-materializer' },
      (rows) => materializeFlTabularRows(rows, spec),
    );
  }
}

function mapFlArtifactsForPep(allowed: FlPredictionArtifactKind[]): RwsArtifactKind[] {
  const out = new Set<RwsArtifactKind>();
  for (const a of allowed) {
    if (a === 'model_hash') out.add('model_hash');
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
