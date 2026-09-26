import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { OutputGate } from '../domain/output-gate';
import {
  PAIRING_MODULE_BYTES,
  PAIRING_MODULE_SM3,
} from '../domain/sandbox/__fixtures__/pairing-module';
import { NodePublicationReview } from '../mdop/node/publication-review';
import { NODE_DECLASSIFY_OP } from './declassify-op';
import { createNodeExecutor } from './executor';
import { NODE_WASM_OPS } from './wasm-runner';

/**
 * 节点**执行面装配**（任务 3.12f）：一次接齐 system（降密）与 wasm（配对）两类算子，
 * 并且**两类都真的能跑**——这一支存在的理由就是「少接一半，那个阶段在生产里一步也跑不了」。
 */

const MEAS = `sm3:${'a'.repeat(64)}`;
const MODULE_SM3 = `sm3:${PAIRING_MODULE_SM3}`;
const STRATA = ['60-69|F'];

const PAIR_MANIFEST = {
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

const DEC_MANIFEST = {
  apiVersion: 'mdop/v0.2',
  kind: 'system',
  id: 'declassify.small_cell',
  version: '1.0.0',
  category: 'declassify',
  digest: 'component:node-publication-review@1',
  publisher: 'urn:tds:platform',
  inputs: [{ name: 'in', schema: 'rws.paired-cohort@1', accept_labels: ['C2'] }],
  outputs: [{ name: 'out', schema: 'mdop.table/1.0', label_rule: 'C3' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  component: 'node-publication-review@1.0.0',
};

function executor() {
  return createNodeExecutor({
    review: new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier())),
    moduleBytes: (digest) => (digest === PAIRING_MODULE_SM3 ? PAIRING_MODULE_BYTES : undefined),
    strataKeys: STRATA,
  }).executor;
}

describe('节点执行面装配（任务 3.12f）', () => {
  it('两类算子在同一个执行器上都已接线：配对（wasm，真字节）→ 降密（system，真审查）', async () => {
    const mdop = executor();
    // ① wasm：配对（走沙箱，5 参 ABI）
    const paired = await mdop.execute(
      {
        jobId: 'job-1',
        stage: {
          id: 'pair',
          node: 'urn:tds:sh-med:participant:tee-1',
          op: NODE_WASM_OPS.pairedCohort,
          op_digest: MODULE_SM3,
          params: {
            parties: [
              { ref: 'ref-a', node: 'urn:tds:sh-med:participant:p-huashan' },
              { ref: 'ref-b', node: 'urn:tds:sh-med:participant:p-ruijin' },
            ],
          },
          inputs: [{ from: 'ref-a' }, { from: 'ref-b' }],
          input_labels: ['C2', 'C2'],
          output_label: 'C2',
          output_schema: 'rws.paired-cohort@1',
        } as never,
        inputs: new Map([
          [
            'ref-a',
            {
              rows: [{ subjectKey: 's1', exposure: true, outcome: false, ageBand: '60-69', sex: 'F' }],
            } as unknown as Record<string, unknown>,
          ],
          [
            'ref-b',
            {
              rows: [{ subjectKey: 's1', exposure: false, outcome: true, ageBand: '60-69', sex: 'F' }],
            } as unknown as Record<string, unknown>,
          ],
        ]),
        attempt: 1,
      },
      PAIR_MANIFEST,
    );
    expect(paired.label).toBe('C2');
    expect(paired.payload).toMatchObject({ analysisType: 'paired-cohort', cohortSize: 1, exposedWithOutcome: 1 });
    // 出域载荷必须带**规范分层表**（平台收集方按它校验/求和）——只出 buckets 会被以「缺分层表」拒
    expect(Array.isArray(paired.payload.strata)).toBe(true);

    // ② system：降密（走发布审查，输出恒 C3；这里 1 人的格子会被抑制）
    const released = await mdop.execute(
      {
        jobId: 'job-1',
        stage: {
          id: 'dec',
          node: 'urn:tds:sh-med:participant:tee-1',
          op: NODE_DECLASSIFY_OP,
          op_digest: 'component:node-publication-review@1',
          params: { minCell: 5 },
          inputs: [{ from: 'pair' }],
          input_labels: ['C2'],
          output_label: 'C3',
          output_schema: 'mdop.table/1.0',
        } as never,
        inputs: new Map([['pair', paired.payload]]),
        attempt: 1,
      },
      DEC_MANIFEST,
    );
    expect(released.label).toBe('C3');
    expect((released.payload.buckets as Array<{ count: number }>)[0].count).toBe(0);
    // 分层表与抑制后的计数**一致**：被抑制的分层整格清零并标记（平台不会拿到未抑制的分层计数）
    expect((released.payload.strata as Array<Record<string, unknown>>)[0]).toMatchObject({
      key: STRATA[0],
      exposed: 0,
      exposedWithOutcome: 0,
      suppressed: true,
    });
  });

  it('未接线的算子一律拒（不回退到内置实现）', async () => {
    const mdop = executor();
    await expect(
      mdop.execute(
        {
          jobId: 'job-1',
          stage: {
            id: 'x',
            node: 'n',
            op: 'rws.unknown@1.0.0',
            op_digest: MEAS,
            params: {},
            inputs: [],
            input_labels: [],
            output_label: 'C0',
            output_schema: 'mdop.unknown/1.0',
          } as never,
          inputs: new Map(),
          attempt: 1,
        },
        { ...PAIR_MANIFEST, id: 'rws.unknown', kind: 'wasm' },
      ),
    ).rejects.toMatchObject({ code: 'E_CAPABILITY_MISMATCH' });
  });
});
