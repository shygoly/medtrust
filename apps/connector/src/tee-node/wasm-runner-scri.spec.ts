import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriCount, type ScriRegistryRow, type ScriEventRow } from '@medtrust/wasm-algorithms';
import { MdopError } from '@medtrust/mdop';
import type { WasmSandboxRunner } from '../domain/sandbox/sandbox-runner';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import {
  NODE_OPERATOR_FAILURE_MESSAGE,
  NODE_WASM_OPS,
  registerNodeWasmOps,
  type NodeWasmDeps,
} from './wasm-runner';
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
const HOSP = 'urn:tds:sh-med:participant:p-demohospb';
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
      productId: 'dp-aefi-events-demohospb',
      snapshot: 's',
      rows: [{ subjectKey: 'demohospb-1', linkKey: 'lk-a', datedEvents: [{ code: 'I40.9', date: '2021-05-03' }, { code: 'J10.1', date: '2021-05-09' }], conditions: ['y'] }],
    }, ['I40.9', 'I30.9']);
    expect(evt.rows).toEqual([{ subjectKey: 'lk-a', eventDate: '2021-05-03', eventCode: 'I40.9' }]);
  });
});

/**
 * 评审遗留（2026-10-07）的三条规矩，都钉在节点跑算子的那一个入口上：
 *  ① 编码白名单参数给了就必须逐项合规（无效 ≠ 不过滤）；不给放行（持有方封存时已强制）；
 *  ② `strataKeys` 参数与结果里的每个层键都必须符合闭合语法，否则本阶段失败、到不了发布审查；
 *  ③ 算子执行期的错误文案不带数据：原文只进节点本地日志，对外是固定文案。
 */
