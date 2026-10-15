import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditService } from '../../domain/audit';
import { Deidentifier } from '../../domain/deidentifier';
import { LocalStore } from '../../domain/local-store';
import { matchesMedication } from '../../domain/clinical-matching';
import { RwsExecutor, adverseEventSignalTables, cohortCountTables, conditionPrevalenceTables } from '../../domain/rws-executor';
import type { InternalRecord } from '../../domain/types';
import {
  categoricalCountFromSandboxOutput,
  projectCategoricalCount,
  type CategoricalCountProjection,
} from './categorical-count-sandbox';
import {
  aeSignalProjection,
  listCategoriesProjection,
  scalarCategoryProjection,
} from '../operators/seal';

/**
 * **对拍证据**（批次 2 design D2 的第五件套）：旧链三型 vs 新路径逐字段比。
 *
 * 口径（design D6）：三型是同一件事 —— 「按分类字段计数**出现次数**」。两份实现（旧链本地聚合 /
 * 新路径「封存投影 -> categorical-count 模块 -> 回填」）用同一组夹具同时跑，逐字段比：
 *  - **分类计数**（buckets）；
 *  - **记录数分母**（旧链 cohortSize 的对应物，率的分母）；
 *  - **队列过滤**（按目标药过滤，旧链 matchesMedication 的口径）。
 *
 * 夹具刻意包含：重复行、多标签行、无标签行、多事件行、**不取目标药的行**（测过滤）。
 */

const BUILD = join(__dirname, '../../../../../packages/wasm-algorithms/build');
const manifest = JSON.parse(readFileSync(join(BUILD, 'manifest.json'), 'utf8')) as {
  modules: Array<{ analysisType: string; file: string }>;
};

function runModule(projection: CategoricalCountProjection): Uint8Array {
  const entry = manifest.modules.find((m) => m.analysisType === 'categorical-count')!;
  const bytes = readFileSync(join(BUILD, entry.file));
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
  });
  const inOff = 1024;
  new Uint8Array(memory.buffer).set(projection.input, inOff);
  const outOff = inOff + projection.outOff;
  const run = instance.exports.run as (
    a: number,
    b: number,
    c: number,
    d: number,
  ) => number;
  const code = run(inOff, projection.n, projection.categories, outOff);
  if (code !== 0) throw new Error('module returned ' + code);
  return new Uint8Array(memory.buffer, outOff, projection.outBytes).slice();
}

/** 新路径：分类行 -> 模块 -> 回填（按 key 排序返回）。 */
function newPath(
  rows: Array<{ category: string }>,
  categoryKeys: string[],
): Array<{ key: string; count: number }> {
  const projection = projectCategoricalCount({ rows, categoryKeys });
  const counted = categoricalCountFromSandboxOutput({
    projection,
    output: runModule(projection),
  });
  return [...counted.buckets].sort((a: { key: string }, b: { key: string }) =>
    a.key.localeCompare(b.key),
  );
}

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
/** 旧链 matchesMedication 的过滤口径：medications 列表须含目标药。 */
const FILTER = { field: 'medications', value: DRUG };

const FIXTURE: InternalRecord[] = [
  rec({ subjectKey: 'lk-1', ageBand: '40-49', conditions: ['糖尿病'] }),
  rec({ subjectKey: 'lk-1', ageBand: '40-49', conditions: ['糖尿病'] }), // 重复行
  rec({ subjectKey: 'lk-2', ageBand: '50-59', conditions: ['高血压', '糖尿病'] }),
  rec({ subjectKey: 'lk-3', ageBand: '50-59', conditions: [] }), // 无标签 -> 占位
  rec({
    subjectKey: 'lk-4',
    ageBand: '60-69',
    adverseEvents: [
      { organSystem: '肝胆系统', term: 'ALT', serious: false },
      { organSystem: '肝胆系统', term: 'AST', serious: true },
      { organSystem: '血液系统', term: '白细胞', serious: false },
    ],
  }),
  rec({ subjectKey: 'lk-5', ageBand: '70-79' }),
  // 不取目标药：过滤参数必须把它排除（旧链 matchesMedication 的口径）
  rec({ subjectKey: 'lk-6', ageBand: '80-89', conditions: ['糖尿病'], medications: ['其他药'] }),
];

type L01Type = 'cohort-count' | 'condition-prevalence' | 'adverse-event-signal';

