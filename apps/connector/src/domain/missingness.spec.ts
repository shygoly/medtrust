import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { LocalStore } from './local-store';
import { RwsExecutor } from './rws-executor';
import { AggregateResult, InternalRecord, RwsAnalysis } from './types';

/**
 * L2-missing-data (rws-study-protocol-spec §3.4).
 *
 * Acceptance: 缺失处理日志与 SAP 一致 — the executed missing-data handling
 * (multiple imputation vs complete case) MUST be recorded on the aggregate and
 * MUST match the `missingness` declared in the SAP. No silent mixing of
 * 多重插补 / 完全病例.
 *
 * These tests are RED: RwsExecutor currently never consults
 * `analysis.missingness` and never attaches a `missingnessLog` to the
 * AggregateResult, so every assertion below fails.
 */

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

/** Shape the missing-data handling log MUST expose (§3.4, acceptance). */
interface MissingnessLogLike {
  mechanism: 'MCAR' | 'MAR' | 'MNAR';
  declaredStrategy: string;
  appliedStrategy: 'multiple_imputation' | 'complete_case' | 'none';
  rowsBefore?: number;
  rowsAfter?: number;
  droppedRows?: number;
  imputationsPerformed?: number;
}

function missingnessLog(result: AggregateResult): MissingnessLogLike | undefined {
  return (
    result as unknown as { missingnessLog?: MissingnessLogLike }
  ).missingnessLog;
}

type Mechanism = 'MCAR' | 'MAR' | 'MNAR';

/**
 * Build an L2 comparative-effect analysis carrying the SAP §3.4 missingness
 * declaration. `RwsAnalysis` in this baseline has no `missingness` field, so
 * the declaration is carried through the runtime shape; the RED assertions are
 * on the execution side (the aggregate MUST gain a missingnessLog).
 */
function l2Analysis(mechanism: Mechanism, strategy: string): RwsAnalysis {
  return {
    type: 'comparative-effect',
    level: 'L2',
    drug: DRUG,
    outcome: 'ALT升高',
    stratifyBy: ['ageBand', 'sex'],
    missingness: { mechanism, imputationStrategy: strategy },
  } as unknown as RwsAnalysis;
}

describe('L2-missing-data — 缺失处理日志与 SAP 一致 (§3.4)', () => {
  let store: LocalStore;
  let exec: RwsExecutor;

  beforeEach(() => {
    store = new LocalStore(new AuditService());
    exec = new RwsExecutor(store, new Deidentifier());
    // Cohort with missing values: three rows have no `sex` (undefined), i.e.
    // incomplete cases for a sex-stratified comparative-effect analysis.
    store.replaceAll([
      rec({ ageBand: '40-49', sex: 'F', medications: [DRUG], adverseEvents: ae('ALT升高') }),
      rec({ ageBand: '40-49', sex: 'M', medications: [DRUG], adverseEvents: ae('ALT升高') }),
      rec({ ageBand: '40-49', sex: undefined, medications: [DRUG], adverseEvents: ae('ALT升高') }),
      rec({ ageBand: '40-49', sex: undefined, medications: ['其他药'] }),
      rec({ ageBand: '40-49', sex: 'F', medications: ['其他药'] }),
      rec({ ageBand: '40-49', sex: 'M', medications: ['其他药'], adverseEvents: ae('ALT升高') }),
    ]);
  });

  it('records a missingness log when the SAP declares a missingness strategy', () => {
    const out = exec.run(l2Analysis('MAR', '多重插补(MI)'));
    // Currently no log is attached → undefined → assertion fails.
    expect(missingnessLog(out)).toBeDefined();
  });

  it('records the SAP-declared mechanism (MNAR) in the missingness log', () => {
    const out = exec.run(l2Analysis('MNAR', 'complete case'));
    const log = missingnessLog(out);
    expect(log && log.mechanism).toBe('MNAR');
  });

  it('applies multiple_imputation when the SAP declares 多重插补', () => {
    const out = exec.run(l2Analysis('MAR', '多重插补(MI), m=10'));
    const log = missingnessLog(out);
    // Fails: log is undefined. Once implemented, this also guards against
    // silently defaulting to complete-case (the 混用 red line).
    expect(log && log.appliedStrategy).toBe('multiple_imputation');
  });

  it('records the SAP-declared imputation strategy verbatim so the log can be reconciled (§3.4 与 SAP 一致)', () => {
    const out = exec.run(l2Analysis('MAR', '多重插补(MI), m=10'));
    const log = missingnessLog(out);
    // Fails: log is undefined. Once implemented, the executed strategy MUST be
    // traceable back to the exact SAP declaration (no 混用, no drift).
    expect(log && log.declaredStrategy).toBe('多重插补(MI), m=10');
  });

  it('records imputation activity when multiple_imputation is applied to incomplete cases', () => {
    const out = exec.run(l2Analysis('MAR', '多重插补(MI), m=10'));
    const log = missingnessLog(out);
    expect(log && typeof log.imputationsPerformed).toBe('number');
  });

  it('applies complete_case when the SAP declares complete case', () => {
    const out = exec.run(l2Analysis('MCAR', 'complete case (CC)'));
    const log = missingnessLog(out);
    expect(log && log.appliedStrategy).toBe('complete_case');
  });

  it('records the number of dropped incomplete cases under a complete-case strategy', () => {
    const out = exec.run(l2Analysis('MCAR', 'complete case (CC)'));
    const log = missingnessLog(out);
    expect(log && typeof log.droppedRows).toBe('number');
  });
});
