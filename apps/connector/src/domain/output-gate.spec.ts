import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { OutputGate, OutputBlocked } from './output-gate';
import { AggregateResult } from './types';

const aggregate: AggregateResult = {
  analysisType: 'adverse-event-signal',
  cohortSize: 100,
  buckets: [
    { key: '神经系统', count: 20, rate: 0.2 },
    { key: '肝胆系统', count: 3, rate: 0.03 }, // small cell — must be suppressed
  ],
};

describe('OutputGate — 输出闸门 (5.3/5.4)', () => {
  let audit: AuditService;
  let gate: OutputGate;
  beforeEach(() => {
    audit = new AuditService();
    gate = new OutputGate(audit, new Deidentifier());
  });

  it('5.3 suppresses small cells below the threshold', () => {
    const out = gate.pass(aggregate, 5);
    const liver = out.buckets.find((b) => b.key === '肝胆系统')!;
    expect(liver.suppressed).toBe(true);
    expect(liver.count).toBe(0);
    const neuro = out.buckets.find((b) => b.key === '神经系统')!;
    expect(neuro.count).toBe(20); // above threshold, untouched
    expect(audit.all().some((e) => e.action === 'small-cell-suppression')).toBe(true);
  });

  it('5.3 suppresses a 2×2 disproportionality cell and zeros b/c/d', () => {
    const dispro: AggregateResult = {
      analysisType: 'disproportionality',
      cohortSize: 100,
      buckets: [{ key: 'ALT升高', count: 2, rate: 0.02, b: 3, c: 1, d: 94 }],
    };
    const out = gate.pass(dispro, 5);
    const cell = out.buckets[0];
    expect(cell.suppressed).toBe(true);
    expect(cell.count).toBe(0);
    expect(cell.b).toBe(0);
    expect(cell.c).toBe(0);
    expect(cell.d).toBe(0);
  });

  it('L2 suppresses stratum below sample threshold and recomputes effect', () => {
    const l2: AggregateResult = {
      analysisType: 'comparative-effect',
      cohortSize: 30,
      outcome: 'ALT升高',
      buckets: [
        { key: '40-49', count: 4, rate: 0.2, b: 10, c: 2, d: 4 }, // n=20
        { key: '50-59', count: 1, rate: 0.25, b: 1, c: 0, d: 2 }, // n=4 < 5
      ],
      effectEstimate: {
        measure: 'log_or',
        beta: 0.9,
        standardError: 0.3,
        covariance: [
          [0, 0],
          [0, 0.09],
        ],
        ci95: [0.3, 1.5],
        mantelHaenszel: {
          logOr: 0.9,
          or: Math.exp(0.9),
          standardError: 0.3,
          ci95: [0.3, 1.5],
        },
      },
    };
    const out = gate.pass(l2, 5);
    const small = out.buckets.find((b) => b.key === '50-59')!;
    expect(small.suppressed).toBe(true);
    expect(small.count).toBe(0);
    expect(out.effectEstimate?.beta).not.toBe(0.9);
    expect(audit.all().some((e) => e.action === 'stratum-suppression')).toBe(true);
  });

  it('L2 clears effect when all strata suppressed', () => {
    const l2: AggregateResult = {
      analysisType: 'comparative-effect',
      cohortSize: 6,
      buckets: [{ key: '40-49', count: 1, rate: 0.25, b: 1, c: 1, d: 1 }],
      effectEstimate: {
        measure: 'log_or',
        beta: 0.5,
        standardError: 0.2,
        covariance: [
          [0, 0],
          [0, 0.04],
        ],
        ci95: [0.1, 0.9],
        mantelHaenszel: {
          logOr: 0.5,
          or: Math.exp(0.5),
          standardError: 0.2,
          ci95: [0.1, 0.9],
        },
      },
    };
    const out = gate.pass(l2, 5);
    expect(out.buckets[0].suppressed).toBe(true);
    expect(out.effectEstimate).toBeUndefined();
  });

  it('5.4 blocks output containing row-level pseudonymous keys', () => {
    const rowLevel = { rows: [{ subjectKey: 'sk_abc', ageBand: '30-39' }] };
    expect(() => gate.pass(rowLevel)).toThrow(OutputBlocked);
    expect(audit.blocked()[0].action).toBe('output-blocked');
  });

  it('5.4 blocks output containing a direct identifier', () => {
    const leaky = { ...aggregate, note: 'patientId leaked', buckets: aggregate.buckets } as unknown;
    // craft an object that literally carries a direct-identifier key
    const withId = { patientId: '310101', ...aggregate };
    expect(() => gate.pass(withId)).toThrow(OutputBlocked);
    void leaky;
  });

  describe('passValidation — L0 algorithm-validation gate (D3 / tasks 4.1–4.4)', () => {
    const ctx = {
      algorithmId: 'dm2-v1',
      algorithmVersion: '1.0.0',
      providerId: 'hospital-a',
      variableDefinitionId: 'dm2',
      goldStandardSetVersion: 'gs-v1',
    };

    it('emits all four metrics when every cell ≥ threshold', () => {
      const cm = { tp: 80, fp: 10, tn: 85, fn: 20 };
      const out = gate.passValidation(cm, ctx);
      expect(out.suppressed).toBe(false);
      expect(out.suppressionReason).toBeUndefined();
      expect(out.metrics).toBeDefined();
      expect(out.metrics!.sensitivity.point).toBeCloseTo(0.8, 3);
      expect(out.metrics!.specificity.point).toBeCloseTo(0.8947, 3);
      // confusion matrix returned intact
      expect(out.confusionMatrix).toEqual(cm);
    });

    it('CRITICAL: a single cell below threshold blocks ALL four metrics (fail-closed)', () => {
      // fn=3 < threshold(5). Must withhold Se/Sp/PPV/NPV entirely.
      const cm = { tp: 80, fp: 10, tn: 85, fn: 3 };
      const out = gate.passValidation(cm, ctx);
      expect(out.suppressed).toBe(true);
      expect(out.suppressionReason).toBe('insufficient_sample');
      expect(out.metrics).toBeUndefined();
      // suppressed cells are zeroed in the returned matrix
      expect(out.confusionMatrix).toEqual({ tp: 0, fp: 0, tn: 0, fn: 0 });
    });

    it('records the suppression in the audit log exactly once', () => {
      const cm = { tp: 80, fp: 10, tn: 85, fn: 3 };
      gate.passValidation(cm, ctx);
      const events = audit.all().filter((e) => e.action === 'validation-suppressed');
      expect(events).toHaveLength(1);
      expect(events[0].detail).toMatch(/fail-closed/);
    });

    it('suppressed result is structurally distinct from poor accuracy', () => {
      // Same FN count, but the second case has all cells ≥ threshold and
      // terrible specificity. The two return shapes MUST differ on
      // `suppressed` / `metrics`, not on metric magnitudes.
      const suppressed = gate.passValidation({ tp: 80, fp: 10, tn: 85, fn: 3 }, ctx);
      const poorButReleased = gate.passValidation({ tp: 5, fp: 95, tn: 5, fn: 95 }, ctx);
      expect(suppressed.suppressed).toBe(true);
      expect(suppressed.metrics).toBeUndefined();
      expect(poorButReleased.suppressed).toBe(false);
      expect(poorButReleased.metrics).toBeDefined();
      expect(poorButReleased.metrics!.specificity.point).toBeLessThan(0.1);
    });
  });
});
