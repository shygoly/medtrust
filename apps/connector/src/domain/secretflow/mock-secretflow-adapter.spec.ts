import { MockSecretFlowAdapter, hashSecretFlowSpec } from './mock-secretflow-adapter';
import { SecretFlowTaskSpec } from './secretflow-task-spec';

function minimalSecretFlowSpec(): SecretFlowTaskSpec {
  return {
    parties: [{ participantId: 'hospital-a', role: 'provider' }],
    modalities: [{ type: 'clinical_text' }],
    llmBackbone: { modelType: 'llm', modelNameOrPath: 'mock/backbone' },
    peftStrategy: { type: 'lora', r: 8, alpha: 16, targetModules: ['q_proj'] },
    privacy: { teeRequired: true, heuEnabled: false },
    outputPolicy: { allowedArtifacts: ['lora_delta_hash', 'aggregate_metrics'] },
  };
}

describe('MockSecretFlowAdapter', () => {
  const adapter = new MockSecretFlowAdapter();
  const taskId = 'sf-task-mock-1';
  const spec = minimalSecretFlowSpec();

  it('validates the mock environment as ready', () => {
    expect(adapter.validateEnvironment()).toEqual({
      ready: true,
      runtime: 'mock',
      details: 'mock-secretflow-runtime',
    });
  });

  it('runs prepare → run → cleanup with deterministic hashes', () => {
    const preparedA = adapter.prepare({ taskId, spec });
    const preparedB = adapter.prepare({ taskId, spec });
    expect(preparedA.specHash).toBe(preparedB.specHash);
    expect(preparedA.specHash).toBe(hashSecretFlowSpec(taskId, spec));

    const resultA = adapter.run(preparedA, spec);
    const resultB = adapter.run(preparedB, spec);
    expect(resultA.loraDeltaHash).toBe(resultB.loraDeltaHash);
    expect(resultA.encryptedDeltaRef).toBe(resultB.encryptedDeltaRef);
    expect(resultA.attestation.reportHash).toBe(resultB.attestation.reportHash);
    expect(resultA.privacySummary.safeOutputOnly).toBe(true);

    expect(() => adapter.cleanup(preparedA)).not.toThrow();
  });

  it('changes hashes when the task id or spec changes', () => {
    const prepared = adapter.prepare({ taskId, spec });
    const otherPrepared = adapter.prepare({
      taskId: 'sf-task-mock-2',
      spec: {
        ...spec,
        modalities: [{ type: 'dicom' }],
      },
    });

    expect(otherPrepared.specHash).not.toBe(prepared.specHash);
    expect(adapter.run(otherPrepared, spec).loraDeltaHash).not.toBe(
      adapter.run(prepared, spec).loraDeltaHash,
    );
  });
});
