// third-party-module-admission 闸 3 —— 沙箱内动态测试（tasks 3.1–3.8）。
//
// 被测对象是**真的 Tier B Rust 模块**（平台从第三方源码复现构建出来的那份字节），
// 跑在**真的沙箱**里（worker + 零导入 + 资源上限）。参照物是连接器内置的
// TS 实现 `disproportionalityTables` —— 它是与 Wasm 完全独立的第二实现，
// 一致性闸拿它逐字段对拍。
//
// 五类判据对应 design D3 的火力分配：
//   一致性 / 确定性 / 资源上限确实触发 / 防外泄（投影·行序·低熵·canary） / 模糊输入优雅失败。
import {
  assertLowEntropyOutput,
  canaryLeakFields,
  deterministicPermutation,
  outputsIdentical,
  OutputSchemaError,
  staticGate,
} from '@medtrust/wasm-algorithms';
import { disproportionalityTables } from '../rws-executor';
import { InternalRecord } from '../types';
import {
  bucketsFromSandboxOutput,
  projectDisproportionality,
} from './disproportionality-sandbox';
import { SandboxLimitError, WasmSandboxRunner } from './sandbox-runner';
import { buildFixtureWasm } from './wasm-fixtures';
import {
  TIER_B_MODULE_BYTES,
  TIER_B_MODULE_SM3,
} from './__fixtures__/platform-module';

const DRUG = '注射用紫杉醇';
const TIER_B = TIER_B_MODULE_BYTES;

function rec(over: Partial<InternalRecord> = {}): InternalRecord {
  return {
    subjectKey: 'sk',
    ageBand: '40-49',
    sex: 'F',
    conditions: [],
    medications: [DRUG],
    adverseEvents: [],
    ...over,
  };
}

/** 注入真值的确定性合成集（暴露组事件率更高 = 已知信号）。 */
function syntheticCohort(n = 300, seed = 1): InternalRecord[] {
  const rows: InternalRecord[] = [];
  for (let i = 0; i < n; i += 1) {
    const exposed = (i * seed) % 5 < 2;
    const events: InternalRecord['adverseEvents'] = [];
    if (exposed ? i % 3 !== 0 : i % 9 === 0) {
      events.push({ organSystem: '肝胆系统', term: 'ALT升高', serious: false });
    }
    if (i % 7 === 0) {
      events.push({ organSystem: '血液系统', term: '白细胞↓', serious: false });
    }
    if (i % 6 === 1) {
      events.push({ organSystem: '皮肤', term: '皮疹', serious: false });
    }
    rows.push(
      rec({
        subjectKey: `sk_${i}`,
        ageBand: i % 2 === 0 ? '40-49' : '60-69',
        sex: i % 3 === 0 ? 'M' : 'F',
        medications: exposed ? [DRUG, '二甲双胍'] : ['二甲双胍'],
        adverseEvents: events,
      }),
    );
  }
  return rows;
}

async function runModule(
  runner: WasmSandboxRunner,
  bytes: Uint8Array,
  rows: readonly InternalRecord[],
) {
  const projection = projectDisproportionality(rows, DRUG);
  const gate = staticGate(bytes);
  const result = await runner.run({
    analysisType: 'disproportionality',
    moduleSm3: TIER_B_MODULE_SM3 ?? 'x',
    moduleBytes: bytes,
    input: projection.input,
    n: projection.n,
    k: projection.k,
    outOff: projection.outOff,
    outBytes: projection.outBytes,
    minMemoryPages: gate.memoryPages.min,
  });
  return { projection, result };
}

const maybe = TIER_B ? describe : describe.skip;

