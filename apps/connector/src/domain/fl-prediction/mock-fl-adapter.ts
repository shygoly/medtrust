import { createHash } from 'crypto';
import { FlPredictionTaskSpec } from './fl-prediction-task-spec';
import { assertSafeFlPartyRunResult } from './fl-output-guard';
import { finalizePartyResultWithDp } from './fl-dp-gate';
import { FlPartyRunResult } from './fl-run-result';
import {
  FlEnvironmentStatus,
  FlPreparedTask,
  FlRuntimeAdapter,
  FlRuntimeContext,
} from './fl-runtime-adapter';

function digest(prefix: string, input: string): string {
  return `${prefix}:${createHash('sha256').update(input).digest('hex').slice(0, 16)}`;
}

export function canonicalFlSpecJson(spec: FlPredictionTaskSpec): string {
  return JSON.stringify(spec);
}

export function hashFlPredictionSpec(taskId: string, spec: FlPredictionTaskSpec): string {
  return digest('FL', `${taskId}:${canonicalFlSpecJson(spec)}`);
}

export class MockFlAdapter implements FlRuntimeAdapter {
  validateEnvironment(): FlEnvironmentStatus {
    return {
      ready: true,
      runtime: 'mock',
      details: 'mock-fl-prediction-runtime',
    };
  }

  prepare(context: FlRuntimeContext): FlPreparedTask {
    const specHash = hashFlPredictionSpec(context.taskId, context.spec);
    return {
      taskId: context.taskId,
      specHash,
      participantId: context.participantId,
      sampleCount: context.sampleCount,
      modelType: context.spec.modelType,
      preparedAt: new Date(0).toISOString(),
    };
  }

  run(prepared: FlPreparedTask, spec: FlPredictionTaskSpec): FlPartyRunResult {
    const seed = `${prepared.specHash}:${prepared.participantId}`;
    const base = 0.68 + (seed.length % 12) / 100;
    const localModelHash = digest('LOCAL', `${prepared.specHash}:${prepared.participantId}`);

    const raw = assertSafeFlPartyRunResult({
      taskId: prepared.taskId,
      participantId: prepared.participantId,
      roundsCompleted: spec.rounds,
      sampleCount: prepared.sampleCount,
      localModelHash,
      trainingMode: 'mock',
      localMetrics: {
        auc: Number((base + 0.06).toFixed(4)),
        f1: Number((base - 0.03).toFixed(4)),
        precision: Number((base - 0.02).toFixed(4)),
        recall: Number((base + 0.01).toFixed(4)),
      },
    });
    return finalizePartyResultWithDp(spec, raw);
  }

  cleanup(_prepared: FlPreparedTask): void {
    // Mock runtime has no external resources to release.
  }
}
