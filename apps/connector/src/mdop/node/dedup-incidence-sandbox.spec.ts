import type { DedupIncidenceInput } from '@medtrust/wasm-algorithms';
import { AuditService } from '../../domain/audit';
import {
  DEDUP_INCIDENCE_MODULE_ANALYSIS_TYPE,
  DEDUP_INCIDENCE_MODULE_BYTES,
  DEDUP_INCIDENCE_MODULE_SM3,
} from '../../domain/sandbox/__fixtures__/dedup-incidence-module';
import { SandboxRunError, WasmSandboxRunner } from '../../domain/sandbox/sandbox-runner';
import {
  dedupIncidenceFromSandboxOutput,
  dedupIncidencePayload,
  dedupIncidenceReference,
  dedupIncidenceRequiredBytes,
  projectDedupIncidence,
} from '@medtrust/domain-med';

const DAY = 86_400_000;
const d = (offset: number) => new Date((19723 + offset) * DAY).toISOString().slice(0, 10);

function fixture(): DedupIncidenceInput {
  return {
    mergeAdjacent: true,
    eventCodes: ['I21.9'],
    rareCodes: ['E76.0'],
    strataKeys: ['40-64|F', '65+|M'],
    observations: [
      // 两院部分重叠：并集 [100,250] = 151 天
      { subjectKey: 'a', ageBand: '40-64', sex: 'F', start: d(100), end: d(200) },
      { subjectKey: 'a', ageBand: '40-64', sex: 'F', start: d(150), end: d(250) },
      // 空 1 天：合并后 151 天（不合并 150 天）
      { subjectKey: 'b', ageBand: '40-64', sex: 'F', start: d(100), end: d(200) },
      { subjectKey: 'b', ageBand: '40-64', sex: 'F', start: d(202), end: d(250) },
      // 第二层：一段
      { subjectKey: 'c', ageBand: '65+', sex: 'M', start: d(10), end: d(40) },
    ],
    events: [
      { subjectKey: 'a', ageBand: '40-64', sex: 'F', code: 'I21.9', date: d(160) },
      // 同一事件被另一家医院又记一次（同码同日）→ 去重
      { subjectKey: 'a', ageBand: '40-64', sex: 'F', code: 'I21.9', date: d(160) },
      { subjectKey: 'c', ageBand: '65+', sex: 'M', code: 'I21.9', date: d(20) },
    ],
    rareDiseases: [
      // 同一人两院各登记一次（取最早）→ 仍只 1 例
      { subjectKey: 'c', ageBand: '65+', sex: 'M', code: 'E76.0', firstDate: d(30) },
      { subjectKey: 'c', ageBand: '65+', sex: 'M', code: 'E76.0', firstDate: d(25) },
    ],
  };
}

async function runThroughSandbox(input: DedupIncidenceInput) {
  const projection = projectDedupIncidence(input);
  const runner = new WasmSandboxRunner(new AuditService());
  const n = projection.obsRows + projection.eventRows + projection.rareRows;
  runner.assertWithinMemoryLimit(
    dedupIncidenceRequiredBytes({
      obsRows: projection.obsRows,
      eventRows: projection.eventRows,
      rareRows: projection.rareRows,
      strata: projection.strata,
    }),
  );
  const result = await runner.run({
    analysisType: DEDUP_INCIDENCE_MODULE_ANALYSIS_TYPE,
    moduleSm3: DEDUP_INCIDENCE_MODULE_SM3,
    moduleBytes: DEDUP_INCIDENCE_MODULE_BYTES,
    input: projection.input,
    abi: 'dedup-incidence@1',
    n,
    k: projection.strata,
    outOff: projection.outOff,
    outBytes: projection.outBytes,
  });
  return { projection, result };
}

describe('跨院去重发病率宿主适配（C2）', () => {
  it('真字节 + 真沙箱：与 TS 参考语义逐字段一致（重叠并集 / 空 1 天合并 / 事件去重 / 罕见病去重）', async () => {
    const input = fixture();
    const { projection, result } = await runThroughSandbox(input);
    const module = dedupIncidenceFromSandboxOutput({ projection, output: result.output });
    const reference = dedupIncidenceReference(input);
    expect(module.strata).toEqual(reference.strata);
    expect(module.strata).toEqual([
      { key: '40-64|F', uniqueSubjects: 2, personDaysUnion: 302, eventsDeduped: 1, rareCases: 0 },
      { key: '65+|M', uniqueSubjects: 1, personDaysUnion: 31, eventsDeduped: 1, rareCases: 1 },
    ]);
    const payload = dedupIncidencePayload(module);
    const text = JSON.stringify(payload);
    expect(text).not.toContain('subjectKey');
    expect(text).not.toContain('"a"');
    expect(text).not.toContain('I21.9');
    expect(result.envVarCount).toBe(0);
  });

  it('相邻合并关掉时：结果与出域载荷如实记 false，且与参考语义一致', async () => {
    const input = { ...fixture(), mergeAdjacent: false };
    const { projection, result } = await runThroughSandbox(input);
    const module = dedupIncidenceFromSandboxOutput({ projection, output: result.output });
    expect(module.mergeAdjacent).toBe(false);
    expect(module).toEqual(dedupIncidenceReference(input));
    expect(dedupIncidencePayload(module).mergeAdjacent).toBe(false);
  });

  it('所需内存与真实投影逐字节一致（布局算法必须与模型同源）', () => {
    const projection = projectDedupIncidence(fixture());
    expect(
      dedupIncidenceRequiredBytes({
        obsRows: projection.obsRows,
        eventRows: projection.eventRows,
        rareRows: projection.rareRows,
        strata: projection.strata,
      }),
    ).toBe(projection.outOff + projection.outBytes);
  });

  it('并集没生效（人日超过各段之和）→ 拒绝回填', () => {
    const projection = projectDedupIncidence(fixture());
    const output = new Uint8Array(projection.outBytes);
    // 人为写一个超大的人日
    new DataView(output.buffer).setUint32(4, 999_999, true);
    expect(() =>
      dedupIncidenceFromSandboxOutput({ projection, output }),
    ).toThrow(/并集没生效|并集人日/);
  });

  it('罕见病超过去重人数 → 拒绝回填', () => {
    const projection = projectDedupIncidence(fixture());
    const output = new Uint8Array(projection.outBytes);
    const view = new DataView(output.buffer);
    view.setUint32(0, 1, true); // uniqueSubjects = 1
    view.setUint32(12, 3, true); // rareCases = 3 > 1
    expect(() => dedupIncidenceFromSandboxOutput({ projection, output })).toThrow(/罕见病/);
  });

  it('调用形状由宿主判死：dedup-incidence@1 缺合法 n/k → 拒，不启动 worker', async () => {
    const runner = new WasmSandboxRunner(new AuditService());
    const projection = projectDedupIncidence(fixture());
    await expect(
      runner.run({
        analysisType: DEDUP_INCIDENCE_MODULE_ANALYSIS_TYPE,
        moduleSm3: DEDUP_INCIDENCE_MODULE_SM3,
        moduleBytes: DEDUP_INCIDENCE_MODULE_BYTES,
        input: projection.input,
        abi: 'dedup-incidence@1',
        n: 1.5,
        k: projection.strata,
        outOff: projection.outOff,
        outBytes: projection.outBytes,
      }),
    ).rejects.toThrow(SandboxRunError);
  });
});
