import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriCount, type ScriRegistryRow, type ScriEventRow } from '@medtrust/wasm-algorithms';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { NODE_WASM_OPS, registerNodeWasmOps } from './wasm-runner';
import { scriRegistryProjection, scriEventProjection } from '../mdop/operators/seal';

/**
 * 节点侧 SCRI（疫苗接种后不良事件自身对照风险期）：真模块字节 + 真沙箱。
 * 钉三件事：结果与参考语义逐字段一致；按**角色**绑定输入（调换输入顺序结果不变）；
 * 持有方侧封存投影只留目标字段、没有关联假名的记录不出院。
 */

const BUILD = join(__dirname, '../../../../packages/wasm-algorithms/build');
const manifest = JSON.parse(readFileSync(join(BUILD, 'manifest.json'), 'utf8')) as {
  modules: Array<{ analysisType: string; file: string; sm3: string }>;
};
const entry = manifest.modules.find((m) => m.analysisType === 'vaccine-scri')!;
const BYTES = new Uint8Array(readFileSync(join(BUILD, entry.file)));
const DIGEST = `sm3:${entry.sm3}`;

const CDC = 'urn:tds:sh-med:participant:p-cdc-demo';
const HOSP = 'urn:tds:sh-med:participant:p-ruijin';
const WINDOWS = { risk: [1, 7] as [number, number], control: [-42, -22] as [number, number] };

const registry: ScriRegistryRow[] = [
  { subjectKey: 'lk-a', vaccinationDate: '2021-05-01', vaccineCode: '208', ageBand: '<40', sex: 'M' },
  { subjectKey: 'lk-a', vaccinationDate: '2021-05-22', vaccineCode: '208', ageBand: '<40', sex: 'M' },
  { subjectKey: 'lk-b', vaccinationDate: '2021-06-01', vaccineCode: '207', ageBand: '40+', sex: 'F' },
  { subjectKey: 'lk-c', vaccinationDate: '2021-06-01', vaccineCode: '140', ageBand: '40+', sex: 'F' },
];
const events: ScriEventRow[] = [
  { subjectKey: 'lk-a', eventDate: '2021-05-03', eventCode: 'I40.9' }, // 第 1 剂 +2：风险期；第 2 剂 −19：不计
  { subjectKey: 'lk-a', eventDate: '2021-03-25', eventCode: 'I30.9' }, // 第 1 剂 −37：对照期；第 2 剂 −58：不计
  { subjectKey: 'lk-b', eventDate: '2021-04-25', eventCode: 'I40.9' }, // −37：对照期
  { subjectKey: 'lk-c', eventDate: '2021-06-03', eventCode: 'I40.9' }, // 非目标疫苗：不计
];

function stage(parties: Array<{ ref: string; node: string }>) {
  return {
    id: 'scri',
    node: 'urn:tds:sh-med:participant:tee-node-a',
    op: NODE_WASM_OPS.vaccineScri,
    op_digest: DIGEST,
    params: {
      parties,
      roles: { registry: CDC, events: HOSP },
      riskWindow: WINDOWS.risk,
      controlWindow: WINDOWS.control,
      vaccineCodes: ['207', '208'],
      eventCodes: ['I40.9', 'I30.9'],
    },
    inputs: parties.map((p) => ({ from: p.ref })),
    input_labels: ['C2', 'C2'] as const,
    output_label: 'C2' as const,
    output_schema: 'rws.vaccine-scri/1.0',
  };
}

const MANIFEST = {
  apiVersion: 'mdop/v1',
  kind: 'wasm',
  id: 'rws.vaccine-scri',
  version: '1.0.0',
  category: 'collab',
  digest: DIGEST,
  publisher: 'urn:tds:sh-med:operator-registry',
  inputs: [
    { name: 'registry', schema: 'mdop.projection/1.0', accept_labels: ['C2'] },
    { name: 'events', schema: 'mdop.projection/1.0', accept_labels: ['C2'] },
  ],
  outputs: [{ name: 'scri', schema: 'rws.vaccine-scri/1.0', label_rule: 'inherit' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  build: { source_digest: `sm3:${'7'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
};

async function run(order: 'registry-first' | 'events-first') {
  const mdop = new MdopStageExecutor();
  registerNodeWasmOps(mdop, { moduleBytes: (d) => (d === entry.sm3 ? BYTES : undefined) });
  const parties =
    order === 'registry-first'
      ? [{ ref: 'r', node: CDC }, { ref: 'e', node: HOSP }]
      : [{ ref: 'e', node: HOSP }, { ref: 'r', node: CDC }];
  return mdop.execute(
    {
      jobId: 'job-scri',
      stage: stage(parties) as never,
      inputs: new Map([
        ['r', { rows: registry } as unknown as Record<string, unknown>],
        ['e', { rows: events } as unknown as Record<string, unknown>],
      ]),
      attempt: 1,
    },
    MANIFEST,
  );
}

describe('节点侧 SCRI（疫苗接种后不良事件）', () => {
  it('真字节 + 真沙箱：与参考语义逐字段一致，等级由阶段声明', async () => {
    const out = await run('registry-first');
    expect(out.label).toBe('C2');
    const ref = scriCount({
      registry,
      events,
      windows: WINDOWS,
      vaccineCodes: ['207', '208'],
      eventCodes: ['I40.9', 'I30.9'],
    });
    expect((out.payload as { strata: unknown }).strata).toEqual(ref.strata);
    expect(ref.strata).toEqual([
      { key: '40+|F', doses: 1, riskEvents: 0, controlEvents: 1 },
      { key: '<40|M', doses: 2, riskEvents: 1, controlEvents: 1 },
    ]);
    expect(JSON.stringify(out.payload)).not.toContain('lk-');
  });

  it('按角色绑定：调换输入顺序结果不变', async () => {
    const a = await run('registry-first');
    const b = await run('events-first');
    expect(b.payload).toEqual(a.payload);
  });

  it('封存投影：只留目标字段；没有关联假名的记录不出院', () => {
    const reg = scriRegistryProjection({
      productId: 'dp-aefi-immunization-cdc',
      snapshot: 's',
      rows: [
        { subjectKey: 'cdc-1', linkKey: 'lk-a', ageBand: '<40', sex: 'M', conditions: ['x'], immunizations: [{ code: '208', date: '2021-05-01' }, { code: '140', date: '2021-10-01' }] },
        { subjectKey: 'cdc-2', ageBand: '40+', sex: 'F', immunizations: [{ code: '208', date: '2021-05-01' }] },
      ],
    }, ['207', '208']);
    expect(reg.rows).toEqual([{ subjectKey: 'lk-a', vaccinationDate: '2021-05-01', vaccineCode: '208', ageBand: '<40', sex: 'M' }]);
    const evt = scriEventProjection({
      productId: 'dp-aefi-events-ruijin',
      snapshot: 's',
      rows: [{ subjectKey: 'ruijin-1', linkKey: 'lk-a', datedEvents: [{ code: 'I40.9', date: '2021-05-03' }, { code: 'J10.1', date: '2021-05-09' }], conditions: ['y'] }],
    }, ['I40.9', 'I30.9']);
    expect(evt.rows).toEqual([{ subjectKey: 'lk-a', eventDate: '2021-05-03', eventCode: 'I40.9' }]);
  });
});
