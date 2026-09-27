import { Injectable } from '@nestjs/common';
import { LocalStore } from '../local-store';
import { SoftwareTee } from '../tee';
import { AggregateResult, InternalRecord, RwsAnalysis } from '../types';
import { CausalBackend, EchoCausalBackend } from './causal-backend';
import { materializeCausalCohort } from './causal-materializer';
import { RunLocalCausalParams } from './causal-response';

@Injectable()
export class CausalExecutor {
  constructor(
    private readonly store: LocalStore,
    // 默认 new SoftwareTee()：生产判据下构造即抛（D9/CTL-09），不可能静默生效。
    private readonly tee: SoftwareTee = new SoftwareTee(),
    private readonly backend: CausalBackend = new EchoCausalBackend(),
  ) {}

  async run(analysis: RwsAnalysis, taskId = 'local'): Promise<AggregateResult> {
    const params = this.store.aggregateInternal(
      { origin: 'internal', actor: 'causal-executor' },
      (rows) => {
        const sealed = this.tee.seal(rows);
        return this.tee.run(sealed, (enclaveRows: InternalRecord[]) =>
          this.buildParams(enclaveRows, analysis, taskId),
        ).output;
      },
    );
    return this.backend.runLocalCausal(params);
  }

  private buildParams(
    rows: readonly InternalRecord[],
    analysis: RwsAnalysis,
    taskId: string,
  ): RunLocalCausalParams {
    if (!analysis.tte) throw new Error('L3 因果分析须声明 tte 块');
    const method =
      analysis.method ?? (analysis.type === 'causal-survival' ? 'cox' : 'psm');
    const cohort = materializeCausalCohort(rows, analysis.tte, analysis.drug);
    if (!cohort.length) throw new Error('TTE 纳排后队列为空');
    return {
      taskId,
      method,
      specJson: JSON.stringify({
        tte: analysis.tte,
        allowedArtifacts: analysis.allowedArtifacts,
      }),
      cohortJson: JSON.stringify(cohort),
    };
  }
}
