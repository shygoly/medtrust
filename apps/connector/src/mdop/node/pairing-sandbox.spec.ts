import { pairIntersection, type PairPartyTable, type PseudonymRow } from '@medtrust/wasm-algorithms';
import { AuditService } from '../../domain/audit';
import {
  PAIRING_MODULE_ANALYSIS_TYPE,
  PAIRING_MODULE_BYTES,
  PAIRING_MODULE_SM3,
} from '../../domain/sandbox/__fixtures__/pairing-module';
import { SandboxRunError, WasmSandboxRunner } from '../../domain/sandbox/sandbox-runner';
import {
  pairedCohortFromSandboxOutput,
  pairedCohortPayload,
  pairingRequiredBytes,
  projectPairing,
} from '@medtrust/domain-med';

/**
 * 节点内配对的**宿主适配**（任务 3.12f）：真字节 + 真沙箱 + 真 ABI 形状。
 *
 * 要钉住两件事：
 *  ① **与 TS 参考语义逐字段一致**——同一条语义的两份实现（Wasm 模块 / 宿主回填）漂移即红；
 *  ② **调用形状是本侧判死的**：配对模块是 5 参 ABI，若沿用 4 参形状就会「算错而不是报错」，
 *     所以沙箱按 `abi` 明确分派，缺 parties/strata 直接拒、不启动 worker。
 */

const ALIGN = 'wm:site-a:sh-med';

/** 合成两院队列：4 名共享主体（含分层与「结局只在 B 方」），各 3 名院内独有。 */
function fixture(): { tables: PairPartyTable[]; strataKeys: string[] } {
  const a: PseudonymRow[] = [
    { subjectKey: 's1', exposure: true, outcome: false, ageBand: '60-69', sex: 'F' },
    { subjectKey: 's2', exposure: true, outcome: false, ageBand: '60-69', sex: 'M' },
    { subjectKey: 's3', exposure: false, outcome: false, ageBand: '70-79', sex: 'F' },
    { subjectKey: 's4', exposure: true, outcome: false, ageBand: '70-79', sex: 'M' },
    { subjectKey: 'a1', exposure: true, outcome: true, ageBand: '60-69', sex: 'F' },
    { subjectKey: 'a2', exposure: false, outcome: false, ageBand: '60-69', sex: 'M' },
    { subjectKey: 'a3', exposure: true, outcome: false, ageBand: '70-79', sex: 'F' },
  ];
  const b: PseudonymRow[] = [
    { subjectKey: 's1', exposure: false, outcome: true, ageBand: '60-69', sex: 'F' },
    { subjectKey: 's2', exposure: false, outcome: false, ageBand: '60-69', sex: 'M' },
    { subjectKey: 's3', exposure: false, outcome: false, ageBand: '70-79', sex: 'F' },
    { subjectKey: 's4', exposure: false, outcome: true, ageBand: '70-79', sex: 'M' },
    { subjectKey: 'b1', exposure: false, outcome: true, ageBand: '60-69', sex: 'F' },
    { subjectKey: 'b2', exposure: true, outcome: false, ageBand: '60-69', sex: 'M' },
    { subjectKey: 'b3', exposure: false, outcome: true, ageBand: '70-79', sex: 'F' },
  ];
  return {
    tables: [
      { node: 'urn:tds:sh-med:participant:p-demohospa', rows: a },
      { node: 'urn:tds:sh-med:participant:p-demohospb', rows: b },
    ],
    strataKeys: ['60-69|F', '60-69|M', '70-79|F', '70-79|M'],
  };
}

async function runThroughSandbox(input: {
  tables: readonly PairPartyTable[];
  strataKeys?: readonly string[];
  partiesOverride?: number;
  strataOverride?: number;
}) {
  const projection = projectPairing({
    tables: input.tables,
    ...(input.strataKeys ? { strataKeys: input.strataKeys } : {}),
  });
  const runner = new WasmSandboxRunner(new AuditService());
  const parties = input.partiesOverride ?? projection.parties;
  const strata = input.strataOverride ?? projection.strata;
  runner.assertWithinMemoryLimit(
    pairingRequiredBytes({ parties, subjects: projection.subjects, strata }),
  );
  const result = await runner.run({
    analysisType: PAIRING_MODULE_ANALYSIS_TYPE,
    moduleSm3: PAIRING_MODULE_SM3,
    moduleBytes: PAIRING_MODULE_BYTES,
    input: projection.input,
    // 配对 ABI：第二个参数是**参与方数**，第四个是**分层数**（不是词条数）
    abi: 'pairing@1',
    parties,
    n: projection.subjects,
    strata,
    k: strata,
    outOff: projection.outOff,
    outBytes: projection.outBytes,
  });
  return { projection, result };
}

