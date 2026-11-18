/**
 * L1.5-cohort-def — RED 阶段测试。
 *
 * Gap: 队列纳入/排除标准仅存在于文本协议（`tte.inclusion` / `tte.exclusion`
 * 为 string[]），未转成可执行的结构化判定规则；`causal-materializer` 的
 * `matchesRule` 对 `age>=`/`ckd_stage>=` 直接返回 true（no-op），L1.5
 * `disproportionalityTables` 完全无视协议队列定义。结果：L1.5 与下游层级
 * 无法复现同一队列。
 *
 * 这些用例全部锚定既有代码的当前缺陷，均为断言级失败（is_assertion_failure）。
 */
import { materializeCausalCohort } from './causal/causal-materializer';
import { AuditService } from './audit';
import { Deidentifier } from './deidentifier';
import { LocalStore } from './local-store';
import { createTestMdopExecutor } from '../test/mdop-local-executor';
import { InternalRecord, TteSpec } from './types';

const DRUG = '注射用紫杉醇';
const ae = (term: string) => [{ organSystem: '肝胆系统', term, serious: false }];

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk-' + Math.random(),
    ageBand: '40-49',
    sex: 'M',
    conditions: [],
    medications: [DRUG],
    adverseEvents: [],
    ...over,
  };
}

const cohortTte: TteSpec = {
  exposureArm: `drug:${DRUG}`,
  comparatorArm: 'drug:对照药',
  timeZeroRule: 'index_date',
  inclusion: ['age>=18'],
  exclusion: ['pregnancy'],
  outcome: { type: 'time_to_event', event: 'renal_failure' },
};

describe('L1.5-cohort-def — 协议队列纳入/排除必须被可执行判定', () => {
  it('inclusion `age>=18` 必须排除未成年患者（当前 matchesRule 为 no-op）', () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'adult-1', ageBand: '40-49' }),
      rec({ subjectKey: 'child-1', ageBand: '0-9' }),
    ];
    const cohort = materializeCausalCohort(rows, cohortTte);
    // 期望仅 adult-1 留下;当前实现把 child-1 也放进来 → length=2
    expect(cohort).toHaveLength(1);
  });

  it('exclusion `pregnancy` 必须排除妊娠患者', () => {
    const rows: InternalRecord[] = [
      rec({ subjectKey: 'adult-1' }),
      rec({ subjectKey: 'pregnant-1', conditions: ['妊娠'] }),
    ];
    const cohort = materializeCausalCohort(rows, cohortTte);
    // 期望仅 adult-1 留下;当前 matchesRule 只对条件含“妊娠”的患者判定 → length=2
    expect(cohort).toHaveLength(1);
  });

  it('L1.5 失衡信号必须复现协议队列（应用 age>=18 + 排除 pregnancy），而非全人群', async () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    // 已迁 MDOP：队列收窄由节点按**计划阶段参数**里的声明在投影前应用（change mdop-node-parity-enrichments）。
    const exec = createTestMdopExecutor({ id: 'spec-cohort-gap', store, localL15: true });
    store.replaceAll([
      rec({ subjectKey: 'adult-1', medications: [DRUG], adverseEvents: ae('ALT升高') }),
      rec({ subjectKey: 'pregnant-1', medications: [DRUG], conditions: ['妊娠'], adverseEvents: ae('ALT升高') }),
      rec({ subjectKey: 'child-1', medications: [DRUG], ageBand: '0-9', adverseEvents: ae('ALT升高') }),
    ]);
    const out = await exec.run({
      type: 'disproportionality',
      level: 'L1.5',
      drug: DRUG,
      designType: 'cohort',
      rationale: '按纳入排除协议筛选后的失衡检测',
      tte: cohortTte,
    });
    // 期望队列只含 adult-1;当前实现返回全人群 3 人
    expect(out.cohortSize).toBe(1);
    // 计数口径：MDOP 路径做小格抑制（<minCell 的格计 0）；本用例只验队列被收窄这一件事。
    expect(out.buckets.length).toBeGreaterThan(0);
  });
});
