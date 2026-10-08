import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dedupIncidenceCount,
  veTndCount,
  type DedupIncidenceInput,
  type VeTndDoseRow,
  type VeTndTestRow,
} from '@medtrust/wasm-algorithms';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { NODE_WASM_OPS, registerNodeWasmOps } from './wasm-runner';

/**
 * 节点侧两个新场景（疫苗保护效果 TND / 跨院去重发病率）：**真模块字节 + 真沙箱 + 真执行器**。
 *
 * 钉四件事：
 *  ① 结果与 TS 参考语义逐字段一致；
 *  ② 按**角色**绑定输入（调换输入顺序结果不变）；
 *  ③ 出域载荷里没有关联假名、没有编码文本；
 *  ④ 跨院去重**少于两家**直接拒（一家时本地聚合即可，不该走可信空间节点）。
 */

const BUILD = join(__dirname, '../../../../packages/wasm-algorithms/build');
const manifest = JSON.parse(readFileSync(join(BUILD, 'manifest.json'), 'utf8')) as {
  modules: Array<{ analysisType: string; file: string; sm3: string }>;
};

const moduleOf = (analysisType: string) => {
  const entry = manifest.modules.find((m) => m.analysisType === analysisType)!;
  return {
    entry,
    bytes: new Uint8Array(readFileSync(join(BUILD, entry.file))),
    digest: `sm3:${entry.sm3}`,
  };
};

const VE = moduleOf('ve-tnd');
const DEDUP = moduleOf('dedup-incidence');

const DAY = 86_400_000;
const d = (offset: number) => new Date((19723 + offset) * DAY).toISOString().slice(0, 10);

// ── 疫苗保护效果（TND）：疾控接种 + 医院检测 ───────────────────────────────
const CDC = 'urn:tds:sh-med:participant:p-cdc-demo';
const HOSP = 'urn:tds:sh-med:participant:p-hospital-a';

const doses: VeTndDoseRow[] = [
  { subjectKey: 'lk-a', vaccinationDate: d(0), vaccineCode: '208' },
  { subjectKey: 'lk-b', vaccinationDate: d(0), vaccineCode: '208' },
  { subjectKey: 'lk-b', vaccinationDate: d(30), vaccineCode: '208' },
  { subjectKey: 'lk-c', vaccinationDate: d(0), vaccineCode: '140' }, // 白名单外疫苗
];
const tests: VeTndTestRow[] = [
  { subjectKey: 'lk-a', testDate: d(14), pathogenCode: '94500-6', result: 'pos', ageBand: '40-64', sex: 'F' },
  { subjectKey: 'lk-a', testDate: d(13), pathogenCode: '94500-6', result: 'neg', ageBand: '40-64', sex: 'F' },
  { subjectKey: 'lk-b', testDate: d(50), pathogenCode: '94500-6', result: 'neg', ageBand: '65+', sex: 'M' },
  { subjectKey: 'lk-c', testDate: d(20), pathogenCode: '94500-6', result: 'pos', ageBand: '40-64', sex: 'F' },
  // 同人同日重复检测（冲突结果）→ 节点侧按 (linkKey, 检测日) 去重，只留首条
  { subjectKey: 'lk-a', testDate: d(14), pathogenCode: '94500-6', result: 'neg', ageBand: '40-64', sex: 'F' },
];

const VE_PARAMS = {
  roles: { registry: CDC, tests: HOSP },
  immuneDays: 14,
  vaccineCodes: ['207', '208'],
  pathogenCodes: ['94500-6'],
};

function veStage(parties: Array<{ ref: string; node: string }>) {
  return {
    id: 'veTnd',
    node: 'urn:tds:sh-med:participant:tee-node-a',
    op: NODE_WASM_OPS.veTnd,
    op_digest: VE.digest,
    params: { parties, ...VE_PARAMS },
    inputs: parties.map((p) => ({ from: p.ref })),
    input_labels: ['C2', 'C2'] as const,
    output_label: 'C2' as const,
    output_schema: 'rws.ve-tnd/1.0',
  };
}

