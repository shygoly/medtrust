import { Injectable } from '@nestjs/common';
import { CausalExecutor } from './causal/causal-executor';
import { LocalStore } from './local-store';
import { Deidentifier } from './deidentifier';
import { SoftwareTee } from './tee';
import { RwsAnalysis, AggregateResult, InternalRecord } from './types';
import { comparativeEffectEstimate } from './comparative-effect';

// Runs an RWS analysis over the connector-local rows and returns ONLY an
// aggregate. The analysis runs INSIDE the TEE: the rows are sealed into the
// enclave and the compute happens over decrypted data in-enclave (5.2); the
// raw rows never leave it. The returned aggregate is still raw — the output
// gate (5.3/5.4) is applied downstream by the task runner.
@Injectable()
export class RwsExecutor {
  private readonly causal: CausalExecutor;

  constructor(
    private readonly store: LocalStore,
    private readonly deid: Deidentifier,
    private readonly tee: SoftwareTee = new SoftwareTee(),
    causalExecutor?: CausalExecutor,
  ) {
    this.causal = causalExecutor ?? new CausalExecutor(store, tee);
  }

  run(analysis: RwsAnalysis, taskId = 'local'): AggregateResult {
    if (analysis.type === 'causal-psm' || analysis.type === 'causal-survival') {
      const result = this.causal.run(analysis, taskId);
      if (this.deid.containsDirectIdentifier(result)) {
        throw new Error('aggregate unexpectedly contains a direct identifier — refusing to emit');
      }
      return result;
    }

    const result = this.store.aggregateInternal({ origin: 'internal', actor: 'rws-executor' }, (rows) => {
      // seal the local rows into the enclave; compute runs in-enclave
      const sealed = this.tee.seal(rows);
      return this.tee.run(sealed, (enclaveRows: InternalRecord[]) => {
        // L1.5 失衡需全人群(算非暴露组 c/d),不能用按 drug 过滤后的队列.
        if (analysis.type === 'disproportionality') {
          return disproportionalityTables(enclaveRows, analysis.drug);
        }
        if (analysis.type === 'comparative-effect') {
          return comparativeEffectEstimate(
            enclaveRows,
            analysis.drug ?? '',
            analysis.outcome ?? '',
            analysis.outcomeKind ?? 'adverse_event',
            analysis.stratifyBy ?? ['ageBand'],
          );
        }
        const cohort = analysis.drug
          ? enclaveRows.filter((r) => r.medications.includes(analysis.drug!))
          : enclaveRows;
        return analysis.type === 'cohort-count'
          ? this.cohortCount(cohort)
          : analysis.type === 'condition-prevalence'
            ? this.conditionPrevalence(cohort)
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

  /** Top chronic-condition labels across the local cohort (metadata only leaves the connector). */
  private conditionPrevalence(cohort: readonly InternalRecord[]): AggregateResult {
    const counts = new Map<string, number>();
    for (const r of cohort) {
      const labels = r.conditions.length ? r.conditions : ['无明确慢病标签'];
      for (const label of labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    const n = cohort.length || 1;
    return {
      analysisType: 'condition-prevalence',
      cohortSize: cohort.length,
      buckets: [...counts.entries()]
        .map(([key, count]) => ({ key, count, rate: +(count / n).toFixed(4) }))
        .sort((a, b) => b.count - a.count),
    };
  }
}

// L1.5 失衡信号: 对目标药 drug,在全人群上按每个不良事件 term 构建 2×2
// (a=drug∩event, b=drug∩非event, c=非drug∩event, d=非drug∩非event). 仅聚合计数,无个体行.
export function disproportionalityTables(
  cohort: readonly InternalRecord[],
  drug: string | undefined,
): AggregateResult {
  if (!drug) {
    throw new Error('disproportionality 需指定 drug of interest');
  }
  const onDrug = (r: InternalRecord) => r.medications.includes(drug);
  const nDrug = cohort.filter(onDrug).length;
  const nNoDrug = cohort.length - nDrug;
  const events = new Set<string>();
  for (const r of cohort) for (const e of r.adverseEvents) events.add(e.term);
  const n = cohort.length || 1;
  const buckets = [...events]
    .map((event) => {
      let a = 0;
      let c = 0;
      for (const r of cohort) {
        if (!r.adverseEvents.some((e) => e.term === event)) continue;
        if (onDrug(r)) a++;
        else c++;
      }
      return { key: event, count: a, rate: +(a / n).toFixed(4), b: nDrug - a, c, d: nNoDrug - c };
    })
    .sort((x, y) => y.count - x.count);
  return { analysisType: 'disproportionality', cohortSize: cohort.length, buckets };
}
