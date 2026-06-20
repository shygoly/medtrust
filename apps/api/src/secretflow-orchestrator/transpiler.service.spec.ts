import { SecretFlowTranspilerService } from './transpiler.service';
import { NodeCapabilityService } from './node-capability.service';
import { SecretFlowTaskSpec } from '../compute-task/dto/secretflow-task-spec';

const SPEC: SecretFlowTaskSpec = {
  parties: [
    { participantId: 'hospital-a', role: 'provider' },
    { participantId: 'hospital-b', role: 'provider' },
  ],
  modalities: [{ type: 'dicom' }, { type: 'genomics' }],
  llmBackbone: { modelType: 'llama', modelNameOrPath: 'meditron-7b' },
  peftStrategy: { type: 'lora', r: 8, alpha: 16, targetModules: ['q_proj'] },
  privacy: { teeRequired: true, heuEnabled: true, dpSgd: { clipNorm: 1, noiseMultiplier: 0.8 } },
  outputPolicy: { allowedArtifacts: ['lora_delta_hash'] },
};

describe('SecretFlowTranspilerService', () => {
  const transpiler = new SecretFlowTranspilerService();
  const capability = new NodeCapabilityService();

  const plan = capability.plan(SPEC, [
    { participantId: 'hospital-a', device: 'H100', hasTee: true, hasConfidentialGpu: true, gpuMemoryGb: 80 },
    { participantId: 'hospital-b', device: 'V100', hasTee: false },
  ]);

  it('emits a TEEU device for the full node and PYU for the degraded node', () => {
    const script = transpiler.transpile('task-1', SPEC, plan);
    expect(script).toContain('sf.TEEU("hospital-a"');
    expect(script).toContain('sf.PYU("hospital-b")');
  });

  it('wires HEU aggregation when heuEnabled', () => {
    const script = transpiler.transpile('task-1', SPEC, plan);
    expect(script).toContain('sf.HEU(');
    expect(script).toContain('server = heu');
  });

  it('emits DP-SGD parameters when configured', () => {
    const script = transpiler.transpile('task-1', SPEC, plan);
    expect(script).toContain('clip_norm=1');
    expect(script).toContain('noise_multiplier=0.8');
  });

  it('references the declarative model factory and chunked fit', () => {
    const script = transpiler.transpile('task-1', SPEC, plan);
    expect(script).toContain('build_model(spec)');
    expect(script).toContain("strategy='fedavg'");
    expect(script).toContain('batch_size=64');
  });

  it('is deterministic for the same inputs', () => {
    expect(transpiler.transpile('task-1', SPEC, plan)).toEqual(
      transpiler.transpile('task-1', SPEC, plan),
    );
  });

  it('safely embeds the spec as JSON without breaking the script', () => {
    const script = transpiler.transpile('task-1', SPEC, plan);
    const match = script.match(/SPEC = json\.loads\((".*?")\)\n/s);
    expect(match).toBeTruthy();
    // The embedded payload round-trips back to the original spec.
    const embedded = JSON.parse(JSON.parse(match![1]));
    expect(embedded.parties).toHaveLength(2);
  });
});
