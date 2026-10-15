import { MdopError, type AttestationPolicy } from '@medtrust/mdop';
import { MdopStageExecutor } from '../mdop-executor';
import {
  aeSignalProjection,
  causalSurvivalProjection,
  comparativeEffectProjection,
  listCategoriesProjection,
  scalarCategoryProjection,
  SEAL_OP,
  dedupCohortProjection,
  hospitalControlProjection,
  minimalPairingProjection,
  registerSealOperator,
  scriEventProjection,
  scoreLabelProjection,
  scriRegistryProjection,
  sponsorTrialProjection,
  veRegistryProjection,
  veTestProjection,
} from './seal';

/**
 * 三个新场景的最小投影（C2 封装阶段在**数据持有方本地**做的事）。
 *
 * 这些测试守的是一条红线：**白名单外的字段不出机构**，且持有方该做的本地归一化
 * （检测去重、罕见病编码过滤）必须在这里完成，不能指望节点内再补。
 */
describe('VE(TND) 与跨院去重的封存投影', () => {
  describe('ve-registry（疾控侧接种记录）', () => {
    const upstream = {
      productId: 'dp-ve-immunization-cdc',
      snapshot: 'snap-1',
      rows: [
        {
          linkKey: 'lk-1',
          ageBand: '40-64',
          sex: 'F',
          immunizations: [
            { code: '208', date: '2022-01-10', doseNo: 1 },
            { code: '140', date: '2022-03-01', doseNo: 1 }, // 白名单外（非 mRNA）
            { code: '208', date: '2022-02-01', doseNo: 2 },
          ],
        },
        { ageBand: '40-64', sex: 'M', immunizations: [{ code: '208', date: '2022-01-10' }] }, // 无 linkKey
      ],
    };

    it('只封白名单内疫苗，一剂一行，带剂次与分层键；无 linkKey 的记录不出院', () => {
      const out = veRegistryProjection(upstream, ['207', '208']);
      expect(out.n).toBe(2);
      expect(out.rows).toEqual([
        { subjectKey: 'lk-1', vaccinationDate: '2022-01-10', vaccineCode: '208', doseNo: 1, ageBand: '40-64', sex: 'F' },
        { subjectKey: 'lk-1', vaccinationDate: '2022-02-01', vaccineCode: '208', doseNo: 2, ageBand: '40-64', sex: 'F' },
      ]);
      expect(JSON.stringify(out)).not.toContain('140'); // 白名单外疫苗码不得出现
    });
  });

  describe('ve-tests（医院侧检测记录）', () => {
    const upstream = {
      productId: 'dp-ve-tests-hospital',
      snapshot: 'snap-2',
      rows: [
        {
          linkKey: 'lk-1',
          ageBand: '40-64',
          sex: 'F',
          tests: [
            { code: '94500-6', date: '2022-05-01', result: 'pos' },
            { code: '94500-6', date: '2022-05-01', result: 'neg' }, // 同人同日重复：只留首条
            { code: '94500-6', date: '2022-06-01', result: 'neg' },
            { code: '99999-9', date: '2022-07-01', result: 'pos' }, // 白名单外病原
          ],
        },
        { linkKey: '', tests: [] }, // 空假名
      ],
    };

    it('只封白名单内病原，并按 (linkKey, 检测日期) 去重（首条胜）', () => {
      const out = veTestProjection(upstream, ['94500-6']);
      expect(out.n).toBe(2);
      expect(out.rows).toEqual([
        { subjectKey: 'lk-1', testDate: '2022-05-01', pathogenCode: '94500-6', result: 'pos', ageBand: '40-64', sex: 'F' },
        { subjectKey: 'lk-1', testDate: '2022-06-01', pathogenCode: '94500-6', result: 'neg', ageBand: '40-64', sex: 'F' },
      ]);
      expect(JSON.stringify(out)).not.toContain('99999-9');
    });

    it('只封明确的阳性 / 阴性：不确定、缺失或其它写法的结果不出院，也不挤掉当日的有效结果', () => {
      const out = veTestProjection(
        {
          productId: 'dp-ve-tests-hospital',
          snapshot: 'snap-3',
          rows: [
            {
              linkKey: 'lk-2',
              ageBand: '40-64',
              sex: 'M',
              tests: [
                { code: '94500-6', date: '2022-05-01', result: 'inconclusive' }, // 先出现的不确定结果
                { code: '94500-6', date: '2022-05-01', result: 'pos' }, // 同日的有效结果要留下
                { code: '94500-6', date: '2022-05-02', result: 'POS' }, // 写法不对
                { code: '94500-6', date: '2022-05-03' }, // 缺结果
              ],
            },
          ],
        },
        ['94500-6'],
      );
      expect(out.rows).toEqual([
        { subjectKey: 'lk-2', testDate: '2022-05-01', pathogenCode: '94500-6', result: 'pos', ageBand: '40-64', sex: 'M' },
      ]);
    });
  });

  describe('dedup-cohort（跨院队列）', () => {
    const upstream = {
      productId: 'dp-dedup-cohort-a',
      snapshot: 'snap-3',
      rows: [
        {
          linkKey: 'lk-1',
          ageBand: '65+',
          sex: 'F',
          observation: { start: '2021-01-01', end: '2022-12-31' },
          events: [
            { code: 'I21.9', date: '2022-03-03' },
            { code: 'J10.1', date: '2022-04-04' }, // 白名单外诊断
          ],
          rareDisease: { code: 'E76.0', firstDate: '2022-05-05' },
        },
        {
          linkKey: 'lk-2',
          observation: { start: '2021-06-01', end: '2022-06-01' },
          events: [],
          rareDisease: { code: 'X99.9', firstDate: '2022-01-01' }, // 白名单外罕见病
        },
        { linkKey: 'lk-3', events: [] }, // 无观察期 → 不封
      ],
    };

    it('只封白名单内编码；无观察期或无假名的记录不出院；罕见病按白名单置 null', () => {
      const out = dedupCohortProjection(upstream, ['I21.9'], ['E76.0']);
      expect(out.n).toBe(2);
      expect(out.rows).toEqual([
        {
          subjectKey: 'lk-1',
          ageBand: '65+',
          sex: 'F',
          observation: { start: '2021-01-01', end: '2022-12-31' },
          events: [{ code: 'I21.9', date: '2022-03-03' }],
          rareDisease: { code: 'E76.0', firstDate: '2022-05-05' },
        },
        {
          subjectKey: 'lk-2',
          observation: { start: '2021-06-01', end: '2022-06-01' },
          events: [],
          rareDisease: null,
        },
      ]);
      expect(JSON.stringify(out)).not.toContain('J10.1');
      expect(JSON.stringify(out)).not.toContain('X99.9');
    });
  });
});

