import { NodeCapabilityService } from './node-capability.service';
import { SecretFlowTaskSpec } from '../compute-task/dto/secretflow-task-spec';

const SPEC: SecretFlowTaskSpec = {
  parties: [
    { participantId: 'hospital-a', role: 'provider' },
    { participantId: 'hospital-b', role: 'provider' },
    { participantId: 'pharma-x', role: 'consumer' },
  ],
  modalities: [{ type: 'dicom' }, { type: 'structured_ehr' }],
  llmBackbone: { modelType: 'llama', modelNameOrPath: 'meditron-7b' },
  peftStrategy: { type: 'lora', r: 8, alpha: 16, targetModules: ['q_proj', 'v_proj'] },
  privacy: { teeRequired: true, heuEnabled: true },
  outputPolicy: { allowedArtifacts: ['lora_delta_hash', 'aggregate_metrics'] },
};

describe('NodeCapabilityService', () => {
  const svc = new NodeCapabilityService();

  it('assigns teeu_full to a TEE + confidential GPU node', () => {
    const plan = svc.plan(SPEC, [
      { participantId: 'hospital-a', device: 'H100', hasTee: true, hasConfidentialGpu: true, gpuMemoryGb: 80 },
    ]);
    const a = plan.find((p) => p.participantId === 'hospital-a')!;
    expect(a.tier).toBe('teeu_full');
    expect(a.offloadAggregation).toBe(false);
    expect(a.localEpochs).toBe(2);
  });

  it('degrades a weak node to pyu_only with offload', () => {
    const plan = svc.plan(SPEC, [
      { participantId: 'hospital-b', device: 'V100', hasTee: false },
    ]);
    const b = plan.find((p) => p.participantId === 'hospital-b')!;
    expect(b.tier).toBe('pyu_only');
    expect(b.offloadAggregation).toBe(true);
    expect(b.localEpochs).toBe(1);
    expect(b.rationale).toContain('no TEE');
  });

  it('degrades when a TEE-required task hits a node without a TEE even if it has a GPU', () => {
    const plan = svc.plan(SPEC, [
      { participantId: 'hospital-a', hasTee: false, hasConfidentialGpu: true, gpuMemoryGb: 80 },
    ]);
    expect(plan.find((p) => p.participantId === 'hospital-a')!.tier).toBe('pyu_only');
  });

  it('produces a plan entry for every party, defaulting unknown nodes to pyu_only', () => {
    const plan = svc.plan(SPEC, []);
    expect(plan.map((p) => p.participantId)).toEqual(['hospital-a', 'hospital-b', 'pharma-x']);
    expect(plan.every((p) => p.tier === 'pyu_only')).toBe(true);
  });
});
