import { AuditService } from './audit';
import { LocalStore, RawAccessDeniedError } from './local-store';
import { InternalRecord } from './types';

const rec: InternalRecord = {
  subjectKey: 'sk_abc',
  ageBand: '30-39',
  sex: 'male',
  conditions: [],
  medications: ['注射用紫杉醇'],
  adverseEvents: [{ organSystem: '肝胆系统', term: 'ALT 升高', serious: false }],
};

describe('LocalStore — 原始数据不出域守卫 (3.4)', () => {
  let audit: AuditService;
  let store: LocalStore;
  beforeEach(() => {
    audit = new AuditService();
    store = new LocalStore(audit);
    store.ingest([rec, { ...rec, subjectKey: 'sk_def' }]);
  });

  it('blocks external raw read and records an audit entry', () => {
    expect(() => store.exportRaw({ origin: 'external', actor: '创新药企' })).toThrow(RawAccessDeniedError);
    const blocked = audit.blocked();
    expect(blocked).toHaveLength(1);
    expect(blocked[0].action).toBe('raw-read-blocked');
    expect(blocked[0].actor).toBe('创新药企');
  });

  it('allows internal aggregate compute and returns only derived values', () => {
    const n = store.aggregateInternal({ origin: 'internal', actor: 'rws' }, (rows) => rows.length);
    expect(n).toBe(2);
  });

  it('refuses compute from a non-internal context', () => {
    expect(() =>
      store.aggregateInternal({ origin: 'external', actor: 'x' }, (rows) => rows.length),
    ).toThrow(RawAccessDeniedError);
  });
});
