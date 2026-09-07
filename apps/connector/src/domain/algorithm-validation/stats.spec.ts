import { wilsonScoreInterval, metricsFromConfusionMatrix } from './stats';

describe('stats — Wilson score interval (task 3.3 / design D2)', () => {
  describe('wilsonScoreInterval', () => {
    it('returns [0,0] when n=0 (guard)', () => {
      expect(wilsonScoreInterval(0, 0)).toEqual([0, 0]);
    });

    it('produces a sensible mid-range interval', () => {
      const [lo, hi] = wilsonScoreInterval(50, 100);
      expect(lo).toBeGreaterThan(0.4);
      expect(hi).toBeLessThan(0.6);
      expect(lo).toBeLessThan(0.5);
      expect(hi).toBeGreaterThan(0.5);
    });

    it('CRITICAL: at Sp → 1 (k=n), upper bound MUST NOT exceed 1 (Wald would)', () => {
      // This is the boundary test mandated by the spec scenario
      // "高特异度不产生越界区间". Wald would give 1 ± 1.96·sqrt(1·0/n) = 1
      // but at e.g. 49/50 Wald overshoots above 1.
      const [lo, hi] = wilsonScoreInterval(50, 50);
      expect(hi).toBeLessThanOrEqual(1);
      expect(hi).toBeGreaterThanOrEqual(0.9);
      expect(lo).toBeGreaterThanOrEqual(0);
    });

    it('CRITICAL: at 49/50 (high but not perfect), upper bound stays ≤ 1', () => {
      // Wald would give 0.98 + 1.96·sqrt(0.98·0.02/50) ≈ 0.98 + 0.0388 = 1.019 → over 1
      const [lo, hi] = wilsonScoreInterval(49, 50);
      expect(hi).toBeLessThanOrEqual(1);
      expect(lo).toBeGreaterThan(0.8);
    });

    it('at k=0 the interval is bounded in [0, small]', () => {
      const [lo, hi] = wilsonScoreInterval(0, 50);
      expect(lo).toBe(0);
      expect(hi).toBeLessThan(0.15);
    });

    it('is symmetric for k and n-k around 0.5', () => {
      // Wilson is symmetric: CI(20/100) and CI(80/100) mirror across 0.5.
      const [lo1, hi1] = wilsonScoreInterval(20, 100);
      const [lo2, hi2] = wilsonScoreInterval(80, 100);
      expect(lo1 + hi2).toBeCloseTo(1, 5);
      expect(hi1 + lo2).toBeCloseTo(1, 5);
    });
  });

  describe('metricsFromConfusionMatrix (task 3.4)', () => {
    it('derives Se / Sp / PPV / NPV per DOMAIN.md formulas', () => {
      // TP=80, FP=10, TN=85, FN=20
      // Se = 80/100 = 0.8
      // Sp = 85/95 ≈ 0.8947
      // PPV = 80/90 ≈ 0.8889
      // NPV = 85/105 ≈ 0.8095
      const m = metricsFromConfusionMatrix({ tp: 80, fp: 10, tn: 85, fn: 20 });
      expect(m.sensitivity.point).toBeCloseTo(0.8, 4);
      expect(m.specificity.point).toBeCloseTo(0.8947, 3);
      expect(m.ppv.point).toBeCloseTo(0.8889, 3);
      expect(m.npv.point).toBeCloseTo(0.8095, 3);

      // Every CI must be bounded in [0,1]
      for (const met of [m.sensitivity, m.specificity, m.ppv, m.npv]) {
        expect(met.ci95[0]).toBeGreaterThanOrEqual(0);
        expect(met.ci95[1]).toBeLessThanOrEqual(1);
        expect(met.ci95[0]).toBeLessThan(met.ci95[1]);
      }
    });

    it('high-Sp scenario: Sp CI never overshoots 1', () => {
      // The motivating example from design D2.
      const m = metricsFromConfusionMatrix({ tp: 40, fp: 1, tn: 99, fn: 10 });
      expect(m.specificity.point).toBeCloseTo(99 / 100);
      expect(m.specificity.ci95[1]).toBeLessThanOrEqual(1);
    });
  });
});