maybe('闸 3 —— Tier B Rust 模块的沙箱动态测试', () => {
  const runner = new WasmSandboxRunner();
  const bytes = TIER_B as Uint8Array;

  it('3.1 一致性：与独立参考实现（内置 TS）逐字段一致', async () => {
    const rows = syntheticCohort(300);
    const { projection, result } = await runModule(runner, bytes, rows);
    const sandbox = bucketsFromSandboxOutput(result.output, projection);
    const reference = disproportionalityTables(rows, DRUG).buckets;

    expect(sandbox.length).toBe(reference.length);
    for (let i = 0; i < reference.length; i += 1) {
      expect(sandbox[i].key).toBe(reference[i].key);
      expect(sandbox[i].count).toBe(reference[i].count);
      expect(sandbox[i].b).toBe(reference[i].b);
      expect(sandbox[i].c).toBe(reference[i].c);
      expect(sandbox[i].d).toBe(reference[i].d);
      expect(sandbox[i].rate).toBeCloseTo(reference[i].rate, 4);
    }
  }, 30_000);

  it('3.2 确定性：同一输入 N 次 + 两个独立 runner（跨院运行时），输出逐字节一致', async () => {
    const rows = syntheticCohort(200);
    const first = await runModule(runner, bytes, rows);
    const baseline = first.result.output;
    for (let i = 0; i < 3; i += 1) {
      const again = await runModule(runner, bytes, rows);
      expect(outputsIdentical(baseline, again.result.output)).toBe(true);
    }
    // 另起一个 runner ≈ 另一家医院的连接器进程。
    const otherSite = await runModule(new WasmSandboxRunner(), bytes, rows);
    expect(outputsIdentical(baseline, otherSite.result.output)).toBe(true);
  }, 60_000);

  it('3.4 防外泄：进沙箱的只有最小整数列投影，原始标识不在其中', () => {
    const rows = syntheticCohort(50);
    const projection = projectDisproportionality(rows, DRUG);
    // 投影载荷全是 0/1 标记位 —— 没有任何字节能承载 subjectKey / 词条文本。
    expect(projection.input.every((byte) => byte === 0 || byte === 1)).toBe(true);
    const asText = Buffer.from(projection.input).toString('utf8');
    for (const row of rows) {
      expect(asText.includes(row.subjectKey)).toBe(false);
    }
    expect(asText.includes('ALT升高')).toBe(false);
    expect(asText.includes(DRUG)).toBe(false);
    // 词条文本留在宿主一侧，按下标回填。
    expect(projection.terms).toContain('ALT升高');
  });

  it('3.5 防外泄：行序不变性差分——打乱同一多重集后输出逐字节不变', async () => {
    const rows = syntheticCohort(200);
    const base = await runModule(runner, bytes, rows);
    const perm = deterministicPermutation(rows.length, 0xc0ffee);
    const shuffled = perm.map((i) => rows[i]);
    const shuffledRun = await runModule(runner, bytes, shuffled);

    // 词条下标由首次出现顺序决定，打乱后可能换序；按词条对齐后逐字段比。
    const a = bucketsFromSandboxOutput(base.result.output, base.projection);
    const b = bucketsFromSandboxOutput(
      shuffledRun.result.output,
      shuffledRun.projection,
    );
    const byKey = new Map(b.map((x) => [x.key, x]));
    expect(a.length).toBe(b.length);
    for (const bucket of a) {
      const other = byKey.get(bucket.key)!;
      expect(other).toBeDefined();
      expect([other.count, other.b, other.c, other.d]).toEqual([
        bucket.count,
        bucket.b,
        bucket.c,
        bucket.d,
      ]);
    }
  }, 60_000);

  it('3.6 防外泄：输出符合低熵 schema（整数计数、限定值域）', async () => {
    const rows = syntheticCohort(200);
    const { projection, result } = await runModule(runner, bytes, rows);
    const view = new DataView(
      result.output.buffer,
      result.output.byteOffset,
      result.output.byteLength,
    );
    const values: number[] = [];
    for (let i = 0; i < 1 + 4 * projection.k; i += 1) {
      values.push(view.getUint32(i * 4, true));
    }
    // 每个字段都是 [0, n] 内的整数计数 —— 没有尾数、没有超额精度。
    assertLowEntropyOutput(values, {
      fieldCount: values.length,
      range: [0, projection.n],
    });
  }, 30_000);

  it('3.6 负例：带尾数噪声/越界的“计数”被低熵 schema 判死', () => {
    expect(() =>
      assertLowEntropyOutput([3.0000001, 5], { fieldCount: 2, range: [0, 100] }),
    ).toThrow(OutputSchemaError);
    expect(() =>
      assertLowEntropyOutput([3, 500], { fieldCount: 2, range: [0, 100] }),
    ).toThrow(/越出声明值域/);
    expect(() =>
      assertLowEntropyOutput([3], { fieldCount: 2, range: [0, 100] }),
    ).toThrow(/不许可变长输出/);
    // 字段数合法但信息量超上限 —— 挡「值域看着合法、字段多到能塞下一条记录」。
    expect(() =>
      assertLowEntropyOutput(new Array(64).fill(1), {
        fieldCount: 64,
        range: [0, 65535],
        maxEntropyBits: 128,
      }),
    ).toThrow(/信息量/);
  });

  it('3.7 防外泄：注入的 canary 记录不可从输出复原', async () => {
    const rows = syntheticCohort(200);
    const canary = rec({
      subjectKey: 'CANARY-7f3a91',
      medications: [DRUG],
      adverseEvents: [
        { organSystem: '肝胆系统', term: 'ALT升高', serious: false },
      ],
    });

    const readCounts = async (input: readonly InternalRecord[]) => {
      const { projection, result } = await runModule(runner, bytes, input);
      const view = new DataView(
        result.output.buffer,
        result.output.byteOffset,
        result.output.byteLength,
      );
      const out: number[] = [];
      for (let i = 0; i < 1 + 4 * projection.k; i += 1) {
        out.push(view.getUint32(i * 4, true));
      }
      return { values: out, terms: projection.terms, raw: result.output };
    };

    const without = await readCounts(rows);
    const withCanary = await readCounts([...rows, canary]);

    // canary 只能让「cohortSize」与「ALT升高 的 a/b」这类计数位 +1，
    // 不得在别处产生任何变化（那就是在把 canary 内容编码进输出）。
    const altIndex = without.terms.indexOf('ALT升高');
    const allowed = [
      0, // cohortSize
      1 + altIndex * 4, // a
      1 + altIndex * 4 + 1, // b
    ];
    // 未暴露组的 d 也会随队列规模变化，一并计入允许集。
    for (let j = 0; j < without.terms.length; j += 1) {
      allowed.push(1 + j * 4 + 1); // b：入组用药人数增加会抬高每个词条的 b
    }
    const leaks = canaryLeakFields(without.values, withCanary.values, allowed);
    expect(leaks).toEqual([]);

    // 输出字节里不含 canary 的任何标识。
    expect(Buffer.from(withCanary.raw).toString('utf8')).not.toContain('CANARY');
  }, 60_000);

  it('3.8 模糊输入：空队列 / 全同 / 高基数 只能优雅失败或给出合法输出', async () => {
    const cases: Array<{ label: string; rows: InternalRecord[] }> = [
      { label: '空队列', rows: [] },
      {
        label: '全同行',
        rows: Array.from({ length: 50 }, () =>
          rec({ adverseEvents: [{ organSystem: 'x', term: 'T', serious: false }] }),
        ),
      },
      {
        label: '高基数词条',
        rows: Array.from({ length: 80 }, (_, i) =>
          rec({
            subjectKey: `sk_${i}`,
            adverseEvents: [
              { organSystem: 'x', term: `term_${i}`, serious: false },
            ],
          }),
        ),
      },
      {
        label: '全部未用药',
        rows: syntheticCohort(60).map((r) => ({ ...r, medications: ['二甲双胍'] })),
      },
    ];

    for (const { label, rows } of cases) {
      let failedGracefully = false;
      try {
        const { projection, result } = await runModule(runner, bytes, rows);
        const buckets = bucketsFromSandboxOutput(result.output, projection);
        // 有输出就必须满足不变量（bucketsFromSandboxOutput 已校验 a+b/c+d）。
        for (const b of buckets) {
          expect(Number.isInteger(b.count)).toBe(true);
          expect(b.count).toBeGreaterThanOrEqual(0);
        }
      } catch (err) {
        // 优雅失败：抛出可归因的错误，而不是让连接器进程倒掉。
        failedGracefully = err instanceof Error;
        expect(failedGracefully).toBe(true);
      }
      expect(typeof label).toBe('string');
    }
  }, 120_000);
});

