import {
  DISTINCT_COUNT_MODULE_BYTES,
  DISTINCT_COUNT_MODULE_SM3,
} from '../domain/sandbox/__fixtures__/distinct-count-module';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { distinctCount, type DistinctCountRow } from '@medtrust/wasm-algorithms';
import { NODE_WASM_OPS, registerNodeWasmOps } from './wasm-runner';

/**
 * 节点侧去重人数 wasm 执行接线（C2 T6）。
 *
 * 钉三件事：算子没实现 / 摘要不符 / 模块字节缺失 → **调用前就拒**（不回退）；
 * 实现了的算子则真的走沙箱跑出结果，且**等级由阶段声明**。
 */

const OP = NODE_WASM_OPS.distinctCount;
const MODULE_SM3 = `sm3:${DISTINCT_COUNT_MODULE_SM3}`;
const STRATA = ['60-69|F', '70-79|M'];

function rows(): DistinctCountRow[] {
  return [
    { subjectKey: 's1', ageBand: '60-69', sex: 'F' },
    { subjectKey: 's1', ageBand: '60-69', sex: 'F' },
    { subjectKey: 's2', ageBand: '60-69', sex: 'F' },
    { subjectKey: 's3', ageBand: '70-79', sex: 'M' },
    { subjectKey: 's2', ageBand: '70-79', sex: 'M' },
    { subjectKey: 's4', ageBand: '70-79', sex: 'M' },
  ];
}

function stage() {
  return {
    id: 'distinct',
    node: 'urn:tds:sh-med:participant:tee-1',
    op: OP,
    op_digest: MODULE_SM3,
    params: { dataset: { ref: 'ref-a' } },
    inputs: [{ from: 'ref-a' }],
    input_labels: ['C2'] as const,
    output_label: 'C2' as const,
    output_schema: 'rws.distinct-count@1',
  };
}

function executor(deps: { moduleBytes?: (digest: string) => Uint8Array | undefined }) {
  const mdop = new MdopStageExecutor();
  registerNodeWasmOps(mdop, {
    moduleBytes:
      deps.moduleBytes ??
      ((digest) => (digest === DISTINCT_COUNT_MODULE_SM3 ? DISTINCT_COUNT_MODULE_BYTES : undefined)),
    strataKeys: STRATA,
  });
  return mdop;
}

const MANIFEST = {
  apiVersion: 'mdop/v1',
  kind: 'wasm',
  id: 'rws.distinct-count',
  version: '1.0.0',
  category: 'local',
  digest: MODULE_SM3,
  publisher: 'urn:tds:sh-med:operator-registry',
  inputs: [{ name: 'dataset', schema: 'mdop.projection@1', accept_labels: ['C2'] }],
  outputs: [{ name: 'counts', schema: 'rws.distinct-count@1', label_rule: 'inherit' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  build: { source_digest: `sm3:${'7'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
};

describe('节点侧去重人数 wasm 执行接线（C2 T6）', () => {
  it('真字节 + 真沙箱：去重人数算子按分层输出去重主体数，等级由阶段声明（C2）', async () => {
    const data = rows();
    const out = await executor({}).execute(
      {
        jobId: 'job-1',
        stage: stage() as never,
        inputs: new Map([['ref-a', { rows: data } as unknown as Record<string, unknown>]]),
        attempt: 1,
      },
      MANIFEST,
    );
    const reference = distinctCount({ rows: data, strataKeys: STRATA });
    expect(out.label).toBe('C2');
    expect(out.payload.totalDistinct).toBe(reference.totalDistinct);
    expect(out.payload.strata).toEqual(reference.strata);
    expect(JSON.stringify(out.payload)).not.toContain('subjectKey');
    expect(JSON.stringify(out.payload)).not.toContain('s1');
  });

  it('去重人数算子摘要与清单不符 → 拒（不回退到内置实现）', async () => {
    await expect(
      executor({}).execute(
        {
          jobId: 'job-1',
          stage: { ...stage(), op_digest: `sm3:${'9'.repeat(64)}` } as never,
          inputs: new Map([['ref-a', { rows: rows() } as unknown as Record<string, unknown>]]),
          attempt: 1,
        },
        MANIFEST,
      ),
    ).rejects.toMatchObject({ code: 'E_CAPABILITY_MISMATCH' });
  });

  it('去重人数算子模块字节缺失 → 拒（不回退到内置实现）', async () => {
    await expect(
      executor({ moduleBytes: () => undefined }).execute(
        {
          jobId: 'job-1',
          stage: stage() as never,
          inputs: new Map([['ref-a', { rows: rows() } as unknown as Record<string, unknown>]]),
          attempt: 1,
        },
        MANIFEST,
      ),
    ).rejects.toMatchObject({ code: 'E_CAPABILITY_MISMATCH' });
  });

  it('本节点没实现的算子 → 拒（不回退到内置实现）', async () => {
    await expect(
      executor({}).execute(
        {
          jobId: 'job-1',
          stage: { ...stage(), op: 'rws.other@1.0.0' } as never,
          inputs: new Map(),
          attempt: 1,
        },
        { ...MANIFEST, id: 'rws.other' },
      ),
    ).rejects.toMatchObject({ code: 'E_CAPABILITY_MISMATCH' });
  });
});
