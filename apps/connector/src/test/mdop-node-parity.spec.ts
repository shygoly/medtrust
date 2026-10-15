/**
 * MDOP 节点的**分析侧等价性**：协议队列收窄（tte）与缺失值处理（missingness）必须发生在**投影之前**，
 * 且缺失值日志随聚合出域。对应 change `mdop-node-parity-enrichments`（旧链行为见 D10.5/D10.6）。
 */
import { AuditService } from '../domain/audit';
import { LocalStore } from '../domain/local-store';
import { createTestMdopExecutor } from './mdop-local-executor';
import type { InternalRecord, RwsAnalysis, TteSpec } from '../domain/types';

const DRUG = '注射用紫杉醇';

function rec(overrides: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 's1',
    ageBand: '40-49',
    sex: 'M',
    conditions: [],
    medications: [DRUG],
    adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }],
    ...overrides,
  } as InternalRecord;
}

const cohortTte = {
  exposureArm: `drug:${DRUG}`,
  comparatorArm: 'drug:对照药',
  timeZeroRule: 'index_date',
  inclusion: ['age>=18'],
  exclusion: ['pregnancy'],
  outcome: { type: 'time_to_event', event: 'renal_failure' },
} as unknown as TteSpec;

function build(rows: InternalRecord[]) {
  const audit = new AuditService();
  const store = new LocalStore(audit);
  store.replaceAll(rows);
  return createTestMdopExecutor({
    id: 'spec-parity',
    store,
    categoryKeys: ['0-9', '40-49'],
    strataKeys: ['0-9', '40-49'],
  });
}

describe('MDOP 节点 分析侧等价性（协议队列 / 缺失值处理）', () => {
  it('协议队列：tte 的纳入/排除在计数之前生效', async () => {
    const exec = build([
      rec({ subjectKey: 'adult-1' }),
      rec({ subjectKey: 'minor-1', ageBand: '0-9' }),
      rec({ subjectKey: 'pregnant-1', conditions: ['妊娠'] }),
    ]);
    const out = await exec.run({
      type: 'cohort-count',
      level: 'L1.5',
      tte: cohortTte,
    } as unknown as RwsAnalysis);
    // 成年人 1 名：未成年被纳入标准排除、妊娠者被排除标准排除。
    if (out.cohortSize !== 1) throw new Error(`队列未收窄：cohortSize=${out.cohortSize}（期望 1）`);
    // 分带计数不再断言具体值：MDOP 路径会做小格抑制（<minCell 的格计 0），与旧链计数口径不同；
    // 本用例只验「队列在计数之前被收窄」这一件事（分带口径由 synthea demo 覆盖）。
  });

  it('缺失值处理：声明策略时聚合带 missingnessLog，并逐字记录声明', async () => {
    const exec = build([rec({ subjectKey: 'r1' }), rec({ subjectKey: 'r2' })]);
    const out = await exec.run({
      type: 'cohort-count',
      level: 'L1.5',
      missingness: { mechanism: 'MAR', imputationStrategy: '多重插补(MI), m=10' },
    } as unknown as RwsAnalysis);
    const log = (out as unknown as { missingnessLog?: Record<string, unknown> }).missingnessLog;
    if (!log) throw new Error('未挂 missingnessLog');
    if (log.appliedStrategy !== 'multiple_imputation')
      throw new Error(`策略未如实记录：${String(log.appliedStrategy)}`);
    const flat = JSON.stringify(log);
    if (!flat.includes('多重插补')) throw new Error('日志未逐字保留 SAP 声明');
  });

  it('未声明：不产 missingnessLog（行为不变）', async () => {
    const exec = build([rec({})]);
    const out = await exec.run({ type: 'cohort-count', level: 'L1.5' } as unknown as RwsAnalysis);
    const log = (out as unknown as { missingnessLog?: unknown }).missingnessLog;
    if (log !== undefined) throw new Error('未声明却产了 missingnessLog');
  });
});
