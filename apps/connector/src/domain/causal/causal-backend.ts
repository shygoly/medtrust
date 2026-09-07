import { AggregateResult } from '../types';
import { CausalAgentClient } from './causal-agent-client';
import { RunLocalCausalParams } from './causal-response';

export interface CausalBackend {
  runLocalCausal(params: RunLocalCausalParams): Promise<AggregateResult>;
}

/** 本地 echo 后端 — 仅单测 / 显式注入. 生产禁止. */
export class EchoCausalBackend implements CausalBackend {
  async runLocalCausal(params: RunLocalCausalParams): Promise<AggregateResult> {
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

export class FailClosedCausalBackend implements CausalBackend {
  constructor(private readonly reason: string) {}

  async runLocalCausal(): Promise<AggregateResult> {
    throw new Error(this.reason);
  }
}

/** 生产后端：有 AGENT_GRPC_URL 走 agent，否则 fail-closed（不用 Echo）。 */
export function createProductionCausalBackend(
  env: NodeJS.ProcessEnv = process.env,
): CausalBackend {
  const url = env.AGENT_GRPC_URL?.trim();
  if (!url) {
    return new FailClosedCausalBackend(
      'L3 因果须配置 AGENT_GRPC_URL 连接 agent，禁止 Echo 占位出域',
    );
  }
  return new CausalAgentClient(undefined, url);
}
