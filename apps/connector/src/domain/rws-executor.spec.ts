import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { LocalStore } from './local-store';
import { disproportionalityTables, RwsExecutor } from './rws-executor';
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

const DRUG = '注射用紫杉醇';
const ae = (term: string) => [{ organSystem: '肝胆系统', term, serious: false }];

describe('disproportionalityTables — L1.5 全人群 2×2', () => {
  const cohort: InternalRecord[] = [
    rec({ medications: [DRUG], adverseEvents: ae('ALT升高') }),
    rec({ medications: [DRUG], adverseEvents: ae('ALT升高') }),
    rec({ medications: [DRUG] }),
    rec({ medications: ['其他药'], adverseEvents: ae('ALT升高') }),
    rec({ medications: ['其他药'] }),
    rec({ medications: ['其他药'] }),
  ];

  it('builds drug×event 2×2 with a=count and b/c/d on full cohort', () => {
    const out = disproportionalityTables(cohort, DRUG);
    expect(out.analysisType).toBe('disproportionality');
    expect(out.cohortSize).toBe(6);
    const alt = out.buckets.find((b) => b.key === 'ALT升高')!;
    expect(alt.count).toBe(2); // a: drug ∩ event
    expect(alt.b).toBe(1); // drug, no event
    expect(alt.c).toBe(1); // no drug, event
    expect(alt.d).toBe(2); // no drug, no event
  });

  it('requires drug of interest', () => {
    expect(() => disproportionalityTables(cohort, undefined)).toThrow('disproportionality 需指定 drug');
  });
});

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

  // AE 聚合的旧链用例已随 4.3 删除（新路径由 l01-equivalence + 平行性对拍 + demo 覆盖）。
  it('L1.5 disproportionality uses full population, not drug-filtered cohort', async () => {
    store.replaceAll([
      rec({ medications: [DRUG], adverseEvents: ae('ALT升高') }),
      rec({ medications: [DRUG], adverseEvents: ae('ALT升高') }),
      rec({ medications: [DRUG] }),
      rec({ medications: ['其他药'], adverseEvents: ae('ALT升高') }),
      rec({ medications: ['其他药'] }),
    ]);
    const out = await exec.run({ type: 'disproportionality', level: 'L1.5', drug: DRUG });
    expect(out.cohortSize).toBe(5);
    const alt = out.buckets.find((b) => b.key === 'ALT升高')!;
    expect(alt).toMatchObject({ count: 2, b: 1, c: 1, d: 1 });
  });

  it('L2 comparative-effect returns stratified 2×2 and effect estimate', async () => {
    store.replaceAll([
      rec({ ageBand: '40-49', medications: [DRUG], adverseEvents: ae('ALT升高') }),
      rec({ ageBand: '40-49', medications: [DRUG], adverseEvents: ae('ALT升高') }),
      rec({ ageBand: '40-49', medications: [DRUG] }),
      rec({ ageBand: '40-49', medications: ['其他药'], adverseEvents: ae('ALT升高') }),
      rec({ ageBand: '40-49', medications: ['其他药'] }),
      rec({ ageBand: '50-59', medications: [DRUG], adverseEvents: ae('ALT升高') }),
      rec({ ageBand: '50-59', medications: [DRUG] }),
      rec({ ageBand: '50-59', medications: ['其他药'] }),
    ]);
    const out = await exec.run({
      type: 'comparative-effect',
      level: 'L2',
      drug: DRUG,
      outcome: 'ALT升高',
    });
    expect(out.analysisType).toBe('comparative-effect');
    expect(out.buckets.length).toBeGreaterThanOrEqual(2);
    expect(out.effectEstimate?.covariance).toHaveLength(2);
  });
});
