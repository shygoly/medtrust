import {
  comparativeEffectEstimate,
  effectEstimateFromStratifiedTables,
  localLogisticRegression,
  mantelHaenszelPooledOr,
  stratifiedContingencyTables,
} from './comparative-effect';
import { InternalRecord } from './types';

const DRUG = '注射用紫杉醇';
const OUTCOME = 'ALT升高';
const ae = (term: string) => [{ organSystem: '肝胆系统', term, serious: false }];

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random(),
    ageBand: '40-49',
    sex: 'F',
    conditions: [],
    medications: [DRUG],
    adverseEvents: [],
    ...over,
  };
}

describe('stratifiedContingencyTables', () => {
  const cohort: InternalRecord[] = [
    rec({ ageBand: '40-49', medications: [DRUG], adverseEvents: ae(OUTCOME) }),
    rec({ ageBand: '40-49', medications: [DRUG], adverseEvents: ae(OUTCOME) }),
    rec({ ageBand: '40-49', medications: [DRUG] }),
    rec({ ageBand: '40-49', medications: ['对照药'], adverseEvents: ae(OUTCOME) }),
    rec({ ageBand: '40-49', medications: ['对照药'] }),
    rec({ ageBand: '50-59', medications: [DRUG], adverseEvents: ae(OUTCOME) }),
    rec({ ageBand: '50-59', medications: [DRUG] }),
    rec({ ageBand: '50-59', medications: ['对照药'] }),
  ];

  it('builds per-stratum 2×2 for drug×outcome', () => {
    const strata = stratifiedContingencyTables(cohort, DRUG, OUTCOME);
    expect(strata).toHaveLength(2);
    const s4049 = strata.find((s) => s.stratum === '40-49')!.table;
    expect(s4049).toEqual({ a: 2, b: 1, c: 1, d: 1 });
    const s5059 = strata.find((s) => s.stratum === '50-59')!.table;
    expect(s5059).toEqual({ a: 1, b: 1, c: 0, d: 1 });
  });
});

describe('mantelHaenszelPooledOr', () => {
  it('matches crude OR when only one stratum', () => {
    const t = { a: 8, b: 12, c: 4, d: 16 };
    const mh = mantelHaenszelPooledOr([t]);
    const crudeOr = (t.a * t.d) / (t.b * t.c);
    expect(mh.or).toBeCloseTo(crudeOr, 6);
    expect(mh.logOr).toBeCloseTo(Math.log(crudeOr), 6);
  });

  it('pools two homogeneous strata', () => {
    const t = { a: 4, b: 6, c: 2, d: 12 };
    const mh = mantelHaenszelPooledOr([t, t]);
    expect(mh.or).toBeCloseTo(4, 6);
  });
});

describe('localLogisticRegression', () => {
  it('β₁ ≈ log(OR) on a 2×2 table', () => {
    const cohort: InternalRecord[] = [];
    for (let i = 0; i < 8; i++) cohort.push(rec({ medications: [DRUG], adverseEvents: ae(OUTCOME) }));
    for (let i = 0; i < 12; i++) cohort.push(rec({ medications: [DRUG] }));
    for (let i = 0; i < 4; i++) cohort.push(rec({ medications: ['对照药'], adverseEvents: ae(OUTCOME) }));
    for (let i = 0; i < 16; i++) cohort.push(rec({ medications: ['对照药'] }));

    const fit = localLogisticRegression(cohort, DRUG, OUTCOME);
    const crudeOr = (8 * 16) / (12 * 4);
    expect(fit.logOr).toBeCloseTo(Math.log(crudeOr), 2);
    expect(fit.covariance).toHaveLength(2);
    expect(fit.covariance[1][1]).toBeGreaterThan(0);
    expect(fit.standardError).toBeGreaterThan(0);
  });
});

describe('comparativeEffectEstimate', () => {
  it('emits stratified buckets + MH + logistic without row keys', () => {
    const cohort: InternalRecord[] = [
      rec({ ageBand: '40-49', medications: [DRUG], adverseEvents: ae(OUTCOME) }),
      rec({ ageBand: '40-49', medications: [DRUG], adverseEvents: ae(OUTCOME) }),
      rec({ ageBand: '40-49', medications: [DRUG] }),
      rec({ ageBand: '40-49', medications: ['对照药'], adverseEvents: ae(OUTCOME) }),
      rec({ ageBand: '40-49', medications: ['对照药'] }),
      rec({ ageBand: '50-59', medications: [DRUG], adverseEvents: ae(OUTCOME) }),
      rec({ ageBand: '50-59', medications: [DRUG] }),
      rec({ ageBand: '50-59', medications: ['对照药'] }),
    ];
    const out = comparativeEffectEstimate(cohort, DRUG, OUTCOME);
    expect(out.analysisType).toBe('comparative-effect');
    expect(out.buckets).toHaveLength(2);
    expect(out.effectEstimate?.mantelHaenszel?.or).toBeGreaterThan(0);
    expect(out.effectEstimate?.beta).toBeDefined();
    expect(out.effectEstimate?.covariance).toHaveLength(2);
    const json = JSON.stringify(out);
    expect(json).not.toContain('subjectKey');
  });

  it('requires drug and outcome', () => {
    expect(() => comparativeEffectEstimate([], '', OUTCOME)).toThrow('drug');
    expect(() => comparativeEffectEstimate([], DRUG, '')).toThrow('outcome');
  });
});

describe('effectEstimateFromStratifiedTables', () => {
  it('recomputes effect from remaining strata after small-stratum gate', () => {
    const tables = [
      { a: 4, b: 6, c: 2, d: 8 },
      { a: 2, b: 3, c: 1, d: 4 },
    ];
    const est = effectEstimateFromStratifiedTables(tables);
    expect(est?.beta).toBeDefined();
    expect(est!.mantelHaenszel!.or).toBeGreaterThan(0);
  });

  it('returns undefined when no strata remain', () => {
    expect(effectEstimateFromStratifiedTables([])).toBeUndefined();
  });
});
