import { AuditService } from '../../domain/audit';
import { WasmSandboxRunner } from '../../domain/sandbox/sandbox-runner';
import {
  bucketsFromSandboxOutput,
  projectDisproportionality,
} from '../../domain/sandbox/disproportionality-sandbox';
import {
  PLATFORM_MODULE_ANALYSIS_TYPE,
  PLATFORM_MODULE_BYTES,
  PLATFORM_MODULE_SM3,
} from '../../domain/sandbox/__fixtures__/platform-module';
import { disproportionalityTables } from '../../domain/rws-executor';
import type { InternalRecord } from '../../domain/types';
import { MdopStageExecutor } from '../mdop-executor';
import { registerL15Operators, type ProportionalityBucket } from '@medtrust/domain-med';

/**
 * §9.7 对拍（连接器侧）：**同一份数据**分别走
 *   ① 旧通道：内置 TS 实现 `disproportionalityTables`
 *   ② MDOP 通道：source.dataset → rws.disproportionality（**真实 wasm 模块 + 零能力沙箱**）→ declassify
 * 在未触发小单元格抑制时，两者的四格表逐字段一致。
 */

const DRUG = '注射用紫杉醇';

function rows(): InternalRecord[] {
  const make = (
    i: number,
    onDrug: boolean,
    events: string[],
  ): InternalRecord => ({
    subjectKey: `s${i}`,
    ageBand: i % 2 === 0 ? '60-69' : '70-79',
    sex: i % 2 === 0 ? 'F' : 'M',
    conditions: [],
    medications: onDrug ? [DRUG, '二甲双胍'] : ['二甲双胍'],
    adverseEvents: events.map((term) => ({ term, organSystem: '胃肠', serious: true })),
  });
  return [
    make(1, true, ['胰腺炎', '中性粒细胞减少']),
    make(2, true, ['胰腺炎']),
    make(3, true, []),
    make(4, false, ['胰腺炎']),
    make(5, false, ['中性粒细胞减少']),
    make(6, false, []),
    make(7, true, ['中性粒细胞减少']),
    make(8, false, ['胰腺炎', '中性粒细胞减少']),
  ];
}

/** 走**真实 wasm 模块**：投影 → 沙箱执行 → 回填四格表。 */
async function runWasm(records: readonly InternalRecord[]): Promise<ProportionalityBucket[]> {
  const projection = projectDisproportionality(records, DRUG);
  const runner = new WasmSandboxRunner(new AuditService());
  runner.assertWithinMemoryLimit(
    projection.outOff + projection.outBytes,
  );
  const result = await runner.run({
    analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
    moduleSm3: PLATFORM_MODULE_SM3,
    moduleBytes: PLATFORM_MODULE_BYTES,
    input: projection.input,
    n: projection.n,
    k: projection.k,
    outOff: projection.outOff,
    outBytes: projection.outBytes,
    taskId: 'l15-parity',
  });
  return bucketsFromSandboxOutput(result.output, projection).map((b) => ({
    key: b.key,
    count: b.count,
    rate: b.rate,
    b: b.b,
    c: b.c,
    d: b.d,
  }));
}

