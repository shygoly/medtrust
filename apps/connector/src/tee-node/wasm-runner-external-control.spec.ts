import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExternalControlInput,
  ExternalControlRow,
} from '@medtrust/wasm-algorithms';
import {
  externalControlPayload,
  externalControlReference,
} from '../mdop/node/external-control-sandbox';
import { MdopError } from '@medtrust/mdop';
import { sponsorTrialProjection, hospitalControlProjection } from '../mdop/operators/seal';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { projectExternalControl } from '../mdop/node/external-control-sandbox';
import { registerNodeWasmOps, NODE_WASM_OPS, NODE_OPERATOR_FAILURE_MESSAGE } from './wasm-runner';

/**
 * 节点侧**单臂试验外部对照**（external-control-arm，评审遗留 7.3）：
 * 覆盖三处此前没有用例的面 —— 真沙箱 runner 分支、宿主适配 fail-closed、持有方封存投影。
 * 判据与 SCRI 用例同构：与参考语义逐字段一致；按角色绑定；投影只留最小字段。
 */

const BUILD = join(__dirname, '../../../../packages/wasm-algorithms/build');
const manifest = JSON.parse(readFileSync(join(BUILD, 'manifest.json'), 'utf8')) as {
  modules: Array<{ analysisType: string; file: string; sm3: string }>;
};
const entry = manifest.modules.find((m) => m.analysisType === 'external-control')!;
const BYTES = new Uint8Array(readFileSync(join(BUILD, entry.file)));
const DIGEST = `sm3:${entry.sm3}`;

const SPONSOR = 'urn:tds:sh-med:participant:p-sponsor-demo';
const HOSP = 'urn:tds:sh-med:participant:p-demohospb';
const STRATA = ['<40|M', '40+|F'];

const trialRows: ExternalControlRow[] = [
  { subjectKey: 'lk-sp-1', ageBand: '<40', sex: 'M', indexDate: '2021-01-10', outcome: 'pos' },
  { subjectKey: 'lk-sp-2', ageBand: '40+', sex: 'F', indexDate: '2021-02-01', outcome: 'neg' },
  { subjectKey: 'lk-sp-3', ageBand: '40+', sex: 'F', indexDate: '2021-02-20', outcome: 'pos' },
];
const controlRows: ExternalControlRow[] = [
  { subjectKey: 'lk-ct-1', ageBand: '<40', sex: 'M', indexDate: '2021-01-12', outcome: 'neg' },
  { subjectKey: 'lk-ct-2', ageBand: '<40', sex: 'M', indexDate: '2021-01-20', outcome: 'neg' },
  { subjectKey: 'lk-ct-3', ageBand: '40+', sex: 'F', indexDate: '2021-02-05', outcome: 'neg' },
  { subjectKey: 'lk-ct-4', ageBand: '40+', sex: 'F', indexDate: '2021-02-25', outcome: 'pos' },
  { subjectKey: 'lk-ct-5', ageBand: '40+', sex: 'F', indexDate: '2021-03-25', outcome: 'neg' }, // 超卡钳：不匹配
];

const INPUT: ExternalControlInput = {
  trialRows,
  controlRows,
  strataKeys: STRATA,
  caliperDays: 30,
  ratioK: 2,
};

function stage(parties: Array<{ ref: string; node: string }>, over: Record<string, unknown> = {}) {
  return {
    id: 'extCtl',
    node: 'urn:tds:sh-med:participant:tee-node-a',
    op: NODE_WASM_OPS.externalControl,
    op_digest: DIGEST,
    params: {
      parties,
      roles: { trial: SPONSOR, controls: HOSP },
      strataKeys: STRATA,
      caliperDays: 30,
      ratioK: 2,
      ...over,
    },
    inputs: parties.map((p) => ({ from: p.ref })),
    input_labels: ['C2', 'C2'] as const,
    output_label: 'C3' as const,
    output_schema: 'rws.external-control/1.0',
  };
}

