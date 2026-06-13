import { Injectable } from '@nestjs/common';
import { LocalStore } from './local-store';
import { Deidentifier } from './deidentifier';
import { SoftwareTee } from './tee';
import { RwsAnalysis, AggregateResult, InternalRecord } from './types';

// Runs an RWS analysis over the connector-local rows and returns ONLY an
// aggregate. The analysis runs INSIDE the TEE: the rows are sealed into the
// enclave and the compute happens over decrypted data in-enclave (5.2); the
// raw rows never leave it. The returned aggregate is still raw — the output
// gate (5.3/5.4) is applied downstream by the task runner.
@Injectable()
export class RwsExecutor {
  constructor(
    private readonly store: LocalStore,
    private readonly deid: Deidentifier,
    private readonly tee: SoftwareTee = new SoftwareTee(),
  ) {}

  run(analysis: RwsAnalysis): AggregateResult {
    const result = this.store.aggregateInternal({ origin: 'internal', actor: 'rws-executor' }, (rows) => {
      // seal the local rows into the enclave; compute runs in-enclave
      const sealed = this.tee.seal(rows);
      return this.tee.run(sealed, (enclaveRows: InternalRecord[]) => {
        const cohort = analysis.drug
          ? enclaveRows.filter((r) => r.medications.includes(analysis.drug!))
          : enclaveRows;
        return analysis.type === 'cohort-count'
          ? this.cohortCount(cohort)
          : this.adverseEventSignal(cohort);
      }).output;
    });

    // Defensive: the aggregate that is about to leave must carry no identifiers.
    if (this.deid.containsDirectIdentifier(result)) {
      throw new Error('aggregate unexpectedly contains a direct identifier — refusing to emit');
    }
    return result;
  }

  private adverseEventSignal(cohort: readonly InternalRecord[]): AggregateResult {
    const counts = new Map<string, number>();
    for (const r of cohort) {
      for (const e of r.adverseEvents) {
        counts.set(e.organSystem, (counts.get(e.organSystem) ?? 0) + 1);
      }
    }
    const n = cohort.length || 1;
    return {
      analysisType: 'adverse-event-signal',
      cohortSize: cohort.length,
      buckets: [...counts.entries()]
        .map(([key, count]) => ({ key, count, rate: +(count / n).toFixed(4) }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private cohortCount(cohort: readonly InternalRecord[]): AggregateResult {
    const counts = new Map<string, number>();
    for (const r of cohort) counts.set(r.ageBand, (counts.get(r.ageBand) ?? 0) + 1);
    const n = cohort.length || 1;
    return {
      analysisType: 'cohort-count',
      cohortSize: cohort.length,
      buckets: [...counts.entries()]
        .map(([key, count]) => ({ key, count, rate: +(count / n).toFixed(4) }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    };
  }
}
