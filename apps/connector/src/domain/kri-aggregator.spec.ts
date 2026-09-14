import { aggregateKri, KRI_MIN_CELL, KriSpec } from './kri-aggregator';
import { InternalRecord } from './types';

/**
 * 站点级 KRI 聚合（rbqm-central-monitoring）验收：
 * ① 本地明细算出正确聚合三元组；② 分母 < 5 整条抑制；
 * ③ 出域观测不含任何行级/可识别字段（subjectKey 等）。
 */

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random(),
    ageBand: '40-49',
    sex: 'F',
    conditions: [],
    medications: [],
    adverseEvents: [],
    followUpDays: 90,
    ...over,
  };
}

const AE_RATE: KriSpec = {
  code: 'AE_SUBJECT_RATE',
  metric: 'ae_subject_rate',
  direction: 'higher_worse',
};
const MISSING_SEX: KriSpec = {
  code: 'MISSING_SEX_RATE',
  metric: 'missing_sex_rate',
  direction: 'higher_worse',
};

describe('aggregateKri', () => {
  it('computes numerator/denominator/value from local detail', () => {
    // 10 subjects, 3 with an adverse event.
    const rows = [
      ...Array.from({ length: 3 }, () =>
        rec({ adverseEvents: [{ term: '恶心', severity: 'mild' } as never] }),
      ),
      ...Array.from({ length: 7 }, () => rec({})),
    ];
    const obs = aggregateKri(rows, AE_RATE);
    expect(obs.suppressed).toBe(false);
    expect(obs.denominator).toBe(10);
    expect(obs.numerator).toBe(3);
    expect(obs.value).toBeCloseTo(0.3, 5);
    expect(obs.cohortSize).toBe(10);
  });

  it('suppresses the whole observation when denominator < 5', () => {
    const rows = [rec({}), rec({}), rec({ sex: '' })]; // n=3 < 5
    const obs = aggregateKri(rows, MISSING_SEX);
    expect(obs.suppressed).toBe(true);
    expect(obs.numerator).toBe(0);
    expect(obs.denominator).toBe(0);
    expect(obs.value).toBe(0);
    // cohortSize (行数, 非个体) 仍可展示
    expect(obs.cohortSize).toBe(3);
  });

  it('honors the hard small-cell floor even if a lower threshold is passed', () => {
    const rows = Array.from({ length: 4 }, () => rec({})); // n=4 < floor 5
    const obs = aggregateKri(rows, AE_RATE, 2); // caller tries threshold=2
    expect(obs.suppressed).toBe(true);
    expect(KRI_MIN_CELL).toBe(5);
  });

  it('emits no row-level / identifiable fields in the observation', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      rec({ subjectKey: 'patient-' + i, sex: i < 2 ? '' : 'M' }),
    );
    const obs = aggregateKri(rows, MISSING_SEX);
    const json = JSON.stringify(obs);
    expect(json).not.toContain('subjectKey');
    expect(json).not.toContain('patient-');
    expect(obs.numerator).toBe(2);
    expect(obs.denominator).toBe(8);
  });
});