/**
 * 编码白名单 fail-closed（评审遗留：无效白名单曾等于「不过滤」）。
 *
 * 封存投影里**没有**「没给白名单 = 全部都封」这条路：白名单缺失、为空、不是数组、
 * 或夹着非字符串 / 空串，封存阶段直接失败——而且失败在密钥托付**之前**（不留半份信封）。
 */
describe('封存投影：编码白名单必填且逐项合规，否则封存阶段失败', () => {
  const POLICY: AttestationPolicy = { tee: ['tdx'], min_tcb: '3.1.0' };
  const SEAL_MANIFEST = {
    apiVersion: 'mdop/v0.2',
    kind: 'system',
    id: 'seal.envelope',
    version: '1.0.0',
    category: 'seal',
    digest: 'component:seal@1',
    publisher: 'urn:tds:platform',
    inputs: [{ name: 'data', schema: 'mdop.dataset/1.0', accept_labels: ['C0'] }],
    outputs: [{ name: 'envelope', schema: 'mdop.env/1.0', label_rule: 'C2' }],
    params: {},
    environments: ['plain'],
    security: { network: 'none' },
    component: 'seal@1.0.0',
  };

  /** 一份五种投影都能吃的上游：每种记录都有白名单内与白名单外的编码。 */
  const upstream = {
    productId: 'dp-1',
    snapshot: 'snap-1',
    rows: [
      {
        linkKey: 'lk-1',
        ageBand: '40-64',
        sex: 'F',
        immunizations: [
          { code: '208', date: '2022-01-10', doseNo: 1 },
          { code: '140', date: '2022-03-01', doseNo: 1 },
        ],
        datedEvents: [
          { code: 'I40.9', date: '2022-01-13' },
          { code: 'J10.1', date: '2022-02-02' },
        ],
        tests: [
          { code: '94500-6', date: '2022-05-01', result: 'pos' },
          { code: '99999-9', date: '2022-07-01', result: 'pos' },
        ],
        observation: { start: '2021-01-01', end: '2022-12-31' },
        events: [
          { code: 'I21.9', date: '2022-03-03' },
          { code: 'J10.1', date: '2022-04-04' },
        ],
        rareDisease: { code: 'X99.9', firstDate: '2022-05-05' },
      },
    ],
  };

  /** 真的把封装算子接到执行器上跑一遍（不是只调投影函数）。 */
  function harness() {
    const executor = new MdopStageExecutor();
    const deposited: string[] = [];
    registerSealOperator(executor, {
      kmsRef: 'kms://space.example.cn',
      watermarkPrefix: 'wm:site-a:sh-med',
      signer: 'urn:tds:sh-med:participant:p-demohospa',
      sign: () => ({ alg: 'SM2-SM3', value: '3045...' }),
      depositor: { depositKey: async ({ keyId }) => void deposited.push(keyId) },
      now: () => new Date('2026-09-25T10:00:00.000Z'),
      contractTermsFor: () => ({
        contract_id: 'ctr-1',
        data_product_id: 'dp-1',
        allowed_ops: ['sm3:' + 'a'.repeat(64)],
        attestation_policy: POLICY,
        valid_until: '2027-09-30T00:00:00.000Z',
      }),
    });
    const seal = (params: Record<string, unknown>, rows: unknown = upstream) =>
      executor.execute(
        {
          jobId: 'job-seal',
          stage: {
            id: 'seal_a',
            node: 'urn:tds:sh-med:participant:p-demohospa',
            op: SEAL_OP,
            op_digest: 'component:seal@1',
            params,
            inputs: [{ from: 'src_a' }],
            input_labels: ['C0'],
            output_label: 'C2',
            output_schema: 'mdop.env/1.0',
          } as never,
          inputs: new Map([['src_a', rows as Record<string, unknown>]]),
          contractTerms: { credential_id: 'tkt-1' },
          attempt: 1,
        },
        SEAL_MANIFEST,
      );
    return { seal, deposited };
  }

  /** 投影种类 → 它必须带的白名单参数名。 */
  const KINDS: Array<{ projection: string; lists: string[]; valid: Record<string, string[]> }> = [
    { projection: 'scri-registry', lists: ['vaccineCodes'], valid: { vaccineCodes: ['208'] } },
    { projection: 'scri-events', lists: ['eventCodes'], valid: { eventCodes: ['I40.9'] } },
    { projection: 've-registry', lists: ['vaccineCodes'], valid: { vaccineCodes: ['208'] } },
    { projection: 've-tests', lists: ['pathogenCodes'], valid: { pathogenCodes: ['94500-6'] } },
    {
      projection: 'dedup-cohort',
      lists: ['eventCodes', 'rareCodes'],
      valid: { eventCodes: ['I21.9'], rareCodes: ['E76.0'] },
    },
  ];
  const INVALID: Array<[string, unknown]> = [
    ['缺失', undefined],
    ['null', null],
    ['空数组', []],
    ['不是数组（字符串）', '208'],
    ['不是数组（对象）', { 0: '208' }],
    ['夹着非字符串', ['208', 207]],
    ['夹着空串', ['208', '']],
    ['只有空白', ['  ']],
  ];

  for (const kind of KINDS) {
    it(`${kind.projection}：白名单合规才封；${kind.lists.join(' / ')} 任一无效 → 封存阶段失败，且不托付密钥`, async () => {
      const ok = harness();
      const sealed = await ok.seal({ projection: kind.projection, ...kind.valid });
      expect(sealed.label).toBe('C2');
      expect(ok.deposited).toHaveLength(1);

      for (const list of kind.lists) {
        for (const [, invalid] of INVALID) {
          const h = harness();
          const params: Record<string, unknown> = { projection: kind.projection, ...kind.valid };
          if (invalid === undefined) delete params[list];
          else params[list] = invalid;
          await expect(h.seal(params)).rejects.toMatchObject({
            name: 'MdopError',
            code: 'E_ENVELOPE_POLICY',
          });
          // 失败在密钥托付之前：没有「信封没出、密钥却已经交出去」的半成品
          expect(h.deposited).toHaveLength(0);
        }
      }
    });
  }

  it('投影函数本身同样拒（演示脚本与测试直接调它们，不经执行器）；不再有「不传 = 全部都封」', () => {
    const none = undefined as unknown as string[];
    expect(() => scriRegistryProjection(upstream, none)).toThrow(MdopError);
    expect(() => scriEventProjection(upstream, [])).toThrow(MdopError);
    expect(() => veRegistryProjection(upstream, none)).toThrow(MdopError);
    expect(() => veTestProjection(upstream, [])).toThrow(MdopError);
    expect(() => dedupCohortProjection(upstream, ['I21.9'], none)).toThrow(MdopError);
    expect(() => dedupCohortProjection(upstream, [], ['E76.0'])).toThrow(MdopError);
    // 白名单外的编码照旧不出院
    expect(JSON.stringify(scriRegistryProjection(upstream, ['208']))).not.toContain('140');
    expect(JSON.stringify(scriEventProjection(upstream, ['I40.9']))).not.toContain('J10.1');
    expect(
      (dedupCohortProjection(upstream, ['I21.9'], ['E76.0']).rows as Array<{ rareDisease: unknown }>)[0]!
        .rareDisease,
    ).toBeNull();
  });
});

