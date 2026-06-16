import { SecretFlowTaskSpec } from './secretflow-task-spec';

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

export interface SecretFlowAttestationSummary {
  reportHash: string;
  runtime: 'mock' | 'cli' | 'teeu';
  generatedAt: string;
  specHash: string;
}

export interface SecretFlowPrivacySummary {
  teeRequired: boolean;
  heuEnabled: boolean;
  dpSgdEnabled: boolean;
  safeOutputOnly: true;
}

export interface SecretFlowRunResult {
  taskId: string;
  roundsCompleted: number;
  metrics: Record<string, number>;
  loraDeltaHash: string;
  encryptedDeltaRef: string;
  attestation: SecretFlowAttestationSummary;
  privacySummary: SecretFlowPrivacySummary;
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
