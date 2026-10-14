import type { VeTndInput } from '@medtrust/wasm-algorithms';
import { AuditService } from '../../domain/audit';
import {
  VE_TND_MODULE_ANALYSIS_TYPE,
  VE_TND_MODULE_BYTES,
  VE_TND_MODULE_SM3,
} from '../../domain/sandbox/__fixtures__/ve-tnd-module';
import { SandboxRunError, WasmSandboxRunner } from '../../domain/sandbox/sandbox-runner';
import {
  projectVeTnd,
  veTndFromSandboxOutput,
  veTndPayload,
  veTndReference,
  veTndRequiredBytes,
} from '@medtrust/domain-med';

const DAY = 86_400_000;
const d = (offset: number) => new Date((19723 + offset) * DAY).toISOString().slice(0, 10);

function fixture(): VeTndInput {
  return {
    immuneDays: 14,
    vaccineCodes: ['208'],
    pathogenCodes: ['94500-6'],
    doses: [
      { subjectKey: 'a', vaccinationDate: d(0), vaccineCode: '208' },
      { subjectKey: 'b', vaccinationDate: d(0), vaccineCode: '208' },
      { subjectKey: 'b', vaccinationDate: d(30), vaccineCode: '208' },
    ],
    tests: [
      // 免疫建立期边界：14 天 = 已接种，13 天 = 部分免疫
      { subjectKey: 'a', testDate: d(14), pathogenCode: '94500-6', result: 'pos', ageBand: '40-64', sex: 'F' },
      { subjectKey: 'a', testDate: d(13), pathogenCode: '94500-6', result: 'neg', ageBand: '40-64', sex: 'F' },
      // 多剂次取检测日前最后一剂
      { subjectKey: 'b', testDate: d(50), pathogenCode: '94500-6', result: 'neg', ageBand: '65+', sex: 'M' },
      // 无接种史 → 未接种
      { subjectKey: 'c', testDate: d(20), pathogenCode: '94500-6', result: 'pos', ageBand: '40-64', sex: 'F' },
      // 同人同日重复检测（结果故意冲突）→ 只留首条
      { subjectKey: 'a', testDate: d(14), pathogenCode: '94500-6', result: 'neg', ageBand: '40-64', sex: 'F' },
      // 白名单外病原 → 不纳入
      { subjectKey: 'c', testDate: d(21), pathogenCode: 'FLU', result: 'pos', ageBand: '40-64', sex: 'F' },
    ],
  };
}

async function runThroughSandbox(input: VeTndInput) {
  const projection = projectVeTnd(input);
  const runner = new WasmSandboxRunner(new AuditService());
  runner.assertWithinMemoryLimit(
    veTndRequiredBytes({ tests: projection.tests, strata: projection.strata }),
  );
  const result = await runner.run({
    analysisType: VE_TND_MODULE_ANALYSIS_TYPE,
    moduleSm3: VE_TND_MODULE_SM3,
    moduleBytes: VE_TND_MODULE_BYTES,
    input: projection.input,
    abi: 've-tnd@1',
    n: projection.tests,
    k: projection.strata,
    outOff: projection.outOff,
    outBytes: projection.outBytes,
  });
  return { projection, result };
}

describe('疫苗保护效果（TND）宿主适配（C2）', () => {
  it('真字节 + 真沙箱：与 TS 参考语义逐字段一致，出域载荷无主体键', async () => {
    const input = fixture();
    const { projection, result } = await runThroughSandbox(input);
    const module = veTndFromSandboxOutput({ projection, output: result.output });
    const reference = veTndReference(input);
    expect(module.strata).toEqual(reference.strata);
    expect(module.immuneDays).toBe(14);
    // 具体期望：40-64|F 已接种阳性 1 / 未接种阳性 1 / 部分免疫阴性 1；65+|M 已接种阴性 1
    expect(module.strata).toEqual([
      { key: '40-64|F', vaccPos: 1, vaccNeg: 0, unvaccPos: 1, unvaccNeg: 0, partialPos: 0, partialNeg: 1 },
      { key: '65+|M', vaccPos: 0, vaccNeg: 1, unvaccPos: 0, unvaccNeg: 0, partialPos: 0, partialNeg: 0 },
    ]);
    const payload = veTndPayload(module);
    const text = JSON.stringify(payload);
    expect(text).not.toContain('subjectKey');
    expect(text).not.toContain('"a"');
    expect(text).not.toContain('94500-6');
    expect(result.envVarCount).toBe(0);
  });

  it('检测结果不是 pos / neg → 投影即拒（不把未知结果当阴性算进对照组）', () => {
    const base = fixture();
    const input: VeTndInput = {
      ...base,
      tests: [
        ...base.tests,
        {
          subjectKey: 'd',
          testDate: d(25),
          pathogenCode: '94500-6',
          result: 'inconclusive' as never,
          ageBand: '40-64',
          sex: 'F',
        },
      ],
    };
    expect(() => projectVeTnd(input)).toThrow(/pos 或 neg/);
  });

  it('所需内存与真实投影逐字节一致（算少了内存就是越界风险）', () => {
    const projection = projectVeTnd(fixture());
    expect(
      veTndRequiredBytes({ tests: projection.tests, strata: projection.strata }),
    ).toBe(projection.outOff + projection.outBytes);
  });

  it('六格合计对不上纳入检测数 → 拒绝回填（不把算错的计数交给发布审查）', () => {
    const projection = projectVeTnd(fixture());
    const output = new Uint8Array(projection.outBytes);
    expect(() =>
      veTndFromSandboxOutput({
        projection: { ...projection, tests: projection.tests + 1 },
        output,
      }),
    ).toThrow(/六格合计/);
  });

  it('调用形状由宿主判死：ve-tnd@1 缺合法 n/k → 拒，不启动 worker', async () => {
    const runner = new WasmSandboxRunner(new AuditService());
    const projection = projectVeTnd(fixture());
    await expect(
      runner.run({
        analysisType: VE_TND_MODULE_ANALYSIS_TYPE,
        moduleSm3: VE_TND_MODULE_SM3,
        moduleBytes: VE_TND_MODULE_BYTES,
        input: projection.input,
        abi: 've-tnd@1',
        n: -1,
        k: projection.strata,
        outOff: projection.outOff,
        outBytes: projection.outBytes,
      }),
    ).rejects.toThrow(SandboxRunError);
  });
});
