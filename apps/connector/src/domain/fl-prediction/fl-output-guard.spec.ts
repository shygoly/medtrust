import {
  assertSafeFlRunResult,
  filterFlRunResultByPolicy,
  FlOutputBlocked,
  serializeSafeFlRunResult,
} from './fl-output-guard';
import { FlRunResult } from './fl-run-result';

const safeResult: FlRunResult = {
  taskId: 'fl-safe-1',
  roundsCompleted: 5,
  totalRounds: 5,
  modelType: 'xgboost',
  objective: 'binary',
  modelHash: 'FL:abc123',
  aggregateMetrics: { auc: 0.82, f1: 0.71 },
  partyContributions: [
    {
      participantId: 'p-huashan',
      sampleCount: 59,
      roundsParticipated: 5,
      localModelHash: 'LOCAL:p-huashan:5',
    },
  ],
  featureImportance: [{ feature: 'egfr', importance: 0.42 }],
  attestation: {
    reportHash: 'ATT:def456',
    runtime: 'mock',
    generatedAt: new Date(0).toISOString(),
    specHash: 'spec:ckd',
  },
  privacySummary: {
    aggregation: 'secureboost',
    safeOutputOnly: true,
  },
};

describe('fl-output-guard', () => {
  it('accepts safe FL run result envelope', () => {
    expect(assertSafeFlRunResult(safeResult)).toBe(safeResult);
    expect(serializeSafeFlRunResult(safeResult)).toContain('modelHash');
  });

  it('blocks patient-level payload keys', () => {
    const unsafe = { ...safeResult, patientRows: [{ id: 'p1' }] } as unknown as FlRunResult;
    expect(() => assertSafeFlRunResult(unsafe)).toThrow(FlOutputBlocked);
  });

  it('blocks model weight coefficients', () => {
    const unsafe = {
      ...safeResult,
      diagnostics: { modelWeights: [0.1, 0.2] },
    } as unknown as FlRunResult;
    expect(() => assertSafeFlRunResult(unsafe)).toThrow(FlOutputBlocked);
  });

  it('filters disallowed artifacts then re-validates safety', () => {
    const filtered = filterFlRunResultByPolicy(safeResult, ['auc']);
    expect(filtered.featureImportance).toBeUndefined();
    expect(filtered.modelHash).toBe('[withheld]');
    expect(filtered.aggregateMetrics.auc).toBe(0.82);
  });
});
