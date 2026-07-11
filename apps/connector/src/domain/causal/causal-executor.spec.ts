import { AuditService } from '../audit';
import { LocalStore } from '../local-store';
import { InternalRecord, TteSpec } from '../types';
import { CausalExecutor } from './causal-executor';

const tte: TteSpec = {
  exposureArm: 'drug:目标药',
  comparatorArm: 'drug:对照药',
  timeZeroRule: 'index_date',
  inclusion: ['age>=18'],
  exclusion: [],
  outcome: { type: 'time_to_event', event: 'renal_failure' },
};

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk_test',
    ageBand: '50-59',
    sex: 'F',
    conditions: [],
    medications: ['目标药'],
    adverseEvents: [],
    followUpDays: 400,
    eventOccurred: true,
    ...over,
  };
}

describe('CausalExecutor', () => {
  it('runs causal-psm in TEE and returns ATE envelope', () => {
    const store = new LocalStore(new AuditService());
    store.ingest([
      rec({}),
      rec({ subjectKey: 'sk_2', medications: ['对照药'], eventOccurred: false, followUpDays: 200 }),
    ]);
    const exec = new CausalExecutor(store);
    const out = exec.run({ type: 'causal-psm', level: 'L3', tte }, 'task-1');
    expect(out.analysisType).toBe('causal-psm');
    expect(out.effectEstimate?.measure).toBe('ate');
    expect(out.cohortSize).toBe(2);
    expect(JSON.stringify(out)).not.toContain('subjectKey');
  });

  it('runs causal-survival with Cox echo and returns HR + KM', () => {
    const store = new LocalStore(new AuditService());
    store.ingest([rec({}), rec({ subjectKey: 'sk_2', medications: ['对照药'], eventOccurred: false })]);
    const exec = new CausalExecutor(store);
    const out = exec.run({ type: 'causal-survival', level: 'L3', tte, method: 'cox' }, 'task-2');
    expect(out.analysisType).toBe('causal-survival');
    expect(out.effectEstimate?.measure).toBe('log_hr');
    expect(out.kmCurve?.bins.length).toBeGreaterThan(0);
  });
});