async function oldPath(type: L01Type) {
  const store = new LocalStore(new AuditService());
  store.ingest(FIXTURE);
  // AE 与 cohort-count 的旧链分发已随 4.3 删除：口径以导出的**参照函数**保留（台账 `retained: test-reference`）。
  if (type === 'adverse-event-signal')
    return store.aggregateInternal({ origin: 'internal', actor: 'parity' }, (rows) =>
      adverseEventSignalTables(rows, DRUG),
    );
  if (type === 'cohort-count')
    // 旧分发的 `cohort` 已按目标药过滤（matchesMedication 口径）：参照侧必须同样过滤，
    // 否则不取目标药的那一行会把分母算大。
    return store.aggregateInternal({ origin: 'internal', actor: 'parity' }, (rows) =>
      cohortCountTables(rows.filter((r) => matchesMedication(r.medications, DRUG))),
    );
  if (type === 'condition-prevalence')
    // 同 cohort-count：旧分发的 cohort 已按目标药过滤，参照侧同口径。
    return store.aggregateInternal({ origin: 'internal', actor: 'parity' }, (rows) =>
      conditionPrevalenceTables(rows.filter((r) => matchesMedication(r.medications, DRUG))),
    );
  const exec = new RwsExecutor(store, new Deidentifier());
  return exec.run({ type, drug: DRUG });
}

function countsOf(
  buckets: Array<{ key: string; count: number }>,
): Array<{ key: string; count: number }> {
  return [...buckets]
    .map((b) => ({ key: b.key, count: b.count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

type Projected = { rows: Array<{ category: string }>; records: number };

function asProjected(x: Record<string, unknown>): Projected {
  return x as unknown as Projected;
}

function linkRows(select: (r: InternalRecord) => Record<string, unknown>) {
  return FIXTURE.map((r) => ({ linkKey: r.subjectKey, ...select(r) }));
}

describe('批次 2 对拍：旧链三型 vs 新路径（投影 -> categorical-count）', () => {
  it('cohort-count：计数 + 分母 + 按药过滤 全部逐字段一致', async () => {
    const old = await oldPath('cohort-count');
    const projected = asProjected(scalarCategoryProjection(
      { rows: linkRows((r) => ({ ageBand: r.ageBand, medications: r.medications })) },
      'ageBand',
      FILTER,
    ));
    const rows = projected.rows;
    const keys = [...new Set((old.buckets as Array<{ key: string }>).map((b) => b.key))].sort();
    expect(newPath(rows, keys)).toEqual(
      countsOf(old.buckets as Array<{ key: string; count: number }>),
    );
    // 分母：过滤后记录数 = 旧链 cohortSize（本型一行一记录）
    expect(projected.records).toBe(old.cohortSize);
    // 重复行各算一次；不取药的行被排除
    expect(rows.filter((r) => r.category === '40-49')).toHaveLength(2);
    expect(keys).not.toContain('80-89');
    // 派生量 rate 可用新路径的分母复现
    for (const b of old.buckets as Array<{ count: number; rate: number }>) {
      expect(b.rate).toBeCloseTo(Number((b.count / projected.records).toFixed(4)), 4);
    }
  });

  it('condition-prevalence：多标签各计一次 + 占位 + 分母 + 过滤 一致', async () => {
    const old = await oldPath('condition-prevalence');
    const projected = asProjected(listCategoriesProjection(
      { rows: linkRows((r) => ({ conditions: r.conditions, medications: r.medications })) },
      'conditions',
      '无明确慢病标签',
      FILTER,
    ));
    const rows = projected.rows;
    const keys = [
      ...new Set([
        ...(old.buckets as Array<{ key: string }>).map((b) => b.key),
        '无明确慢病标签',
      ]),
    ].sort();
    expect(newPath(rows, keys)).toEqual(
      countsOf(old.buckets as Array<{ key: string; count: number }>),
    );
    expect(projected.records).toBe(old.cohortSize);
    // 多标签/占位使分类行数大于记录数 —— 分母必须来自 records 而不是 rowCount
    expect(rows.length).toBeGreaterThan(old.cohortSize);
  });

  it('adverse-event-signal：多事件各计一次 + 分母 + 过滤 一致', async () => {
    const old = await oldPath('adverse-event-signal');
    const projected = asProjected(aeSignalProjection(
      { rows: linkRows((r) => ({ adverseEvents: r.adverseEvents, medications: r.medications })) },
      'adverseEvents',
      FILTER,
    ));
    const rows = projected.rows;
    const keys = [...new Set((old.buckets as Array<{ key: string }>).map((b) => b.key))].sort();
    expect(newPath(rows, keys)).toEqual(
      countsOf(old.buckets as Array<{ key: string; count: number }>),
    );
    expect(projected.records).toBe(old.cohortSize);
    expect(rows.length).not.toBe(old.cohortSize);
  });
});
