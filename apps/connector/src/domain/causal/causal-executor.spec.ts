import { AuditService } from '../audit';
import { LocalStore } from '../local-store';
import { InternalRecord, TteSpec } from '../types';
import { SoftwareSealedCompute } from '../tee';
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
  it('runs causal-psm in TEE and returns ATE envelope', async () => {
    const store = new LocalStore(new AuditService());
    store.ingest([
      rec({}),
      rec({ subjectKey: 'sk_2', medications: ['对照药'], eventOccurred: false, followUpDays: 200 }),
    ]);
    const exec = new CausalExecutor(store);
    const out = await exec.run({ type: 'causal-psm', level: 'L3', tte }, 'task-1');
    expect(out.analysisType).toBe('causal-psm');
    expect(out.effectEstimate?.measure).toBe('ate');
    expect(out.cohortSize).toBe(2);
    expect(JSON.stringify(out)).not.toContain('subjectKey');
  });

  it('runs causal-survival with Cox echo and returns HR + KM', async () => {
    const store = new LocalStore(new AuditService());
    store.ingest([rec({}), rec({ subjectKey: 'sk_2', medications: ['对照药'], eventOccurred: false })]);
    const exec = new CausalExecutor(store);
    const out = await exec.run({ type: 'causal-survival', level: 'L3', tte, method: 'cox' }, 'task-2');
    expect(out.analysisType).toBe('causal-survival');
    expect(out.effectEstimate?.measure).toBe('log_hr');
    expect(out.kmCurve?.bins.length).toBeGreaterThan(0);
  });

  it('uses injected backend, not Echo constants', async () => {
    const store = new LocalStore(new AuditService());
    store.ingest([
      rec({}),
      rec({ subjectKey: 'sk_2', medications: ['对照药'], eventOccurred: false }),
    ]);
    const backend = {
      runLocalCausal: async () => ({
        analysisType: 'causal-psm' as const,
        cohortSize: 2,
        buckets: [],
        effectEstimate: {
          measure: 'ate' as const,
          beta: 0.42,
          standardError: 0.01,
          ci95: [0.4, 0.44] as [number, number],
        },
      }),
    };
    const exec = new CausalExecutor(store, new SoftwareSealedCompute(), backend);
    const out = await exec.run({ type: 'causal-psm', level: 'L3', tte }, 'task-agent');
    expect(out.effectEstimate?.beta).toBe(0.42);
  });
});
