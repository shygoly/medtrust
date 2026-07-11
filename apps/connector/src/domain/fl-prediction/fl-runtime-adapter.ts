import { FlPredictionTaskSpec } from './fl-prediction-task-spec';
import { FlPartyRunResult } from './fl-run-result';

export interface FlEnvironmentStatus {
  ready: boolean;
  runtime: 'mock' | 'connector-ml' | 'tee';
  details?: string;
}

export interface FlPreparedTask {
  taskId: string;
  specHash: string;
  participantId: string;
  sampleCount: number;
  modelType: string;
  preparedAt: string;
}

export interface FlRuntimeContext {
  taskId: string;
  spec: FlPredictionTaskSpec;
  participantId: string;
  sampleCount: number;
  /** Optional local structured_ehr rows (never leaves connector host). */
  tabularRows?: Record<string, unknown>[];
}

export interface FlRuntimeAdapter {
  validateEnvironment(): FlEnvironmentStatus;
  prepare(context: FlRuntimeContext): FlPreparedTask;
  run(
    prepared: FlPreparedTask,
    spec: FlPredictionTaskSpec,
    context?: FlRuntimeContext,
  ): FlPartyRunResult | Promise<FlPartyRunResult>;
  cleanup(prepared: FlPreparedTask): void;
}
