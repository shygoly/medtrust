import {
  hasRequiredModalities,
  hasRequiredParties,
  isSecretFlowTaskSpec,
  SecretFlowTaskSpec,
} from './secretflow-task-spec';

function minimalSecretFlowTaskSpec(): SecretFlowTaskSpec {
  return {
    parties: [{ participantId: 'hospital-a', role: 'provider' }],
    modalities: [{ type: 'dicom', manifestUri: 'manifest://local/dicom-v1' }],
    llmBackbone: { modelType: 'vlm', modelNameOrPath: 'mock/multimodal' },
    peftStrategy: { type: 'lora', r: 4, alpha: 8, targetModules: ['v_proj', 'q_proj'] },
    privacy: { teeRequired: true, heuEnabled: true },
    outputPolicy: { allowedArtifacts: ['encrypted_delta_ref', 'attestation_report'] },
  };
}

describe('secretflow-task-spec', () => {
  it('accepts a minimal valid SecretFlowTaskSpec', () => {
    const spec = minimalSecretFlowTaskSpec();
    expect(isSecretFlowTaskSpec(spec)).toBe(true);
    expect(hasRequiredParties(spec)).toBe(true);
    expect(hasRequiredModalities(spec)).toBe(true);
  });

  it('rejects missing llmBackbone fields', () => {
    const spec = {
      ...minimalSecretFlowTaskSpec(),
      llmBackbone: { modelType: '', modelNameOrPath: 'mock/multimodal' },
    };
    expect(isSecretFlowTaskSpec(spec)).toBe(false);
  });

  it('rejects empty peft targetModules', () => {
    const spec = {
      ...minimalSecretFlowTaskSpec(),
      peftStrategy: { type: 'lora', r: 4, alpha: 8, targetModules: [] },
    };
    expect(isSecretFlowTaskSpec(spec)).toBe(false);
  });

  it('rejects unknown modality type', () => {
    const spec = {
      ...minimalSecretFlowTaskSpec(),
      modalities: [{ type: 'raw_rows' }],
    };
    expect(hasRequiredModalities(spec)).toBe(false);
    expect(isSecretFlowTaskSpec(spec)).toBe(false);
  });
});