const veManifest = (id: string) => ({
  apiVersion: 'mdop/v1',
  kind: 'wasm',
  id,
  version: '1.0.0',
  category: 'collab',
  digest: VE.digest,
  publisher: 'urn:tds:sh-med:operator-registry',
  inputs: [
    { name: 'registry', schema: 'mdop.projection/1.0', accept_labels: ['C2'] },
    { name: 'tests', schema: 'mdop.projection/1.0', accept_labels: ['C2'] },
  ],
  outputs: [{ name: 've-tnd', schema: 'rws.ve-tnd/1.0', label_rule: 'inherit' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  build: { source_digest: `sm3:${'8'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
});

async function runVe(order: 'registry-first' | 'tests-first') {
  const mdop = new MdopStageExecutor();
  registerNodeWasmOps(mdop, { moduleBytes: (digest) => (digest === VE.entry.sm3 ? VE.bytes : undefined) });
  const parties =
    order === 'registry-first'
      ? [{ ref: 'r', node: CDC }, { ref: 't', node: HOSP }]
      : [{ ref: 't', node: HOSP }, { ref: 'r', node: CDC }];
  return mdop.execute(
    {
      jobId: 'job-ve',
      stage: veStage(parties) as never,
      inputs: new Map([
        ['r', { rows: doses } as unknown as Record<string, unknown>],
        ['t', { rows: tests } as unknown as Record<string, unknown>],
      ]),
      attempt: 1,
    },
    veManifest('rws.ve-tnd') as never,
  );
}

// ── 跨院去重：两院队列（seal 之后的投影形状）──────────────────────────────
const HOSP_A = 'urn:tds:sh-med:participant:p-huashan';
const HOSP_B = 'urn:tds:sh-med:participant:p-ruijin';

/** 甲院：lk-a 一段；lk-b 一段。 */
const cohortA = [
  {
    subjectKey: 'lk-a',
    ageBand: '65+',
    sex: 'F',
    observation: { start: d(100), end: d(200) },
    events: [{ code: 'I21.9', date: d(150) }],
    rareDisease: { code: 'E76.0', firstDate: d(160) },
  },
  {
    subjectKey: 'lk-b',
    ageBand: '65+',
    sex: 'F',
    observation: { start: d(10), end: d(40) },
    events: [],
    rareDisease: null,
  },
];
/** 乙院：lk-a 的观察期与甲院**部分重叠**、并**重复记录同一个事件**；lk-c 只在乙院。 */
const cohortB = [
  {
    subjectKey: 'lk-a',
    ageBand: '65+',
    sex: 'F',
    observation: { start: d(150), end: d(250) },
    events: [{ code: 'I21.9', date: d(150) }],
    rareDisease: { code: 'E76.0', firstDate: d(163) },
  },
  {
    subjectKey: 'lk-c',
    ageBand: '65+',
    sex: 'F',
    observation: { start: d(300), end: d(349) },
    events: [],
    rareDisease: null,
  },
];

const DEDUP_PARAMS = {
  roles: { cohorts: [HOSP_A, HOSP_B] },
  eventCodes: ['I21.9'],
  rareCodes: ['E76.0'],
  mergeAdjacent: true,
};

function dedupStage(parties: Array<{ ref: string; node: string }>) {
  return {
    id: 'dedup',
    node: 'urn:tds:sh-med:participant:tee-node-a',
    op: NODE_WASM_OPS.dedupIncidence,
    op_digest: DEDUP.digest,
    params: { parties, ...DEDUP_PARAMS },
    inputs: parties.map((p) => ({ from: p.ref })),
    input_labels: ['C2', 'C2'] as const,
    output_label: 'C2' as const,
    output_schema: 'rws.dedup-incidence/1.0',
  };
}

const dedupManifest = (id: string) => ({
  apiVersion: 'mdop/v1',
  kind: 'wasm',
  id,
  version: '1.0.0',
  category: 'collab',
  digest: DEDUP.digest,
  publisher: 'urn:tds:sh-med:operator-registry',
  inputs: [{ name: 'cohorts', schema: 'mdop.projection/1.0', accept_labels: ['C2'] }],
  outputs: [{ name: 'dedup-incidence', schema: 'rws.dedup-incidence/1.0', label_rule: 'inherit' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  build: { source_digest: `sm3:${'9'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
});

async function runDedup(order: 'a-first' | 'b-first') {
  const mdop = new MdopStageExecutor();
  registerNodeWasmOps(mdop, {
    moduleBytes: (digest) => (digest === DEDUP.entry.sm3 ? DEDUP.bytes : undefined),
  });
  const parties =
    order === 'a-first'
      ? [{ ref: 'a', node: HOSP_A }, { ref: 'b', node: HOSP_B }]
      : [{ ref: 'b', node: HOSP_B }, { ref: 'a', node: HOSP_A }];
  return mdop.execute(
    {
      jobId: 'job-dedup',
      stage: dedupStage(parties) as never,
      inputs: new Map([
        ['a', { rows: cohortA } as unknown as Record<string, unknown>],
        ['b', { rows: cohortB } as unknown as Record<string, unknown>],
      ]),
      attempt: 1,
    },
    dedupManifest('rws.dedup-incidence') as never,
  );
}

describe('节点侧 疫苗保护效果（TND）', () => {
  it('真字节 + 真沙箱：与参考语义逐字段一致（免疫建立期边界 / 重复检测去重 / 白名单外疫苗）', async () => {
    const out = await runVe('registry-first');
    expect(out.label).toBe('C2');
    const reference = veTndCount({
      doses,
      tests,
      immuneDays: 14,
      vaccineCodes: ['207', '208'],
      pathogenCodes: ['94500-6'],
    });
    expect((out.payload as { strata: unknown }).strata).toEqual(reference.strata);
    expect(reference.strata).toEqual([
      { key: '40-64|F', vaccPos: 1, vaccNeg: 0, unvaccPos: 1, unvaccNeg: 0, partialPos: 0, partialNeg: 1 },
      { key: '65+|M', vaccPos: 0, vaccNeg: 1, unvaccPos: 0, unvaccNeg: 0, partialPos: 0, partialNeg: 0 },
    ]);
    // 出域载荷：无关联假名、无编码文本；buckets 供发布审查
    const text = JSON.stringify(out.payload);
    expect(text).not.toContain('lk-');
    expect(text).not.toContain('94500-6');
    expect((out.payload as { buckets: unknown[] }).buckets).toHaveLength(2);
  });

  it('按角色绑定：调换输入顺序结果不变', async () => {
    const a = await runVe('registry-first');
    const b = await runVe('tests-first');
    expect(b.payload).toEqual(a.payload);
  });
});

describe('节点侧 跨院去重的发病率与罕见病登记', () => {
  const referenceInput: DedupIncidenceInput = {
    mergeAdjacent: true,
    eventCodes: ['I21.9'],
    rareCodes: ['E76.0'],
    observations: [
      ...cohortA.map((r) => ({ subjectKey: r.subjectKey, ageBand: r.ageBand, sex: r.sex, ...r.observation })),
      ...cohortB.map((r) => ({ subjectKey: r.subjectKey, ageBand: r.ageBand, sex: r.sex, ...r.observation })),
    ],
    events: [
      ...cohortA.flatMap((r) => r.events.map((e) => ({ subjectKey: r.subjectKey, ageBand: r.ageBand, sex: r.sex, ...e }))),
      ...cohortB.flatMap((r) => r.events.map((e) => ({ subjectKey: r.subjectKey, ageBand: r.ageBand, sex: r.sex, ...e }))),
    ],
    rareDiseases: [cohortA[0]!, cohortB[0]!].map((r) => ({
      subjectKey: r.subjectKey,
      ageBand: r.ageBand,
      sex: r.sex,
      ...r.rareDisease!,
    })),
  };

  it('真字节 + 真沙箱：人头并集 / 观察期并集 / 事件去重 / 罕见病取最早，且与参考语义一致', async () => {
    const out = await runDedup('a-first');
    const reference = dedupIncidenceCount(referenceInput);
    expect((out.payload as { strata: unknown }).strata).toEqual(reference.strata);
    // lk-a 跨两院：观察期并集 [100,250] = 151 天（不是 101+101=202）；同一事件只算一次；罕见病只 1 例
    // 人日合计 = 151（lk-a 并集）+ 31（lk-b）+ 50（lk-c）= 232
    expect(reference.strata).toEqual([
      { key: '65+|F', uniqueSubjects: 3, personDaysUnion: 232, eventsDeduped: 1, rareCases: 1 },
    ]);
    const payload = out.payload as { buckets: unknown[]; rareBuckets: unknown[] };
    expect(payload.buckets).toHaveLength(1);
    expect(payload.rareBuckets).toHaveLength(1);
    const text = JSON.stringify(out.payload);
    expect(text).not.toContain('lk-');
    expect(text).not.toContain('I21.9');
    expect(text).not.toContain('E76.0');
  });

  it('按角色绑定：调换两院输入顺序结果不变', async () => {
    const a = await runDedup('a-first');
    const b = await runDedup('b-first');
    expect(b.payload).toEqual(a.payload);
  });

  it('少于两家医院 → 直接拒（一家时本地聚合即可，不该走可信空间节点）', async () => {
    const mdop = new MdopStageExecutor();
    registerNodeWasmOps(mdop, {
      moduleBytes: (digest) => (digest === DEDUP.entry.sm3 ? DEDUP.bytes : undefined),
    });
    await expect(
      mdop.execute(
        {
          jobId: 'job-dedup-single',
          stage: {
            ...dedupStage([{ ref: 'a', node: HOSP_A }]),
            params: { ...DEDUP_PARAMS, roles: { cohorts: [HOSP_A] } },
          } as never,
          inputs: new Map([['a', { rows: cohortA } as unknown as Record<string, unknown>]]),
          attempt: 1,
        },
        dedupManifest('rws.dedup-incidence') as never,
      ),
    ).rejects.toThrow(/至少需要两个 cohort/);
  });
});
