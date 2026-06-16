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

export interface SecretFlowModelCardSummary {
  modelType: string;
  modelNameOrPath: string;
  peftType: 'lora';
}

export interface SecretFlowRunResult {
  taskId: string;
  roundsCompleted: number;
  metrics: Record<string, number>;
  loraDeltaHash: string;
  encryptedDeltaRef: string;
  attestation: SecretFlowAttestationSummary;
  privacySummary: SecretFlowPrivacySummary;
  modelCard?: SecretFlowModelCardSummary;
}
