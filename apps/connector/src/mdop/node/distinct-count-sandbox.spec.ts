import { distinctCount, type DistinctCountRow } from '@medtrust/wasm-algorithms';
import { AuditService } from '../../domain/audit';
import {
  DISTINCT_COUNT_MODULE_ANALYSIS_TYPE,
  DISTINCT_COUNT_MODULE_BYTES,
  DISTINCT_COUNT_MODULE_SM3,
} from '../../domain/sandbox/__fixtures__/distinct-count-module';
import { SandboxRunError, WasmSandboxRunner } from '../../domain/sandbox/sandbox-runner';
import {
  distinctCountFromSandboxOutput,
  distinctCountPayload,
  distinctCountRequiredBytes,
  projectDistinctCount,
} from './distinct-count-sandbox';

const STRATA = ['60-69|F', '70-79|M'];

function fixture(): DistinctCountRow[] {
  return [
    { subjectKey: 's1', ageBand: '60-69', sex: 'F' },
    { subjectKey: 's1', ageBand: '60-69', sex: 'F' },
    { subjectKey: 's2', ageBand: '60-69', sex: 'F' },
    { subjectKey: 's3', ageBand: '70-79', sex: 'M' },
    { subjectKey: 's2', ageBand: '70-79', sex: 'M' },
    { subjectKey: 's4', ageBand: '70-79', sex: 'M' },
  ];
}

async function runThroughSandbox(input: {
  rows: readonly DistinctCountRow[];
  strataKeys?: readonly string[];
  kOverride?: number;
}) {
  const projection = projectDistinctCount({
    rows: input.rows,
    ...(input.strataKeys ? { strataKeys: input.strataKeys } : {}),
  });
  const runner = new WasmSandboxRunner(new AuditService());
  const k = input.kOverride ?? projection.strata;
  runner.assertWithinMemoryLimit(
    distinctCountRequiredBytes({ subjects: projection.subjects, strata: k }),
  );
  const result = await runner.run({
    analysisType: DISTINCT_COUNT_MODULE_ANALYSIS_TYPE,
    moduleSm3: DISTINCT_COUNT_MODULE_SM3,
    moduleBytes: DISTINCT_COUNT_MODULE_BYTES,
    input: projection.input,
    abi: 'distinct-count@1',
    n: projection.subjects,
    k,
    outOff: projection.outOff,
    outBytes: 4 + 4 * k,
  });
  return { projection, result };
}

describe('去重人数宿主适配（C2 T6）', () => {
  it('真字节 + 真沙箱：与 TS 参考语义逐字段一致，出域载荷无主体键', async () => {
    const rows = fixture();
    const { projection, result } = await runThroughSandbox({ rows, strataKeys: STRATA });
    const module = distinctCountFromSandboxOutput({ projection, output: result.output });
    const reference = distinctCount({ rows, strataKeys: STRATA });
    expect(module.totalDistinct).toBe(reference.totalDistinct);
    expect(module.strata).toEqual(reference.strata);
    const payload = distinctCountPayload(module);
    expect(JSON.stringify(payload)).not.toContain('subjectKey');
    expect(JSON.stringify(payload)).not.toContain('s1');
    expect(result.envVarCount).toBe(0);
  });

  it('调用形状由宿主判死：distinct-count@1 缺合法 n/k → 拒，不启动 worker', async () => {
    const runner = new WasmSandboxRunner(new AuditService());
    const projection = projectDistinctCount({ rows: fixture(), strataKeys: STRATA });
    await expect(
      runner.run({
        analysisType: DISTINCT_COUNT_MODULE_ANALYSIS_TYPE,
        moduleSm3: DISTINCT_COUNT_MODULE_SM3,
        moduleBytes: DISTINCT_COUNT_MODULE_BYTES,
        input: projection.input,
        abi: 'distinct-count@1',
        n: -1,
        k: projection.strata,
        outOff: projection.outOff,
        outBytes: projection.outBytes,
      }),
    ).rejects.toThrow(SandboxRunError);
  });

  it('参数越界由模块拒（strata>64）→ 沙箱如实报错，不越界读写', async () => {
    await expect(
      runThroughSandbox({ rows: fixture(), strataKeys: STRATA, kOverride: 65 }),
    ).rejects.toThrow(/run 返回非零/);
  });
});