describe('节点内配对：宿主适配（任务 3.12f）', () => {
  it('真字节走真沙箱：模块输出与 TS 参考语义逐字段一致（含逐分层）', async () => {
    const { tables, strataKeys } = fixture();
    const { projection, result } = await runThroughSandbox({ tables, strataKeys });
    const reference = pairIntersection({ tables });
    const module = pairedCohortFromSandboxOutput({
      projection,
      output: result.output,
      parties: tables.map((t) => t.node),
    });

    // 交集只算两方都出现的主体：s1..s4（a*/b* 是单方独有，不得进分子分母）
    expect(reference.cohortSize).toBe(4);
    expect(module.cohortSize).toBe(reference.cohortSize);
    expect(module.exposed).toBe(reference.exposed);
    expect(module.outcome).toBe(reference.outcome);
    expect(module.exposedWithOutcome).toBe(reference.exposedWithOutcome);
    expect(module.rate).toBeCloseTo(reference.rate, 12);
    expect(
      module.strata.map((s) => [s.key, s.exposed, s.exposedWithOutcome, s.cohortSize]),
    ).toEqual(reference.strata.map((s) => [s.key, s.exposed, s.exposedWithOutcome, s.cohortSize]));

    // 出域载荷只有聚合量：没有主体键、没有行
    const payload = pairedCohortPayload(module);
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain('subjectKey');
    expect(wire).not.toContain('s1');
    expect(payload).toMatchObject({ analysisType: 'paired-cohort', cohortSize: 4 });
    expect(result.envVarCount).toBe(0); // worker 不继承宿主环境变量
  });

  it('调用形状由宿主判死：pairing@1 缺 parties/strata → 拒，不启动 worker', async () => {
    const runner = new WasmSandboxRunner(new AuditService());
    const { projection } = (() => {
      const p = projectPairing(fixture());
      return { projection: p };
    })();
    await expect(
      runner.run({
        analysisType: PAIRING_MODULE_ANALYSIS_TYPE,
        moduleSm3: PAIRING_MODULE_SM3,
        moduleBytes: PAIRING_MODULE_BYTES,
        input: projection.input,
        abi: 'pairing@1',
        n: projection.subjects,
        k: projection.strata,
        outOff: projection.outOff,
        outBytes: projection.outBytes,
      }),
    ).rejects.toThrow(SandboxRunError);
  });

  it('参数越界由模块拒（parties>8 / strata>64）→ 沙箱如实报错，不越界读写', async () => {
    const { tables, strataKeys } = fixture();
    await expect(
      runThroughSandbox({ tables, strataKeys, partiesOverride: 9 }),
    ).rejects.toThrow(/run 返回非零/);
    await expect(
      runThroughSandbox({ tables, strataKeys, strataOverride: 65 }),
    ).rejects.toThrow(/run 返回非零/);
  });

  it('回填的不变量校验：输出被改过（交集规模超主体总数）即拒', async () => {
    const { tables, strataKeys } = fixture();
    const { projection } = await runThroughSandbox({ tables, strataKeys });
    const tampered = new Uint8Array(projection.outBytes);
    new DataView(tampered.buffer).setUint32(0, projection.subjects + 1, true);
    expect(() =>
      pairedCohortFromSandboxOutput({ projection, output: tampered, parties: [] }),
    ).toThrow(/不变量违反/);
  });

  it('单方配对即拒（协议里配对至少两方）', () => {
    const { tables } = fixture();
    expect(() => projectPairing({ tables: [tables[0]] })).toThrow(/至少需要两方/);
  });
});
