import {
  assertSafeSecretFlowRunResult,
  SecretFlowOutputBlocked,
  serializeSafeSecretFlowRunResult,
} from './secretflow-output-guard';
import { SecretFlowRunResult } from './secretflow-run-result';

const safeResult: SecretFlowRunResult = {
  taskId: 'sf-safe-1',
  roundsCompleted: 1,
  metrics: { trainLoss: 0.12, valLoss: 0.18 },
  loraDeltaHash: 'LORA:abc123',
  encryptedDeltaRef: 'ENC:def456',
  attestation: {
    reportHash: 'ATT:ghi789',
    runtime: 'mock',
    generatedAt: new Date(0).toISOString(),
    specHash: 'SM3:spec',
  },
  privacySummary: {
    teeRequired: true,
    heuEnabled: false,
    dpSgdEnabled: false,
    safeOutputOnly: true,
  },
  modelCard: {
    modelType: 'llm',
    modelNameOrPath: 'mock/backbone',
    peftType: 'lora',
  },
};

describe('secretflow-output-guard', () => {
  it('accepts the safe SecretFlowRunResult envelope', () => {
    expect(assertSafeSecretFlowRunResult(safeResult)).toBe(safeResult);
    expect(serializeSafeSecretFlowRunResult(safeResult)).toContain('loraDeltaHash');
  });

  it('contains only safe artifact and metadata fields when serialized', () => {
    const serialized = serializeSafeSecretFlowRunResult(safeResult);
    expect(serialized).toContain('encryptedDeltaRef');
    expect(serialized).toContain('reportHash');
    expect(serialized).not.toMatch(/rawDicom|rawVcf|patientRows|unencryptedGradients|embeddings/);
  });

  it('blocks patient-level rows', () => {
    const unsafe = { ...safeResult, patientRows: [{ subjectKey: 'sk-1' }] } as unknown as SecretFlowRunResult;
    expect(() => assertSafeSecretFlowRunResult(unsafe)).toThrow(SecretFlowOutputBlocked);
  });

  it('blocks raw modality payload keys', () => {
    const unsafe = { ...safeResult, rawDicom: 'base64-pixels' } as unknown as SecretFlowRunResult;
    expect(() => assertSafeSecretFlowRunResult(unsafe)).toThrow(
      'SecretFlow output contains unsafe field: result.rawDicom',
    );
  });

  it('blocks unencrypted gradients and embeddings', () => {
    const unsafe = {
      ...safeResult,
      diagnostics: { unencryptedGradients: [0.1], embeddings: [[0.2]] },
    } as unknown as SecretFlowRunResult;

    expect(() => assertSafeSecretFlowRunResult(unsafe)).toThrow(SecretFlowOutputBlocked);
  });
});
