/**
 * L1.5-cohort-def — RED 阶段测试（新模块契约）。
 *
 * Acceptance: 同一数据库版本下任意两次重跑产出完全一致的队列（人数与患者
 * ID 集合 100% 一致），且判定规则文件带 git 版本标签。
 *
 * 目标模块 `cohort-definition` 尚不存在，整个套件红（Cannot find module）。
 * 这是 target contract：实现落地后这些测试应转绿。
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

const rows: InternalRecord[] = [
  rec({
    subjectKey: 'a1',
    medications: ['目标药'],
    adverseEvents: [{ organSystem: '肝', term: 'ALT升高', serious: false }],
  }),
  rec({ subjectKey: 'a2', medications: ['目标药'] }),
  rec({ subjectKey: 'p1', conditions: ['妊娠'] }),
  rec({ subjectKey: 'c1', ageBand: '0-9' }),
];

const analysis = {
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
  },
};

describe('cohort-definition — 可执行、可复现、带 git 版本', () => {
  it('同一输入两次重跑产出完全一致的队列（人数与患者 ID 集合 100% 一致）', () => {
    const def = resolveCohortDefinition(analysis);
    const first = selectCohort(rows, def);
    const second = selectCohort(rows, def);
    expect(second.count).toBe(first.count);
    expect(second.patientIds).toEqual(first.patientIds);
  });

  it('判定规则文件带 git 版本标签（短 SHA 或 semver tag）', () => {
    const def = resolveCohortDefinition(analysis);
    expect(def.version).toMatch(/^[0-9a-f]{7,40}$|^v?\d+\.\d+\.\d+$/);
    expect(def.id).toBeTruthy();
  });

  it('纳入/排除规则为结构化可执行判定，且可跨重跑复现同一患者集合', () => {
    const def = resolveCohortDefinition(analysis);
    const sel = selectCohort(rows, def);
    // age>=18 排除 c1（0-9 岁）;pregnancy 排除 p1;a1/a2 留下
    expect(sel.patientIds).toEqual(['a1', 'a2']);
    expect(sel.count).toBe(2);
  });
});
