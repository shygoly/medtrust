/**
 * L1.5-cohort-def — RED 阶段补充测试（当前实现仍存在的可复现性缺口）。
 *
 * Acceptance: 同一数据库版本下任意两次重跑产出完全一致的队列（人数与患者
 * ID 集合 100% 一致），且判定规则文件带 git 版本标签。
 *
 * 目标缺陷（均为断言级失败）：
 *   1. `selectCohort` 保留输入行序 —— 同一数据库两次重跑若物理行序不同，
 *      队列 patientIds 数组顺序不同，未达到「患者 ID 集合 100% 一致」。
 *   2. `selectCohort` 按「行」计数而非按「唯一患者」计数 —— 同一条 subjectKey
 *      出现多次时，人数 ≠ 患者 ID 集合大小，违反「人数与患者 ID 集合」语义。
 *   3. 未知文法的排除规则 fail-open —— `evaluateCohortRule` 对未知文法返回
 *      false，排除路径 `.some(...)` 直接放行，记录静默混入队列，违反模块
 *      自身声明的「未知文法 fail-closed：不得让记录静默混入队列」契约。
 */
import { selectCohort, resolveCohortDefinition } from './cohort-definition';
import { InternalRecord } from './types';

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk-' + Math.random(),
    ageBand: '40-49',
    sex: 'M',
    conditions: [],
    medications: [],
    adverseEvents: [],
    ...over,
  };
}

const adult = rec({ subjectKey: 'adult-1', ageBand: '40-49' });
const otherAdult = rec({ subjectKey: 'adult-2', ageBand: '50-59', sex: 'F' });
const child = rec({ subjectKey: 'child-1', ageBand: '0-9' });
const pregnant = rec({ subjectKey: 'pregnant-1', ageBand: '30-39', sex: 'F', conditions: ['妊娠'] });

function analysisWith(tte: Record<string, unknown>) {
  return {
    type: 'disproportionality',
    level: 'L1.5',
    drug: '目标药',
    tte: {
      exposureArm: 'drug:目标药',
      comparatorArm: 'drug:对照药',
      timeZeroRule: 'index_date',
      inclusion: ['age>=18'],
      exclusion: ['pregnancy'],
      outcome: { type: 'time_to_event' as const, event: 'renal_failure' },
      ...tte,
    },
  };
}

const agePregnancyAnalysis = analysisWith({});

describe('L1.5-cohort-def — 队列可复现性（人数与患者 ID 集合 100% 一致）', () => {
  it('同一数据库两次重跑（行序不同、数据相同）产出完全一致的队列', () => {
    const def = resolveCohortDefinition(agePregnancyAnalysis);
    // 两次重跑读到同一批患者，但物理行序不同（无 ORDER BY 的常见情形）。
    const rowsA = [adult, otherAdult, child, pregnant];
    const rowsB = [pregnant, child, otherAdult, adult];
    const first = selectCohort(rowsA, def);
    const second = selectCohort(rowsB, def);
    expect(first.count).toBe(second.count); // 2 === 2（人数一致）
    // 患者 ID 集合必须 100% 一致，与读取行序无关。
    expect(first.patientIds).toEqual(second.patientIds);
  });

  it('同一患者多条记录只计一次：人数 = 患者 ID 集合大小，ID 集合无重复', () => {
    const def = resolveCohortDefinition(agePregnancyAnalysis);
    const rows = [
      rec({ subjectKey: 'p1' }),
      rec({ subjectKey: 'p1' }),
      rec({ subjectKey: 'p2' }),
    ];
    const sel = selectCohort(rows, def);
    // 「患者 ID 集合」语义：同一 subjectKey 只计一次。
    expect(sel.count).toBe(new Set(sel.patientIds).size);
    expect(sel.count).toBe(2);
  });

  it('无法识别的排除规则必须 fail-closed，不得让记录静默混入队列', () => {
    const def = resolveCohortDefinition(
      analysisWith({ inclusion: [], exclusion: ['unsupported-grammar'] }),
    );
    const rows = [adult, otherAdult];
    const sel = selectCohort(rows, def);
    // 排除规则文法无法验证 → 无法证明记录符合排除 → 保守起见不应进入队列。
    expect(sel.count).toBe(0);
  });

  it('返回的 patientIds 必须是无重复的患者 ID 集合（同一患者只计一次）', () => {
    const def = resolveCohortDefinition(agePregnancyAnalysis);
    const rows = [
      rec({ subjectKey: 'p1' }),
      rec({ subjectKey: 'p1' }),
      rec({ subjectKey: 'p2' }),
    ];
    const sel = selectCohort(rows, def);
    // 「患者 ID 集合」语义：输出里同一 subjectKey 只能出现一次。
    expect(sel.patientIds).toHaveLength(new Set(sel.patientIds).size);
    expect(sel.patientIds).toEqual(['p1', 'p2']);
  });
});