describe('节点侧 SCRI：白名单 fail-closed / 分层键闭合语法 / 错误文案不带数据', () => {
  const PARTIES = [
    { ref: 'r', node: CDC },
    { ref: 'e', node: HOSP },
  ];

  function exec(
    over: {
      /** 覆盖阶段参数；值为 `undefined` 的键会被**删掉**（= 不给这个参数）。 */
      params?: Record<string, unknown>;
      registryRows?: unknown[];
      eventRows?: unknown[];
      deps?: Partial<NodeWasmDeps>;
    } = {},
  ) {
    const mdop = new MdopStageExecutor();
    registerNodeWasmOps(mdop, {
      moduleBytes: (d) => (d === entry.sm3 ? BYTES : undefined),
      ...over.deps,
    });
    const base = stage(PARTIES);
    const params: Record<string, unknown> = { ...base.params, ...over.params };
    for (const [name, value] of Object.entries(over.params ?? {}))
      if (value === undefined) delete params[name];
    return mdop.execute(
      {
        jobId: 'job-scri',
        stage: { ...base, params } as never,
        inputs: new Map([
          ['r', { rows: over.registryRows ?? registry } as unknown as Record<string, unknown>],
          ['e', { rows: over.eventRows ?? events } as unknown as Record<string, unknown>],
        ]),
        attempt: 1,
      },
      MANIFEST,
    );
  }

  const strataOf = (out: { payload: Record<string, unknown> }) =>
    (out.payload as { strata: Array<{ key: string; doses: number }> }).strata;

  describe('① 编码白名单参数', () => {
    const INVALID: unknown[] = [null, [], '208', { 0: '208' }, ['208', 207], ['208', ''], ['  ']];

    it('给了但无效（空 / 非数组 / 夹着非字符串或空串）→ 拒，绝不当成「不过滤」', async () => {
      for (const name of ['vaccineCodes', 'eventCodes']) {
        for (const invalid of INVALID) {
          await expect(exec({ params: { [name]: invalid } })).rejects.toMatchObject({
            name: 'MdopError',
            code: 'E_RUNTIME',
            message: expect.stringContaining(`${name} 不是有效的编码白名单`),
          });
        }
      }
    });

    it('不给（undefined）放行：节点不再过滤——持有方封存时白名单必填，进节点的投影已过滤过', async () => {
      const out = await exec({ params: { vaccineCodes: undefined, eventCodes: undefined } });
      const ref = scriCount({ registry, events, windows: WINDOWS });
      expect(strataOf(out)).toEqual(ref.strata);
      // 没有疫苗白名单时 lk-c 的那一剂（编码 140）也计入：这正是「节点不过滤」的含义
      expect(strataOf(out).find((s) => s.key === '40+|F')!.doses).toBe(2);
    });
  });

  describe('② 分层键', () => {
    const FREE_TEXT = '既往心肌炎-住院号88231';

    it('strataKeys 合规：按给定顺序固定分层（没有数据的层照出零值）', async () => {
      const out = await exec({ params: { strataKeys: ['<40|M', '<40|F', '40+|F'] } });
      expect(strataOf(out).map((s) => s.key)).toEqual(['<40|M', '<40|F', '40+|F']);
      expect(strataOf(out)[1]).toEqual({ key: '<40|F', doses: 0, riskEvents: 0, controlEvents: 0 });
    });

    it('strataKeys 不合规（自由文本 / 少一个分量 / 重复 / 不是数组 / 超过 64 个）→ 拒，说明不回显那段文本', async () => {
      const bad: unknown[] = [
        ['<40|M', `${FREE_TEXT}|M`],
        ['<40'],
        ['<40|M', '<40|M'],
        '<40|M',
        null,
        ['<40|M', 7],
        Array.from({ length: 65 }, (_, i) => `${i}-${i + 1}|F`),
      ];
      for (const strataKeys of bad) {
        const error = await exec({ params: { strataKeys } }).then(
          () => undefined,
          (err: unknown) => err,
        );
        expect(error).toBeInstanceOf(MdopError);
        expect((error as MdopError).code).toBe('E_RUNTIME');
        expect((error as Error).message).toContain('strataKeys 不合规');
        expect((error as Error).message).not.toContain(FREE_TEXT);
      }
    });

    it('没给 strataKeys、行里的 ageBand / sex 是自由文本 → 结果层键过不了语法，本阶段失败（到不了发布审查）', async () => {
      for (const patch of [{ ageBand: FREE_TEXT }, { sex: FREE_TEXT }, { ageBand: '40+|F' }]) {
        const error = await exec({
          registryRows: [...registry, { ...registry[0], subjectKey: 'lk-x', ...patch }],
        }).then(
          () => undefined,
          (err: unknown) => err,
        );
        expect(error).toBeInstanceOf(MdopError);
        expect((error as MdopError).code).toBe('E_RELEASE_CHECK_FAILED');
        expect((error as Error).message).toContain('不符合闭合语法的分层键');
        expect((error as Error).message).not.toContain(FREE_TEXT);
      }
    });

    it('给了 strataKeys：固定分层之外的行不计，自由文本也就进不了结果', async () => {
      const out = await exec({
        params: { strataKeys: ['40+|F', '<40|M'] },
        registryRows: [...registry, { ...registry[0], subjectKey: 'lk-x', ageBand: FREE_TEXT }],
      });
      expect(strataOf(out).map((s) => s.key)).toEqual(['40+|F', '<40|M']);
      expect(JSON.stringify(out.payload)).not.toContain(FREE_TEXT);
    });
  });

  describe('③ 错误文案不带数据', () => {
    const ROW_VALUE = '门诊号A12345-王某某';
    const capture = () => {
      const lines: string[] = [];
      return { lines, logger: { error: (message: string) => void lines.push(message) } };
    };

    it('参考模型的报错带行值（日期不可解析：<取值>）→ 对外固定文案；原文只进节点本地日志（带作业号与阶段号）', async () => {
      const log = capture();
      const error = await exec({
        eventRows: [...events, { subjectKey: 'lk-a', eventDate: ROW_VALUE, eventCode: 'I40.9' }],
        deps: { logger: log.logger },
      }).then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(MdopError);
      expect((error as MdopError).code).toBe('E_RUNTIME');
      expect((error as Error).message).toBe(`E_RUNTIME: ${NODE_OPERATOR_FAILURE_MESSAGE}`);
      expect((error as Error).message).not.toContain(ROW_VALUE);
      expect(log.lines).toHaveLength(1);
      expect(log.lines[0]).toContain(`日期不可解析：${ROW_VALUE}`);
      expect(log.lines[0]).toContain('job=job-scri');
      expect(log.lines[0]).toContain('stage=scri');
    });

    it('宿主适配的不变量报错带审查前计数 → 同样只进本地日志', async () => {
      const log = capture();
      // 沙箱替身：返回全零的输出区 → 「剂次合计 0 ≠ 输入剂次 3」（真实模块不会这样，篡改或宿主给错参数时才会）
      const zeroed = {
        assertWithinMemoryLimit: () => undefined,
        run: async (req: { outBytes: number }) => ({
          output: new Uint8Array(req.outBytes),
          abiVersion: 1,
          memoryPages: 1,
          durationMs: 0,
          envVarCount: 0,
        }),
      } as unknown as WasmSandboxRunner;
      const error = await exec({ deps: { runner: zeroed, logger: log.logger } }).then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(MdopError);
      expect((error as Error).message).toBe(`E_RUNTIME: ${NODE_OPERATOR_FAILURE_MESSAGE}`);
      expect((error as Error).message).not.toMatch(/\d/); // 固定文案里一个数字都没有
      expect(log.lines[0]).toMatch(/沙箱输出不变量违反：剂次合计 0 ≠ 输入剂次 3/);
    });

    it('节点自己抛的 MdopError（参数 / 绑定问题，文案不带数据）原样上抛——平台需要看见原因', async () => {
      const log = capture();
      await expect(
        exec({ params: { riskWindow: [1] }, deps: { logger: log.logger } }),
      ).rejects.toThrow(/SCRI 阶段参数 riskWindow 必须是两个整数天/);
      await expect(
        exec({
          params: { roles: { registry: 'urn:tds:sh-med:participant:nobody', events: HOSP } },
          deps: { logger: log.logger },
        }),
      ).rejects.toThrow(/SCRI 阶段找不到角色对应的输入/);
      expect(log.lines).toHaveLength(0);
    });
  });
});
