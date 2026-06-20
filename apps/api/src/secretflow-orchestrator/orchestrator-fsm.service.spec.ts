import { OrchestratorFsmService } from './orchestrator-fsm.service';
import { SecretFlowTaskSpec } from '../compute-task/dto/secretflow-task-spec';
import { NodePlan } from './types';

const SPEC: SecretFlowTaskSpec = {
  parties: [
    { participantId: 'hospital-a', role: 'provider' },
    { participantId: 'hospital-b', role: 'provider' },
  ],
  modalities: [{ type: 'dicom' }],
  llmBackbone: { modelType: 'llama', modelNameOrPath: 'meditron-7b' },
  peftStrategy: { type: 'lora', r: 8, alpha: 16, targetModules: ['q_proj'] },
  privacy: { teeRequired: false, heuEnabled: true },
  outputPolicy: { allowedArtifacts: ['lora_delta_hash'] },
};

const PLAN: NodePlan[] = [
  { participantId: 'hospital-a', tier: 'teeu_full', device: 'H100', offloadAggregation: false, localEpochs: 2, rationale: '' },
  { participantId: 'hospital-b', tier: 'pyu_only', device: 'CPU', offloadAggregation: true, localEpochs: 1, rationale: '' },
];

function fresh() {
  const fsm = new OrchestratorFsmService();
  fsm.create('t1', SPEC, PLAN, '# script');
  return fsm;
}

describe('OrchestratorFsmService', () => {
  it('starts PENDING and walks the happy path', () => {
    const fsm = fresh();
    expect(fsm.get('t1')!.state).toBe('PENDING');
    fsm.transition('t1', 'VALIDATING');
    fsm.transition('t1', 'PLANNING');
    fsm.transition('t1', 'DISPATCHING');
    fsm.transition('t1', 'TRAINING');
    fsm.transition('t1', 'COMPLETED');
    expect(fsm.get('t1')!.state).toBe('COMPLETED');
    expect(fsm.get('t1')!.history.map((h) => h.to)).toEqual([
      'VALIDATING', 'PLANNING', 'DISPATCHING', 'TRAINING', 'COMPLETED',
    ]);
  });

  it('rejects illegal transitions', () => {
    const fsm = fresh();
    expect(() => fsm.transition('t1', 'TRAINING')).toThrow(/Illegal/);
  });

  it('folds streamed events into state + metrics', () => {
    const fsm = fresh();
    fsm.transition('t1', 'VALIDATING');
    fsm.transition('t1', 'PLANNING');
    fsm.transition('t1', 'DISPATCHING');
    fsm.applyEvent('t1', { taskId: 't1', phase: 'baseline', globalLoss: 0.69 });
    fsm.applyEvent('t1', { taskId: 't1', phase: 'training', participantId: 'hospital-a', epoch: 1, loss: 0.4 });
    fsm.applyEvent('t1', { taskId: 't1', phase: 'round_complete', round: 1, globalLoss: 0.3 });
    const rec = fsm.get('t1')!;
    expect(rec.state).toBe('TRAINING');
    expect(rec.lastLoss).toBe(0.3);
    expect(rec.currentEpoch).toBe(1);
  });

  it('compensates by dropping a timed-out node and resuming', () => {
    const fsm = fresh();
    fsm.transition('t1', 'VALIDATING');
    fsm.transition('t1', 'PLANNING');
    fsm.transition('t1', 'DISPATCHING');
    fsm.transition('t1', 'TRAINING');
    const rec = fsm.compensate('t1', 'hospital-b', 'gradient_timeout');
    expect(rec.droppedParties).toContain('hospital-b');
    expect(rec.state).toBe('TRAINING');
    expect(rec.history.some((h) => h.to === 'COMPENSATING')).toBe(true);
  });

  it('fails the job when all parties are dropped', () => {
    const fsm = fresh();
    fsm.transition('t1', 'VALIDATING');
    fsm.transition('t1', 'PLANNING');
    fsm.transition('t1', 'DISPATCHING');
    fsm.transition('t1', 'TRAINING');
    fsm.compensate('t1', 'hospital-a', 'timeout');
    const rec = fsm.compensate('t1', 'hospital-b', 'timeout');
    expect(rec.state).toBe('FAILED');
  });

  it('applies a compensation event from the stream', () => {
    const fsm = fresh();
    fsm.transition('t1', 'VALIDATING');
    fsm.transition('t1', 'PLANNING');
    fsm.transition('t1', 'DISPATCHING');
    fsm.applyEvent('t1', { taskId: 't1', phase: 'compensation', participantId: 'hospital-b', reason: 'status_timeout' });
    expect(fsm.get('t1')!.droppedParties).toContain('hospital-b');
  });
});
