import { SecretFlowTaskSpec } from './secretflow-task-spec';
import { SecretFlowRunResult } from './secretflow-run-result';

export interface SecretFlowEnvironmentStatus {
  ready: boolean;
  runtime: 'mock' | 'cli' | 'teeu';
  details?: string;
}

export interface SecretFlowPreparedTask {
  taskId: string;
  specHash: string;
  partyCount: number;
  modalityTypes: string[];
  preparedAt: string;
}

export interface SecretFlowRuntimeContext {
  taskId: string;
  spec: SecretFlowTaskSpec;
}

export interface SecretFlowRuntimeAdapter {
  validateEnvironment(): SecretFlowEnvironmentStatus;
  prepare(context: SecretFlowRuntimeContext): SecretFlowPreparedTask;
  run(prepared: SecretFlowPreparedTask, spec: SecretFlowTaskSpec): SecretFlowRunResult;
  cleanup(prepared: SecretFlowPreparedTask): void;
}
