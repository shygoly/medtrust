import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { LocalStore } from './local-store';
import { RwsExecutor } from './rws-executor';
import { InternalRecord } from './types';

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random(),
    ageBand: '40-49',
    conditions: [],
    medications: ['注射用紫杉醇'],
    adverseEvents: [],
    ...over,
  };
}

describe('RwsExecutor — 本地执行,仅出聚合', () => {
  let store: LocalStore;
  let exec: RwsExecutor;
  beforeEach(() => {
    store = new LocalStore(new AuditService());
    exec = new RwsExecutor(store, new Deidentifier());
    store.ingest([
      rec({ adverseEvents: [{ organSystem: '肝胆系统', term: 'ALT', serious: false }] }),
      rec({ adverseEvents: [{ organSystem: '肝胆系统', term: 'AST', serious: true }] }),
      rec({ adverseEvents: [{ organSystem: '血液系统', term: '白细胞↓', serious: false }] }),
      rec({ medications: ['其他药'] }), // outside the cohort
    ]);
  });

  it('aggregates adverse-event signals over the drug cohort', () => {
    const out = exec.run({ type: 'adverse-event-signal', drug: '注射用紫杉醇' });
    expect(out.cohortSize).toBe(3); // 4th is on a different drug
    const liver = out.buckets.find((b) => b.key === '肝胆系统');
    expect(liver?.count).toBe(2);
  });

  it('emits no row-level identifiers in the aggregate', () => {
    const out = exec.run({ type: 'adverse-event-signal', drug: '注射用紫杉醇' });
    const json = JSON.stringify(out);
    expect(json).not.toContain('subjectKey');
    expect(json).not.toContain('sk_');
  });
});