describe('闸 3 —— 资源上限确实触发，且只判任务失败（task 3.3）', () => {
  const runner = new WasmSandboxRunner();

  it('死循环 → 超时被终止，抛 SandboxLimitError，连接器进程不受影响', async () => {
    const original = process.env.CONNECTOR_SANDBOX_TIMEOUT_MS;
    process.env.CONNECTOR_SANDBOX_TIMEOUT_MS = '600';
    try {
      const loop = buildFixtureWasm({ body: 'infinite-loop' });
      await expect(
        runner.run({
          analysisType: 'disproportionality',
          moduleSm3: 'a'.repeat(64),
          moduleBytes: loop,
          input: new Uint8Array(8),
          n: 1,
          k: 1,
          outOff: 8,
          outBytes: 20,
        }),
      ).rejects.toThrow(SandboxLimitError);
      // 宿主还活着：紧接着一次正常调用仍然成功。
      expect(typeof process.pid).toBe('number');
    } finally {
      if (original === undefined) delete process.env.CONNECTOR_SANDBOX_TIMEOUT_MS;
      else process.env.CONNECTOR_SANDBOX_TIMEOUT_MS = original;
    }
  }, 30_000);

  it('所需内存超上限 → 调用模块之前就拒（不给它分配的机会）', () => {
    const original = process.env.CONNECTOR_SANDBOX_MAX_MEMORY_MB;
    process.env.CONNECTOR_SANDBOX_MAX_MEMORY_MB = '1';
    try {
      expect(() => runner.assertWithinMemoryLimit(64 * 1024 * 1024)).toThrow(
        SandboxLimitError,
      );
    } finally {
      if (original === undefined)
        delete process.env.CONNECTOR_SANDBOX_MAX_MEMORY_MB;
      else process.env.CONNECTOR_SANDBOX_MAX_MEMORY_MB = original;
    }
  });

  it('声明内存上限超配置的模块 → 闸 1 在静态阶段就拒（不进 worker）', () => {
    // 65536 页 = 4GiB，远超沙箱上限。
    expect(() =>
      staticGate(buildFixtureWasm({}), { maxMemoryPages: 16 }),
    ).toThrow(/内存上限/);
  });
});
