import { ckdEsrdRiskFlPredictionSpec } from './fl-prediction-task-spec';
import {
  applyDpToPartyMetrics,
  assertDpCompliance,
  finalizePartyResultWithDp,
} from './fl-dp-gate';
import { FlOutputBlocked } from './fl-output-guard';
import { FlPartyRunResult } from './fl-run-result';

const baseParty = (): FlPartyRunResult => ({
  taskId: 'fl-dp-1',
  participantId: 'p-huashan',
  roundsCompleted: 5,
  sampleCount: 50,
  localModelHash: 'LOCAL:test',
  localMetrics: { auc: 0.8, f1: 0.7 },
});

describe('fl-dp-gate', () => {
  it('applyDpToPartyMetrics perturbs bounded metrics', () => {
    const noisy = applyDpToPartyMetrics({ auc: 0.8 }, 4, 'seed');
    expect(noisy.auc).toBeDefined();
    expect(noisy.auc!).toBeGreaterThanOrEqual(0);
    expect(noisy.auc!).toBeLessThanOrEqual(1);
  });

  it('blocks party result when epsilon declared but dp not applied', () => {
    const spec = ckdEsrdRiskFlPredictionSpec();
    expect(() => assertDpCompliance(spec, baseParty())).toThrow(FlOutputBlocked);
  });

  it('accepts party result after finalizePartyResultWithDp', () => {
    const spec = ckdEsrdRiskFlPredictionSpec();
    const finalized = finalizePartyResultWithDp(spec, baseParty());
    expect(finalized.dpApplied).toBe(true);
    expect(() => assertDpCompliance(spec, finalized)).not.toThrow();
  });
});
