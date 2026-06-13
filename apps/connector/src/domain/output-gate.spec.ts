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
});
