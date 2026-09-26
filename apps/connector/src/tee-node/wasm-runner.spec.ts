import {
  PAIRING_MODULE_BYTES,
  PAIRING_MODULE_SM3,
} from '../domain/sandbox/__fixtures__/pairing-module';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { pairIntersection, type PairPartyTable, type PseudonymRow } from '@medtrust/wasm-algorithms';
import { NODE_WASM_OPS, registerNodeWasmOps } from './wasm-runner';

/**
 * 节点侧 wasm 执行接线（任务 3.12f）。
 *
 * 钉三件事：算子没实现 / 摘要不符 / 模块字节缺失 → **调用前就拒**（不回退）；
 * 实现了的算子则真的走沙箱跑出结果，且**等级由阶段声明**（模块不能给自己定 C3）。
 */

const OP = NODE_WASM_OPS.pairedCohort;
const MODULE_SM3 = `sm3:${PAIRING_MODULE_SM3}`;
const STRATA = ['60-69|F', '70-79|M'];

function rows(keys: string[]): PseudonymRow[] {
  return keys.map((subjectKey, i) => ({
    subjectKey,
    exposure: i % 2 === 0,
    outcome: i % 3 === 0,
    ageBand: i % 2 === 0 ? '60-69' : '70-79',
    sex: i % 2 === 0 ? 'F' : 'M',
  }));
}

function stage(inputs: Array<{ ref: string; node: string }>) {
  return {
    id: 'pair',
    node: 'urn:tds:sh-med:participant:tee-1',
    op: OP,
    op_digest: MODULE_SM3,
    params: { parties: inputs },
    inputs: inputs.map((i) => ({ from: i.ref })),
    input_labels: ['C2', 'C2'] as const,
    output_label: 'C2' as const,
    output_schema: 'rws.paired-cohort@1',
  };
}

function executor(deps: { moduleBytes?: (digest: string) => Uint8Array | undefined }) {
  const mdop = new MdopStageExecutor();
  registerNodeWasmOps(mdop, {
    moduleBytes: deps.moduleBytes ?? ((digest) => (digest === PAIRING_MODULE_SM3 ? PAIRING_MODULE_BYTES : undefined)),
    strataKeys: STRATA,
  });
  return mdop;
}

const MANIFEST = {
  apiVersion: 'mdop/v1',
  kind: 'wasm',
  id: 'rws.paired-cohort',
  version: '1.0.0',
  category: 'collab',
  digest: MODULE_SM3,
  publisher: 'urn:tds:sh-med:operator-registry',
  inputs: [
    { name: 'left', schema: 'mdop.projection@1', accept_labels: ['C0', 'C2'] },
    { name: 'right', schema: 'mdop.projection@1', accept_labels: ['C0', 'C2'] },
  ],
  outputs: [{ name: 'paired', schema: 'rws.paired-cohort@1', label_rule: 'inherit' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  build: { source_digest: `sm3:${'7'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
};

describe('节点侧 wasm 执行接线（任务 3.12f）', () => {
  it('真字节 + 真沙箱：配对结果与参考语义一致，等级由阶段声明（C2）', async () => {
    const a = rows(['s1', 's2', 's3', 'a-only']);
    const b = rows(['s1', 's2', 's3', 'b-only']);
    const inputs = [
      { ref: 'ref-a', node: 'urn:tds:sh-med:participant:p-huashan' },
      { ref: 'ref-b', node: 'urn:tds:sh-med:participant:p-ruijin' },
    ];
    const out = await executor({}).execute(
      {
        jobId: 'job-1',
        stage: stage(inputs) as never,
        inputs: new Map([
          ['ref-a', { rows: a } as unknown as Record<string, unknown>],
          ['ref-b', { rows: b } as unknown as Record<string, unknown>],
        ]),
        attempt: 1,
      },
      MANIFEST,
    );
    const reference = pairIntersection({
      tables: [
        { node: inputs[0].node, rows: a } as PairPartyTable,
        { node: inputs[1].node, rows: b } as PairPartyTable,
      ],
    });
    expect(out.label).toBe('C2'); // 阶段声明等级；模块没有给自己定级
    expect(out.payload.cohortSize).toBe(reference.cohortSize);
    expect(out.payload.exposedWithOutcome).toBe(reference.exposedWithOutcome);
    expect(out.payload.rate).toBeCloseTo(reference.rate, 12);
    // 出域载荷只有聚合量
    expect(JSON.stringify(out.payload)).not.toContain('subjectKey');
    expect(JSON.stringify(out.payload)).not.toContain('a-only');
  });

  it('本节点没实现的算子 → 拒（不回退到内置实现）', async () => {
    await expect(
      executor({}).execute(
        {
          jobId: 'job-1',
          stage: { ...stage([{ ref: 'a', node: 'x' }, { ref: 'b', node: 'y' }]), op: 'rws.other@1.0.0' } as never,
          inputs: new Map(),
          attempt: 1,
        },
        { ...MANIFEST, id: 'rws.other' },
      ),
    ).rejects.toMatchObject({ code: 'E_CAPABILITY_MISMATCH' });
  });

  it('阶段摘要与清单不符 / 本节点没有该模块字节 → 拒', async () => {
    const inputs = [{ ref: 'ref-a', node: 'x' }, { ref: 'ref-b', node: 'y' }];
    const inputMap = new Map([
      ['ref-a', { rows: rows(['s1', 's2']) } as unknown as Record<string, unknown>],
      ['ref-b', { rows: rows(['s1', 's2']) } as unknown as Record<string, unknown>],
    ]);
    await expect(
      executor({}).execute(
        {
          jobId: 'job-1',
          stage: { ...stage(inputs), op_digest: `sm3:${'9'.repeat(64)}` } as never,
          inputs: inputMap,
          attempt: 1,
        },
        MANIFEST,
      ),
    ).rejects.toMatchObject({ code: 'E_CAPABILITY_MISMATCH' });
    await expect(
      executor({ moduleBytes: () => undefined }).execute(
        { jobId: 'job-1', stage: stage(inputs) as never, inputs: inputMap, attempt: 1 },
        MANIFEST,
      ),
    ).rejects.toMatchObject({ code: 'E_CAPABILITY_MISMATCH' });
  });

  it('缺 parties 绑定 / 输入对不上 → 拒（不按 Map 遍历顺序猜谁是谁）', async () => {
    const inputs = [{ ref: 'ref-a', node: 'x' }, { ref: 'ref-b', node: 'y' }];
    const inputMap = new Map([
      ['ref-a', { rows: rows(['s1', 's2']) } as unknown as Record<string, unknown>],
      ['ref-b', { rows: rows(['s1', 's2']) } as unknown as Record<string, unknown>],
    ]);
    await expect(
      executor({}).execute(
        {
          jobId: 'job-1',
          stage: { ...stage(inputs), params: {} } as never,
          inputs: inputMap,
          attempt: 1,
        },
        MANIFEST,
      ),
    ).rejects.toMatchObject({ code: 'E_RUNTIME' });
    await expect(
      executor({}).execute(
        {
          jobId: 'job-1',
          stage: stage([{ ref: 'ref-missing', node: 'x' }, { ref: 'ref-b', node: 'y' }]) as never,
          inputs: inputMap,
          attempt: 1,
        },
        MANIFEST,
      ),
    ).rejects.toMatchObject({ code: 'E_RUNTIME' });
  });
});
