import { AggregateResult } from '../types';
import { RunLocalCausalParams } from './causal-response';

export interface CausalBackend {
  runLocalCausal(params: RunLocalCausalParams): AggregateResult;
}

/** 本地 echo 后端(测试/无 agent 时). */
export class EchoCausalBackend implements CausalBackend {
  runLocalCausal(params: RunLocalCausalParams): AggregateResult {
    const cohort = JSON.parse(params.cohortJson) as unknown[];
    const n = cohort.length;
    if (params.method === 'cox') {
      return {
        analysisType: 'causal-survival',
        cohortSize: n,
        buckets: [],
        effectEstimate: {
          measure: 'log_hr',
          beta: -0.25,
          standardError: 0.09,
          ci95: [-0.43, -0.07],
        },
        kmCurve: {
          binWidthDays: 30,
          bins: [
            { t: 0, survival: 1, atRisk: n },
            { t: 180, survival: 0.82, atRisk: Math.max(5, Math.floor(n * 0.6)) },
          ],
        },
      };
    }
    return {
      analysisType: 'causal-psm',
      cohortSize: n,
      buckets: [],
      effectEstimate: {
        measure: 'ate',
        beta: 0.11,
        standardError: 0.045,
        ci95: [0.02, 0.2],
      },
    };
  }
}