describe('L1.5 MDOP 链路与旧通道对拍（§9.2-9.4 / §9.7）', () => {
  const buildExecutor = () => {
    const executor = new MdopStageExecutor();
    registerL15Operators(executor, {
      loadRows: async () => rows(),
      snapshotOf: () => `sm3:${'9'.repeat(64)}`,
      runProportionality: async (records) => ({
        buckets: await runWasm(records),
        moduleSm3: PLATFORM_MODULE_SM3,
      }),
      // 未触发抑制：闸门原样放行（本用例只对拍计算口径）
      gate: (candidate) => candidate as Record<string, unknown>,
    });
    return executor;
  };

  const stage = (id: string, op: string, params: Record<string, unknown> = {}) =>
    ({
      id,
      node: 'urn:tds:sh-med:participant:p-demohospa',
      op,
      op_digest: id === 'l15' ? `sm3:${PLATFORM_MODULE_SM3}` : 'component:x@1',
      params,
      inputs: [],
      input_labels: [],
      output_label: 'C0',
      output_schema: 'mdop.table/1.0',
    }) as never;

  it('wasm 模块与内置实现逐字段一致（四格表）', async () => {
    const records = rows();
    const builtIn = disproportionalityTables(records, DRUG);
    const wasmBuckets = await runWasm(records);
    expect(wasmBuckets.map((b) => [b.key, b.count, b.b, b.c, b.d])).toEqual(
      builtIn.buckets.map((b) => [b.key, b.count, b.b, b.c, b.d]),
    );
  }, 30_000);

  it('MDOP 三算子链路（source→wasm→declassify）产出与旧通道一致的四格表', async () => {
    const executor = buildExecutor();
    const contractTerms = { publication: { minCell: 1 } };

    const source = await executor.execute(
      {
        jobId: 'job-1',
        stage: stage('src', 'source.dataset@1.0.0', { uri: 'ds://p-demohospa/dp-1' }),
        inputs: new Map(),
        attempt: 1,
      },
      {
        apiVersion: 'mdop/v0.2',
        kind: 'system',
        id: 'source.dataset',
        version: '1.0.0',
        category: 'source',
        digest: 'component:connector-datasource@1',
        publisher: 'urn:tds:platform',
        inputs: [],
        outputs: [{ name: 'o', schema: 'mdop.dataset/1.0', label_rule: 'inherit' }],
        params: {},
        environments: ['plain'],
        security: { network: 'none' },
        component: 'connector-datasource@1.0.0',
      },
    );
    expect(source.label).toBe('C0');
    expect(source.payload.n).toBe(rows().length);
    expect(source.payload.snapshot).toBe(`sm3:${'9'.repeat(64)}`);

    const l15 = await executor.execute(
      {
        jobId: 'job-1',
        stage: stage('l15', 'rws.disproportionality@1.0.0', { drug: DRUG }),
        inputs: new Map([['src', source.payload]]),
        attempt: 1,
      },
      {
        apiVersion: 'mdop/v0.2',
        kind: 'wasm',
        id: 'rws.disproportionality',
        version: '1.0.0',
        category: 'local',
        digest: `sm3:${PLATFORM_MODULE_SM3}`,
        publisher: 'urn:tds:platform',
        inputs: [],
        outputs: [{ name: 'o', schema: 'mdop.table/1.0', label_rule: 'inherit' }],
        params: {},
        environments: ['plain'],
        security: { network: 'none' },
        build: {
          source_digest: `sm3:${PLATFORM_MODULE_SM3}`,
          toolchain: 'asc@0.27.37',
          reproducible: true,
        },
      },
    );
    expect(l15.label).toBe('C0');
    const builtIn = disproportionalityTables(rows(), DRUG);
    expect((l15.payload.buckets as ProportionalityBucket[]).map((b) => [b.key, b.count, b.b, b.c, b.d])).toEqual(
      builtIn.buckets.map((b) => [b.key, b.count, b.b, b.c, b.d]),
    );

    const released = await executor.execute(
      {
        jobId: 'job-1',
        stage: stage('dec', 'declassify.small_cell@1.0.0', { minCell: 1 }),
        inputs: new Map([['l15', l15.payload]]),
        attempt: 1,
        contractTerms,
      },
      {
        apiVersion: 'mdop/v0.2',
        kind: 'system',
        id: 'declassify.small_cell',
        version: '1.0.0',
        category: 'declassify',
        digest: 'component:connector-output-gate@1',
        publisher: 'urn:tds:platform',
        inputs: [],
        outputs: [{ name: 'o', schema: 'mdop.table/1.0', label_rule: 'C3' }],
        params: {},
        environments: ['plain'],
        security: { network: 'none' },
        component: 'connector-output-gate@1.0.0',
      },
    );
    // 未触发抑制 ⇒ 出口等级 C3，内容与旧通道一致
    expect(released.label).toBe('C3');
    expect((released.payload.buckets as ProportionalityBucket[]).length).toBe(builtIn.buckets.length);
  }, 60_000);

  it('缺 wasm 执行器时拒绝执行（不回退到内置实现）', async () => {
    const executor = new MdopStageExecutor();
    registerL15Operators(executor, {
      loadRows: async () => rows(),
      snapshotOf: () => null,
      runProportionality: async () => {
        throw new Error('本节点未接入 wasm 沙箱执行器');
      },
      gate: (c) => c as Record<string, unknown>,
    });
    await expect(
      executor.execute(
        {
          jobId: 'job-1',
          stage: stage('l15', 'rws.disproportionality@1.0.0', { drug: DRUG }),
          inputs: new Map([['src', { rows: rows() }]]),
          attempt: 1,
        },
        {
          apiVersion: 'mdop/v0.2',
          kind: 'wasm',
          id: 'rws.disproportionality',
          version: '1.0.0',
          category: 'local',
          digest: `sm3:${PLATFORM_MODULE_SM3}`,
          publisher: 'urn:tds:platform',
          inputs: [],
          outputs: [{ name: 'o', schema: 's', label_rule: 'inherit' }],
          params: {},
          environments: ['plain'],
          security: { network: 'none' },
          build: {
            source_digest: `sm3:${PLATFORM_MODULE_SM3}`,
            toolchain: 'asc@0.27.37',
            reproducible: true,
          },
        },
      ),
    ).rejects.toThrow(/wasm 沙箱/);
  });
});