const MANIFEST = {
  apiVersion: 'mdop/v1',
  kind: 'wasm',
  id: 'rws.external-control',
  version: '1.0.0',
  category: 'collab',
  digest: DIGEST,
  publisher: 'urn:tds:sh-med:operator-registry',
  inputs: [
    { name: 'trial', schema: 'mdop.projection/1.0', accept_labels: ['C2'] },
    { name: 'controls', schema: 'mdop.projection/1.0', accept_labels: ['C2'] },
  ],
  outputs: [{ name: 'externalControl', schema: 'rws.external-control/1.0', label_rule: 'inherit' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  build: { source_digest: `sm3:${'7'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
};

async function run(order: 'trial-first' | 'controls-first', over: Record<string, unknown> = {}) {
  const parties =
    order === 'trial-first'
      ? [
          { ref: 't', node: SPONSOR },
          { ref: 'c', node: HOSP },
        ]
      : [
          { ref: 'c', node: HOSP },
          { ref: 't', node: SPONSOR },
        ];
  const mdop = new MdopStageExecutor();
  registerNodeWasmOps(mdop, { moduleBytes: (d) => (d === entry.sm3 ? BYTES : undefined) });
  return mdop.execute(
    {
      jobId: 'job-ext-ctl',
      stage: stage(parties, over) as never,
      inputs: new Map([
        ['t', { rows: trialRows } as unknown as Record<string, unknown>],
        ['c', { rows: controlRows } as unknown as Record<string, unknown>],
      ]),
      attempt: 1,
    },
    MANIFEST,
  );
}

describe('节点侧单臂试验外部对照（external-control-arm 7.3）', () => {
  it('真字节 + 真沙箱：与参考语义逐字段一致', async () => {
    const out = await run('trial-first');
    expect(out.label).toBe('C3');
    expect(out.payload).toEqual(
      externalControlPayload(externalControlReference(INPUT)) as never,
    );
  });

  it('按角色绑定：调换输入顺序结果不变', async () => {
    const a = await run('trial-first');
    const b = await run('controls-first');
    expect(b.payload).toEqual(a.payload);
  });

  it('宿主适配 fail-closed：某行缺 ageBand/sex 即整阶段失败（不静默放过）', async () => {
    const mdop = new MdopStageExecutor();
    registerNodeWasmOps(mdop, { moduleBytes: (d) => (d === entry.sm3 ? BYTES : undefined) });
    const bad = [{ ...trialRows[0], ageBand: undefined }] as unknown as ExternalControlRow[];
    await expect(
      mdop.execute(
        {
          jobId: 'job-ext-bad',
          stage: stage([
            { ref: 't', node: SPONSOR },
            { ref: 'c', node: HOSP },
          ]) as never,
          inputs: new Map([
            ['t', { rows: bad } as unknown as Record<string, unknown>],
            ['c', { rows: controlRows } as unknown as Record<string, unknown>],
          ]),
          attempt: 1,
        },
        MANIFEST,
      ),
    ).rejects.toThrow(MdopError);
  });

  it('缺 strataKeys：拒绝执行（本场景必须显式给分层）', async () => {
    await expect(
      run('trial-first', { strataKeys: undefined }),
    ).rejects.toThrow(/strataKeys|外部对照/);
  });

  it('跨池互斥（TD-15）：同一受试者同时出现在两池 -> 从对照池剔除，不会被配成自己的对照', () => {
    const shared = trialRows[0].subjectKey;
    const withShared = [
      // 把试验池里的同一主体也放进对照池（模拟同一人在两池都有记录）
      { ...controlRows[0], subjectKey: shared },
      ...controlRows,
    ];
    const projection = projectExternalControl({
      trialRows,
      controlRows: withShared,
      strataKeys: STRATA,
      caliperDays: 30,
      ratioK: 2,
    });
    // 对照侧总数为剔除后的条数（跨池那一份不再进入编码）
    expect(projection.controls).toBe(controlRows.length);
  });

  it('封存投影：只留最小字段 + 硬编码来源标记；缺 linkKey/索引日/结局不出院', () => {
    const proj = sponsorTrialProjection({
      productId: 'dp-trial-sponsor',
      snapshot: 's',
      rows: [
        {
          subjectKey: 'sp-1',
          linkKey: 'lk-sp-1',
          ageBand: '<40',
          sex: 'M',
          indexDate: '2021-01-10',
          outcome: 'pos',
          conditions: ['x'],
        },
        { subjectKey: 'sp-2', ageBand: '<40', sex: 'M', indexDate: '2021-01-11', outcome: 'pos' }, // 缺 linkKey
        { subjectKey: 'sp-3', linkKey: 'lk-sp-3', ageBand: '<40', sex: 'M', outcome: 'pos' }, // 缺索引日
      ],
    });
    expect(proj.rows).toEqual([
      {
        subjectKey: 'lk-sp-1',
        indexDate: '2021-01-10',
        outcome: 'pos',
        ageBand: '<40',
        sex: 'M',
        synthetic: true,
        dataSource: 'sponsor-trial',
      },
    ]);
    expect(proj.n).toBe(1);
    const ctl = hospitalControlProjection({
      productId: 'dp-controls-hosp',
      snapshot: 's',
      rows: [
        { subjectKey: 'ct-1', linkKey: 'lk-ct-1', ageBand: '<40', sex: 'M', indexDate: '2021-01-12', outcome: 'neg' },
      ],
    });
    expect(ctl.rows).toEqual([
      {
        subjectKey: 'lk-ct-1',
        indexDate: '2021-01-12',
        outcome: 'neg',
        ageBand: '<40',
        sex: 'M',
        synthetic: true,
        dataSource: 'hospital-controls',
      },
    ]);
  });
});
