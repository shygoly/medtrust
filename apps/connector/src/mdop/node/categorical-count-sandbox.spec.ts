import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  categoricalCountFromSandboxOutput,
  categoricalCountPayload,
  categoricalCountRequiredBytes,
  projectCategoricalCount,
  type CategoricalCountProjection,
} from './categorical-count-sandbox';

/**
 * 分类计数的宿主适配（批次 2）。钉三件事：投影的分类键映射与拒绝、回填的不变量、
 * 以及**偏移与模块真的对得上** —— 最后一条用真模块字节在宿主内存上跑一遍（不是手工造输出）。
 */

const BUILD = join(__dirname, '../../../../../packages/wasm-algorithms/build');
const manifest = JSON.parse(readFileSync(join(BUILD, 'manifest.json'), 'utf8')) as {
  modules: Array<{ analysisType: string; file: string }>;
};

/** 把模块输出区当作从 0 起算（沙箱里 outOff 由投影给出，这里整体平移到 inOff 之后）。 */
function runRealModule(projection: CategoricalCountProjection): Uint8Array {
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
    inOff: number,
    n: number,
    k: number,
    outOff: number,
  ) => number;
  const code = run(inOff, projection.n, projection.categories, outOff);
  if (code !== 0) throw new Error('module returned ' + code);
  return new Uint8Array(memory.buffer, outOff, projection.outBytes).slice();
}

describe('分类计数的宿主适配（批次 2）', () => {
  it('投影：分类键映射成编号；不在列表 / 空表一律拒', () => {
    const p = projectCategoricalCount({
      rows: [{ category: 'b' }, { category: 'a' }, { category: 'b' }],
    });
    expect(p.categoryKeys).toEqual(['a', 'b']);
    expect(Array.from(p.input)).toEqual([1, 0, 1]);
    expect(p.n).toBe(3);
    expect(categoricalCountRequiredBytes({ n: 3, categories: 2 })).toBeGreaterThan(0);
    expect(() =>
      projectCategoricalCount({ rows: [{ category: 'x' }], categoryKeys: ['a'] }),
    ).toThrow(/不在给定列表/);
    expect(() => projectCategoricalCount({ rows: [] })).toThrow(/分类键列表为空/);
  });

  it('真模块 + 真偏移：回填与模块逐字段一致（计数口径 = 出现次数，非去重）', () => {
    const projection = projectCategoricalCount({
      rows: [
        { category: 'a' },
        { category: 'b' },
        { category: 'a' },
        { category: 'a' },
      ],
    });
    const counted = categoricalCountFromSandboxOutput({
      projection,
      output: runRealModule(projection),
    });
    expect(counted.rowCount).toBe(4);
    expect(counted.buckets).toEqual([
      { key: 'a', count: 3 },
      { key: 'b', count: 1 },
    ]);
    // 载荷不带行数：口径不变量保证「各桶之和 = 行数」，消费方按和推导（回填处已证）。
    expect(categoricalCountPayload(counted)).toEqual({
      analysisType: 'categorical-count',
      rowCount: 4,
      buckets: [
        { key: 'a', count: 3 },
        { key: 'b', count: 1 },
      ],
    });
  });

  it('回填不变量：rowCount 与行数不符 / 各桶之和与行数不符 一律抛（不出悄悄算错的数）', () => {
    const projection = projectCategoricalCount({ rows: [{ category: 'a' }] });
    const bad = (rowCount: number, count: number) => {
      const bytes = new Uint8Array(projection.outBytes);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, rowCount, true);
      view.setUint32(4, count, true);
      return bytes;
    };
    expect(() =>
      categoricalCountFromSandboxOutput({ projection, output: bad(2, 2) }),
    ).toThrow(/行数/);
    expect(() =>
      categoricalCountFromSandboxOutput({ projection, output: bad(1, 0) }),
    ).toThrow(/各分类计数之和/);
    expect(() =>
      categoricalCountFromSandboxOutput({ projection, output: new Uint8Array(2) }),
    ).toThrow(/长度不足/);
  });
});