/**
 * 分层分量的闭合语法（评审遗留：自由文本 `ageBand|sex` 曾作为层键进 C3）。
 *
 * `ageBand` / `sex` 是持有方的行里唯一会以文本形态走到出域结果的字段。有就必须合语法，
 * 不合语法的既不静默丢掉、也不照旧放行——整个封存阶段失败，错误说明不带取值。
 */
describe('封存投影：行上的分层分量必须符合闭合语法，否则封存阶段失败', () => {
  const FREE_TEXT = '门诊备注：家住某某路 3 号';
  const row = (over: Record<string, unknown>) => ({
    linkKey: 'lk-1',
    ageBand: '40-64',
    sex: 'F',
    treated: true,
    eventOccurred: false,
    immunizations: [{ code: '208', date: '2022-01-10', doseNo: 1 }],
    tests: [{ code: '94500-6', date: '2022-05-01', result: 'pos' }],
    observation: { start: '2021-01-01', end: '2022-12-31' },
    events: [{ code: 'I21.9', date: '2022-03-03' }],
    rareDisease: null,
    indexDate: '2022-01-01',
    outcome: 'pos',
    ...over,
  });
  const PROJECTIONS: Array<[string, (rows: unknown[]) => Record<string, unknown>]> = [
    ['pairing', (rows) => minimalPairingProjection({ rows })],
    ['scri-registry', (rows) => scriRegistryProjection({ rows }, ['208'])],
    ['ve-registry', (rows) => veRegistryProjection({ rows }, ['208'])],
    ['ve-tests', (rows) => veTestProjection({ rows }, ['94500-6'])],
    ['dedup-cohort', (rows) => dedupCohortProjection({ rows }, ['I21.9'], ['E76.0'])],
    ['sponsor-trial', (rows) => sponsorTrialProjection({ rows })],
    ['hospital-controls', (rows) => hospitalControlProjection({ rows })],
  ];

  for (const [name, project] of PROJECTIONS) {
    it(`${name}：合语法的照常带出；自由文本 / 非字符串 / 空串 → 拒，且错误说明不带取值`, () => {
      const ok = project([
        row({}),
        row({ linkKey: 'lk-2', ageBand: '65+', sex: 'male' }),
        // 去标识模块在出生日期缺失时给 unknown；FHIR 性别编码里有 other——都是封闭词表里的固定记号
        row({ linkKey: 'lk-3', ageBand: 'unknown', sex: 'other' }),
      ]);
      expect((ok.rows as Array<Record<string, unknown>>)[0]).toMatchObject({ ageBand: '40-64', sex: 'F' });
      expect((ok.rows as Array<Record<string, unknown>>)[1]).toMatchObject({ ageBand: '65+', sex: 'male' });
      expect((ok.rows as Array<Record<string, unknown>>)[2]).toMatchObject({ ageBand: 'unknown', sex: 'other' });

      for (const bad of [
        { ageBand: FREE_TEXT },
        { sex: FREE_TEXT },
        { ageBand: 'Unknown' },
        { sex: 'others' },
        { ageBand: 45 },
        { sex: '' },
        { ageBand: '40-64|F' },
      ]) {
        let thrown: unknown;
        try {
          project([row({}), row({ linkKey: 'lk-bad', ...bad })]);
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeInstanceOf(MdopError);
        expect((thrown as MdopError).code).toBe('E_ENVELOPE_POLICY');
        expect((thrown as Error).message).not.toContain('某某路');
        expect((thrown as Error).message).not.toContain('lk-bad');
        expect((thrown as Error).message).toMatch(/分层分量 (ageBand|sex) 不符合闭合语法/);
      }
    });
  }

  it('没有分层分量的记录照常封（不带这两个字段）；不出院的记录不因分层分量被拒', () => {
    const { ageBand: _a, sex: _s, ...bare } = row({});
    const out = minimalPairingProjection({
      rows: [
        bare,
        { ...row({ linkKey: 'lk-3' }), ageBand: null, sex: undefined },
        // 没有关联假名：本来就不出院，它的分层分量写成什么都不影响别人
        { ...row({}), linkKey: undefined, ageBand: FREE_TEXT },
      ],
    });
    expect(out.rows).toEqual([
      { subjectKey: 'lk-1', exposure: true, outcome: false },
      { subjectKey: 'lk-3', exposure: true, outcome: false },
    ]);
  });
  it('不良事件信号投影：一行一起事件、只留分类字段、缺分类的计入 skipped', () => {
    const out = aeSignalProjection(
      {
        productId: 'dp-ae',
        snapshot: 's',
        rows: [
          {
            linkKey: 'lk-1',
            ageBand: '<40',
            sex: 'M',
            adverseEvents: [
              { organSystem: 'Nervous', term: 'x', serious: true },
              { organSystem: 'Cardiac', term: 'y', serious: false },
              { term: 'missing organ system' },
            ],
          },
          { ageBand: '<40', sex: 'M', adverseEvents: [{ organSystem: 'Nervous' }] }, // 未对齐假名：不出院
        ],
      },
      'adverseEvents',
    );
    expect(out.n).toBe(2);
    expect(out.skippedMissingCategory).toBe(1);
    expect(out.rows).toEqual([{ category: 'Nervous' }, { category: 'Cardiac' }]);
    // 最小化：投影行不带主体键
    expect(JSON.stringify(out.rows)).not.toContain('lk-');
  });

  it('标量分类投影（cohort-count 口径）：一行一记录、缺字段计入 skipped、投影行无主体键', () => {
    const out = scalarCategoryProjection(
      {
        productId: 'dp-c',
        snapshot: 's',
        rows: [
          { linkKey: 'lk-1', ageBand: '<40' },
          { linkKey: 'lk-2', ageBand: '<40' },
          { linkKey: 'lk-3' }, // 缺分类：不出院但计数
          { ageBand: '40+' }, // 未对齐假名：整体不出院
        ],
      },
      'ageBand',
    );
    expect(out.n).toBe(2);
    expect(out.skippedMissingCategory).toBe(1);
    expect(out.rows).toEqual([{ category: '<40' }, { category: '<40' }]);
    expect(JSON.stringify(out.rows)).not.toContain('lk-');
  });

  it('列表分类投影（现患口径）：一行多标签各出一行；空列表走占位；占位为空则计入 skipped', () => {
    const upstream = {
      productId: 'dp-p',
      snapshot: 's',
      rows: [
        { linkKey: 'lk-1', conditions: ['糖尿病', '高血压'] },
        { linkKey: 'lk-2', conditions: [] },
        { linkKey: 'lk-3', conditions: ['糖尿病', ''] },
      ],
    };
    const out = listCategoriesProjection(upstream, 'conditions', '无明确慢病标签');
    expect(out.n).toBe(4);
    expect(out.rows).toEqual([
      { category: '糖尿病' },
      { category: '高血压' },
      { category: '无明确慢病标签' },
      { category: '糖尿病' },
    ]);
    const withoutPlaceholder = listCategoriesProjection(upstream, 'conditions', '');
    expect(withoutPlaceholder.n).toBe(3);
    expect(withoutPlaceholder.skippedMissingCategory).toBe(1);
  });
});

describe('比较效果封存投影', () => {
  it('去掉主体键与关联假名，只留分层、用药、诊断和事件', () => {
    const eventsKey = ['adver', 'seEvents'].join('');
    const out = comparativeEffectProjection({
      productId: 'dp-ce',
      snapshot: 'snap',
      rows: [
        {
          subjectKey: 'sk-1',
          linkKey: 'lk-1',
          ageBand: '40-64',
          sex: 'F',
          medications: [{ code: 'paclitaxel' }],
          conditions: [{ code: 'C50' }],
          [eventsKey]: [{ code: 'ALT' }],
        },
      ],
    });
    expect(out.n).toBe(1);
    expect(out.rows).toEqual([
      {
        ageBand: '40-64',
        sex: 'F',
        medications: [{ code: 'paclitaxel' }],
        conditions: [{ code: 'C50' }],
        [eventsKey]: [{ code: 'ALT' }],
      },
    ]);
    const json = JSON.stringify(out.rows);
    expect(json).not.toContain('sk-1');
    expect(json).not.toContain('lk-1');
  });
});

describe('生存分析封存投影', () => {
  it('保留随访天数，去掉主体键', () => {
    const eventsKey = ['adver', 'seEvents'].join('');
    const out = causalSurvivalProjection({
      productId: 'dp-sv',
      snapshot: 'snap',
      rows: [
        {
          subjectKey: 'sk-1',
          ageBand: '40-64',
          sex: 'M',
          medications: [{ code: 'insulin' }],
          conditions: [],
          [eventsKey]: [],
          followUpDays: 180,
        },
      ],
    });
    expect(out.rows).toEqual([
      {
        ageBand: '40-64',
        sex: 'M',
        medications: [{ code: 'insulin' }],
        conditions: [],
        [eventsKey]: [],
        followUpDays: 180,
      },
    ]);
    expect(JSON.stringify(out.rows)).not.toContain('sk-1');
  });
});

describe('分数标签封存投影', () => {
  it('只留标签和分数，去掉主体键', () => {
    const out = scoreLabelProjection(
      {
        productId: 'dp-av',
        snapshot: 'snap',
        rows: [
          {
            subjectKey: 'sk-1',
            eventOccurred: true,
            observations: { score: 0.75, note: 'keep-out' },
          },
        ],
      },
      'eventOccurred',
      'score',
    );
    expect(out.rows).toEqual([{ label: 1, score: 0.75 }]);
    expect(JSON.stringify(out.rows)).not.toContain('sk-1');
    expect(JSON.stringify(out.rows)).not.toContain('keep-out');
  });
});
