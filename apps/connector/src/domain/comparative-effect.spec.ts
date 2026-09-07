import {
  comparativeEffectEstimate,
  effectEstimateFromStratifiedTables,
  firthLogisticRegression,
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

  it('matches Synthea Metformin + CKD stage 3 labels used in Fly L2 e2e', () => {
    const cohort: InternalRecord[] = [
      rec({
        medications: ['24 HR Metformin hydrochloride 500 MG Extended Release Oral Tablet', '二甲双胍'],
        conditions: ['慢性肾病', 'Chronic kidney disease stage 3'],
      }),
      rec({
        medications: ['24 HR Metformin hydrochloride 500 MG Extended Release Oral Tablet', '二甲双胍'],
        conditions: ['糖尿病'],
      }),
      rec({ medications: ['lisinopril'], conditions: ['慢性肾病', 'Chronic kidney disease stage 3'] }),
      rec({ medications: ['lisinopril'], conditions: ['高血压'] }),
      rec({
        medications: ['24 HR Metformin hydrochloride 500 MG Extended Release Oral Tablet', '二甲双胍'],
        conditions: ['糖尿病'],
      }),
      rec({ medications: ['lisinopril'], conditions: ['高血压'] }),
    ];
    const out = comparativeEffectEstimate(
      cohort,
      '二甲双胍',
      'Chronic kidney disease stage 3',
      'condition',
    );
    expect(out.cohortSize).toBe(6);
    expect(Number.isFinite(out.effectEstimate?.beta as number)).toBe(true);
    expect(out.effectEstimate?.standardError).toBeGreaterThan(0);
  });

  it('falls back to Firth instead of crashing under complete separation', () => {
    // exposed→all outcome, unexposed→none: standard MLE diverges (singular).
    const sep: InternalRecord[] = [];
    for (let i = 0; i < 12; i++)
      sep.push(rec({ medications: [DRUG], adverseEvents: ae(OUTCOME) }));
    for (let i = 0; i < 12; i++) sep.push(rec({ medications: ['对照药'] }));

    const out = comparativeEffectEstimate(sep, DRUG, OUTCOME);
    expect(out.effectEstimate?.method).toBe('firth');
    expect(Number.isFinite(out.effectEstimate?.beta as number)).toBe(true);
    expect(out.effectEstimate?.beta).toBeGreaterThan(0);
  });
});

describe('firthLogisticRegression', () => {
  it('stays finite where standard MLE diverges (complete separation)', () => {
    const sep: InternalRecord[] = [];
    for (let i = 0; i < 12; i++)
      sep.push(rec({ medications: [DRUG], adverseEvents: ae(OUTCOME) }));
    for (let i = 0; i < 12; i++) sep.push(rec({ medications: ['对照药'] }));

    const fit = firthLogisticRegression(sep, DRUG, OUTCOME);
    expect(Number.isFinite(fit.logOr)).toBe(true);
    expect(fit.logOr).toBeGreaterThan(0);
    expect(fit.standardError).toBeGreaterThan(0);
    expect(Number.isFinite(fit.standardError)).toBe(true);
  });

  it('agrees with standard logistic on a well-conditioned 2×2', () => {
    const cohort: InternalRecord[] = [];
    for (let i = 0; i < 8; i++) cohort.push(rec({ medications: [DRUG], adverseEvents: ae(OUTCOME) }));
    for (let i = 0; i < 12; i++) cohort.push(rec({ medications: [DRUG] }));
    for (let i = 0; i < 4; i++) cohort.push(rec({ medications: ['对照药'], adverseEvents: ae(OUTCOME) }));
    for (let i = 0; i < 16; i++) cohort.push(rec({ medications: ['对照药'] }));

    const mle = localLogisticRegression(cohort, DRUG, OUTCOME);
    const firth = firthLogisticRegression(cohort, DRUG, OUTCOME);
    // Firth shrinks toward 0 but should be within ~0.5 of the MLE here.
    expect(Math.abs(firth.logOr - mle.logOr)).toBeLessThan(0.5);
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

  // rws-study-protocol-spec D6: absolute-risk expression derived from the
  // pooled {a,b,c,d} cells.
  describe('absoluteRisk (§3.1 / D6)', () => {
    it('populates absoluteRisk with risk difference + CI + baseline', () => {
      // Pooled: a=6, b=9 (exposed: 6/15 = 0.4), c=3, d=12 (unexposed: 3/15 = 0.2)
      // riskDifference = 0.4 - 0.2 = 0.2; baselineRate = 0.2
      const est = effectEstimateFromStratifiedTables([
        { a: 4, b: 6, c: 2, d: 8 },
        { a: 2, b: 3, c: 1, d: 4 },
      ]);
      expect(est?.absoluteRisk).toBeDefined();
      const ar = est!.absoluteRisk!;
      expect(ar.riskDifference).toBeCloseTo(0.2, 5);
      expect(ar.baselineRate).toBeCloseTo(0.2, 5);
      expect(ar.baselineSource).toBe('aggregated_site_counts');
      // CI must straddle the point estimate and stay within [-1, 1].
      expect(ar.ci95[0]).toBeLessThan(ar.riskDifference);
      expect(ar.ci95[1]).toBeGreaterThan(ar.riskDifference);
      expect(ar.ci95[0]).toBeGreaterThanOrEqual(-1);
      expect(ar.ci95[1]).toBeLessThanOrEqual(1);
    });

    it('produces a NEGATIVE risk difference when exposed rate < unexposed', () => {
      // Exposed event rate lower than unexposed (a "protective" effect).
      const est = effectEstimateFromStratifiedTables([
        { a: 1, b: 19, c: 5, d: 15 }, // exp: 1/20 = 0.05; unexp: 5/20 = 0.25
      ]);
      expect(est!.absoluteRisk!.riskDifference).toBeLessThan(0);
      expect(est!.absoluteRisk!.baselineRate).toBeCloseTo(0.25, 5);
    });

    it('CI widens for smaller samples (lower precision)', () => {
      const wide = effectEstimateFromStratifiedTables([
        { a: 1, b: 9, c: 1, d: 9 }, // n=20 total
      ])!;
      const narrow = effectEstimateFromStratifiedTables([
        { a: 50, b: 450, c: 50, d: 450 }, // n=1000 total, same proportions
      ])!;
      const wideWidth = wide.absoluteRisk!.ci95[1] - wide.absoluteRisk!.ci95[0];
      const narrowWidth = narrow.absoluteRisk!.ci95[1] - narrow.absoluteRisk!.ci95[0];
      expect(wideWidth).toBeGreaterThan(narrowWidth);
    });
  });
});
