import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditService } from '../../domain/audit';
import { Deidentifier } from '../../domain/deidentifier';
import { LocalStore } from '../../domain/local-store';
import { RwsExecutor } from '../../domain/rws-executor';
import type { InternalRecord } from '../../domain/types';
import {
  categoricalCountFromSandboxOutput,
  projectCategoricalCount,
  type CategoricalCountProjection,
} from './categorical-count-sandbox';
import {
  listCategoriesProjection,
  scalarCategoryProjection,
} from '../operators/seal';

/**
 * **对拍证据**（批次 2 design D2 的第五件套）：旧链三型 vs 新路径逐字段比。
 *
 * 为什么必须有这一条：三型的口径（design D6）是「按分类字段计数**出现次数**」，现在有两份实现 ——
 * 旧链在 `domain/rws-executor.ts`（节点内本地聚合），新路径是「封存投影 → `categorical-count` 模块 → 收集器」。
 * 两份实现各自改过而另一份没跟上，迁移前后的数就说不清。这里用**同一组夹具**同时跑两条路，
 * 逐字段比 `cohortSize/rowCount` 与每个分类的 count；不一致即红。
 *
 * 刻意包含**重复行**（同一 `linkKey` 出现两次）：去重主体口径（`distinct-count`）会算出不同的数，
 * 这一步正是用来证明我们走的是「出现次数」而不是「去重主体」。
 */

const NO_CONDITION_LABEL = '无明确慢病标签';

const BUILD = join(__dirname, '../../../../../packages/wasm-algorithms/build');
const manifest = JSON.parse(readFileSync(join(BUILD, 'manifest.json'), 'utf8')) as {
  modules: Array<{ analysisType: string; file: string }>;
};

/** 新路径的模块执行：真模块 + 沙箱投影给出的偏移（与生产调用形状一致）。 */
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

/** 走完新路径：投影行 -> 模块 -> 回填（返回按 key 排序的计数表）。 */
function newPath(
  rows: Array<{ category: string }>,
  categoryKeys: string[],
): Array<{ key: string; count: number }> {
  const projection = projectCategoricalCount({ rows, categoryKeys });
  const counted = categoricalCountFromSandboxOutput({
    projection,
    output: runModule(projection),
  });
  return [...counted.buckets].sort((a, b) => a.key.localeCompare(b.key));
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

/** 夹具刻意含重复：同一 linkKey 两行（去重口径会少算）。 */
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
  rec({ subjectKey: 'lk-5', ageBand: '70-79' }), // 全部取目标药：把「按药过滤」差异隔离，另见 2.1a
];

type L01Type = 'cohort-count' | 'condition-prevalence' | 'adverse-event-signal';

function oldPath(type: L01Type) {
  const store = new LocalStore(new AuditService());
  const exec = new RwsExecutor(store, new Deidentifier());
  store.ingest(FIXTURE);
  return exec.run({ type, drug: DRUG });
}

/** 只比「分类键 + 计数」。旧链的 `rate` 是派生量（count/分母），单列断言，不混进对拍口径。 */
function countsOf(
  buckets: Array<{ key: string; count: number }>,
): Array<{ key: string; count: number }> {
  return [...buckets]
    .map((b) => ({ key: b.key, count: b.count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

describe('批次 2 对拍：旧链三型 vs 新路径（封存投影 -> categorical-count）', () => {
  it('cohort-count：行数与每个年龄带的计数逐字段一致（含重复行；本型分母=分类行数）', async () => {
    const old = await oldPath('cohort-count');
    const rows = scalarCategoryProjection(
      {
        rows: FIXTURE.map((r) => ({
          linkKey: r.subjectKey,
          ageBand: r.ageBand,
          conditions: r.conditions,
          adverseEvents: r.adverseEvents,
          medications: r.medications,
        })),
      },
      'ageBand',
    ).rows as Array<{ category: string }>;
    const keys = [...new Set((old.buckets as Array<{ key: string }>).map((b) => b.key))].sort();
    const mine = newPath(rows, keys);
    expect(old.cohortSize).toBe(rows.length);
    expect(mine).toEqual(countsOf(old.buckets as Array<{ key: string; count: number }>));
    // 重复行确实被各算一次（去重口径下 lk-1 只会算一次）
    expect(mine.find((b) => b.key === '40-49')!.count).toBe(2);
    // 本型分母 = 分类行数（一行一记录），旧链的 rate 可由新路径的 rowCount 复现
    const oldBuckets = old.buckets as Array<{ key: string; count: number; rate: number }>;
    for (const b of oldBuckets) {
      expect(b.rate).toBeCloseTo(Number((b.count / rows.length).toFixed(4)), 4);
    }
  });

  it('condition-prevalence：桶逐字段一致；**分母口径差异显式声明**（旧链 cohortSize=记录数）', async () => {
    const old = await oldPath('condition-prevalence');
    const rows = listCategoriesProjection(
      {
        rows: FIXTURE.map((r) => ({
          linkKey: r.subjectKey,
          conditions: r.conditions,
        })),
      },
      'conditions',
      NO_CONDITION_LABEL,
    ).rows as Array<{ category: string }>;
    const keys = [
      ...new Set([
        ...(old.buckets as Array<{ key: string }>).map((b) => b.key),
        NO_CONDITION_LABEL,
      ]),
    ].sort();
    const mine = newPath(rows, keys);
    expect(mine).toEqual(countsOf(old.buckets as Array<{ key: string; count: number }>));
    // 已知差异（任务 2.2b）：旧链 cohortSize = **记录数**（率的分母），新路径 rowCount = **分类行数**
    // （一行多标签各算一行）。多值型下两者不同，平台若要复现旧链的 rate 就需要单独携带分母。
    expect(rows.length).toBeGreaterThan(old.cohortSize);
  });

  it('adverse-event-signal：桶逐字段一致；**分母口径差异显式声明**（旧链 cohortSize=记录数）', async () => {
    const old = await oldPath('adverse-event-signal');
    const rows = (
      await import('../operators/seal')
    ).aeSignalProjection(
      {
        rows: FIXTURE.map((r) => ({
          linkKey: r.subjectKey,
          adverseEvents: r.adverseEvents,
        })),
      },
      'adverseEvents',
    ).rows as Array<{ category: string }>;
    const keys = [...new Set((old.buckets as Array<{ key: string }>).map((b) => b.key))].sort();
    const mine = newPath(rows, keys);
    expect(mine).toEqual(countsOf(old.buckets as Array<{ key: string; count: number }>));
    // 已知差异（任务 2.3b）：旧链 cohortSize = **队列记录数**（患者数，率的分母），新路径 rowCount = **事件行数**。
    // 两者量纲不同（这里事件 3 < 记录 6）：平台要复现旧链的 rate 就必须让节点把记录数一并带出。
    expect(rows.length).not.toBe(old.cohortSize);
  });
});

