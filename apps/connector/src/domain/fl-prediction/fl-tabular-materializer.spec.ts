import { ckdEsrdRiskFlPredictionSpec } from './fl-prediction-task-spec';
import { materializeFlTabularRows } from './fl-tabular-materializer';
import { InternalRecord } from '../types';

function record(conditions: string[], medications: string[] = []): InternalRecord {
  const key = conditions.join('|').slice(0, 40) || 'subj-1';
  return {
    subjectKey: `hash-${key}`,
    ageBand: '50-59',
    conditions,
    medications,
    adverseEvents: [],
  };
}

describe('materializeFlTabularRows', () => {
  const spec = ckdEsrdRiskFlPredictionSpec();

  it('builds CKD feature rows with esrd_event label', () => {
    const rows = materializeFlTabularRows(
      [
        record(['Chronic kidney disease stage 2 (disorder)']),
        record(['Chronic kidney disease stage 4 (disorder)', 'Essential hypertension (disorder)']),
        record(['Chronic kidney disease stage 5 (disorder)']),
      ],
      spec,
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      egfr: expect.any(Number),
      ckd_stage: 'G2',
      esrd_event: false,
    });
    expect(rows[2].esrd_event).toBe(true);
    expect(rows[1].bp_systolic).toBeGreaterThan(rows[0].bp_systolic as number);
  });

  it('returns empty when no internal records', () => {
    expect(materializeFlTabularRows([], spec)).toEqual([]);
  });

  it('is deterministic for the same subjectKey', () => {
    const r = record(['Chronic kidney disease stage 3 (disorder)']);
    const a = materializeFlTabularRows([r], spec)[0];
    const b = materializeFlTabularRows([r], spec)[0];
    expect(a).toEqual(b);
  });
});
