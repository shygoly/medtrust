import type { ToolContext } from '@medtrust/pi-agent';
import { buildChatConfig } from '../config/agent.config';
import { FakeApiClient, FAKE_DIRECTORY } from '../test-utils/fake-api-client';
import { CANONICAL_SCENARIO_VALUES } from '../test-utils/canonical-scenario-values';
import type { ScenarioBuildContext, ScenarioDefaults } from './scenarios';
import {
  findScenario,
  inferPacksFromSpaceId,
  pairParticipants,
  SCENARIOS,
  startersForPacks,
} from './scenarios';
import { buildSubmitTool } from './tools/mdop.tools';

const defaults: ScenarioDefaults = {
  purpose: '外部对照 RWS',
  applicant: { org: 'user-1', project: 'sh-med' },
  contracts: ['ct-1'],
  notBefore: '2026-01-01T00:00:00.000Z',
  notAfter: '2026-04-01T00:00:00.000Z',
  minCell: 5,
  teeNode: 'urn:tds:sh-med:participant:tee-node',
};

const ctx: ScenarioBuildContext = {
  spaceId: 'sh-med',
  userId: 'user-1',
  directory: FAKE_DIRECTORY,
  defaults,
};

describe('场景注册表', () => {
  it('包含医疗与电力场景，且 id / 工具名唯一', () => {
    const ids = SCENARIOS.map((scenario) => scenario.id);
    const tools = SCENARIOS.map((scenario) => scenario.toolName);
    expect(ids).toEqual(
      expect.arrayContaining([
        'external-control',
        'external-control-registration',
        'fl-prediction',
        'cohort-count',
        'load-forecast',
        'demand-response',
        'theft-detection',
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(tools).size).toBe(tools.length);
  });

  it('每个场景声明 pack，医疗与电力互不混用', () => {
    for (const scenario of SCENARIOS) {
      expect(['med', 'power']).toContain(scenario.pack);
    }
    expect(SCENARIOS.filter((s) => s.pack === 'med').map((s) => s.id)).toEqual(
      expect.arrayContaining(['external-control', 'external-control-registration']),
    );
    expect(SCENARIOS.filter((s) => s.pack === 'power').map((s) => s.id)).toEqual(
      expect.arrayContaining(['load-forecast', 'demand-response', 'theft-detection']),
    );
  });

  it('startersForPacks：按包切分预设提示词', () => {
    const med = startersForPacks(['med']);
    const power = startersForPacks(['power']);
    expect(med).toContain('我想对比试验组和对照组的疗效');
    expect(med).toContain('创建一项单臂外部对照注册研究并生成模拟报告');
    expect(med.some((s) => s.includes('电力'))).toBe(false);
    expect(power).toEqual(
      expect.arrayContaining([
        '我想预测明天的电力负荷',
        '帮我做削峰填谷的需求响应优化',
        '检测一下跨区域的异常用电',
      ]),
    );
    expect(power.some((s) => /医院|对照/.test(s))).toBe(false);
  });

  it('inferPacksFromSpaceId：从空间 id 推断包', () => {
    expect(inferPacksFromSpaceId('hn-power')).toEqual(['power']);
    expect(inferPacksFromSpaceId('sh-med')).toEqual(['med']);
    expect(inferPacksFromSpaceId('')).toBeNull();
  });

  it('direct 场景有端点、template 场景有模板', () => {
    for (const scenario of SCENARIOS) {
      if (scenario.mode === 'direct') expect(scenario.endpoint).toBeTruthy();
      else expect(scenario.template).toBeTruthy();
    }
  });
});

describe('单臂外部对照', () => {
  const scenario = findScenario('external-control')!;

  it('卡片字段带上目录候选项与默认值', () => {
    const fields = scenario.buildFields(ctx);
    const trial = fields.find((field) => field.name === 'trial')!;
    expect(trial.type).toBe('select');
    expect(trial.options?.map((option) => option.value)).toContain('p-sponsor');
    expect(fields.find((field) => field.name === 'caliperDays')?.defaultValue).toBe(30);
    expect(fields.find((field) => field.name === 'ratioK')?.defaultValue).toBe(2);
  });

  it('产品角色来自显式目录标签，不按标题推断；替代医院可用', () => {
    const roleAware: ScenarioBuildContext = {
      ...ctx,
      directory: {
        participants: [
          { id: 'p-a', name: '中心 A' },
          { id: 'p-b', name: '中心 B' },
        ],
        dataProducts: [
          { id: 'dp-a-trial', name: '任意标题一', ownerId: 'p-a', roles: ['sponsor-trial'] },
          { id: 'dp-b-control', name: '任意标题二', ownerId: 'p-b', roles: ['hospital-controls'] },
        ],
      },
    };
    const fields = scenario.buildFields(roleAware);
    expect(
      fields.find((field) => field.name === 'trialDataProduct')?.options?.map((o) => o.value),
    ).toEqual(['dp-a-trial']);
    expect(
      fields.find((field) => field.name === 'controlsDataProduct')?.options?.map((o) => o.value),
    ).toEqual(['dp-b-control']);
  });

  it('用途来自封闭场景策略，不接受表单自由文本覆盖', () => {
    expect(scenario.purposePolicy.allowed).toContain(
      '对话式任务配置（AI Chat Agent）',
    );
    expect(scenario.buildSubmission(
      {
        trial: 'p-sponsor',
        trialDataProduct: 'dp-trial',
        controls: 'p-hosp-a',
        controlsDataProduct: 'dp-controls',
        strataKeys: '<40|M',
        purpose: 'model-invented-purpose',
      },
      ctx,
    ).submission.payload?.purpose).toBe('对话式任务配置（AI Chat Agent）');
  });

  it('合约依赖由场景声明生成两份，不按数组第一项绑定', () => {
    expect(scenario.contractDependencies).toEqual([
      expect.objectContaining({ role: 'trial', participantField: 'trial' }),
      expect.objectContaining({ role: 'controls', participantField: 'controls' }),
    ]);
  });

  it('跨字段校验：试验方与对照方不能相同，分层键不能为空', () => {
    expect(
      scenario.validate({ trial: 'p-sponsor', controls: 'p-sponsor', strataKeys: '<40|M' }, ctx),
    ).toContain('试验方与对照方不能是同一参与方');
    expect(scenario.validate({ trial: 'p-sponsor', controls: 'p-hosp-a', strataKeys: '' }, ctx)).toContain(
      '至少需要一个分层键',
    );
    expect(
      scenario.validate({ trial: 'p-sponsor', controls: 'p-hosp-a', strataKeys: '<40|M' }, ctx),
    ).toEqual([]);
  });

  it('提交载荷对齐模板入参（trial / controls / strataKeys / minCell）', () => {
    const { submission } = scenario.buildSubmission(
      {
        trial: 'p-sponsor',
        trialDataProduct: 'dp-trial',
        controls: 'p-hosp-a',
        controlsDataProduct: 'dp-controls',
        strataKeys: '<40|M, 40+|F',
        caliperDays: '45',
        ratioK: 3,
      },
      ctx,
    );
    expect(submission.mode).toBe('direct');
    expect(submission.endpoint).toBe('/mdop/jobs/external-control');
    expect(submission.payload).toMatchObject({
      purpose: '对话式任务配置（AI Chat Agent）',
      applicant: { org: 'user-1', project: 'sh-med' },
      contracts: ['ct-1'],
      trial: { participantId: 'p-sponsor', dataProductId: 'dp-trial' },
      controls: { participantId: 'p-hosp-a', dataProductId: 'dp-controls' },
      strataKeys: ['<40|M', '40+|F'],
      caliperDays: 45,
      ratioK: 3,
      minCell: 5,
    });
  });
});

describe('负荷预测（模板两步）', () => {
  const scenario = findScenario('load-forecast')!;

  it('至少两方参与，否则拒', () => {
    expect(scenario.validate({ participants: 'p-grid-a' }, ctx)).toContain(
      '负荷预测至少需要 2 方参与',
    );
    expect(scenario.validate({ participants: 'p-grid-a, p-grid-b', features: 'load' }, ctx)).toEqual([]);
  });

  it('模板入参带 role 与 spec', () => {
    const { submission } = scenario.buildSubmission(
      {
        participants: 'p-grid-a, p-grid-b',
        dataProducts: 'dp-load-a',
        role: 'weather',
        forecastHorizon: 48,
        features: 'load, temperature',
        model: 'baseline',
      },
      ctx,
    );
    expect(submission.mode).toBe('template');
    expect(submission.template).toBe('power.load-forecast');
    expect(submission.templateInput).toMatchObject({
      participants: [
        { participantId: 'p-grid-a', dataProductId: 'dp-load-a', role: 'weather' },
        { participantId: 'p-grid-b', dataProductId: 'dp-load-a', role: 'weather' },
      ],
      spec: { forecastHorizon: 48, features: ['load', 'temperature'], model: 'baseline' },
    });
  });
});

describe('成对映射', () => {
  it('数据产品少于参与方时复用第一个并补齐', () => {
    expect(pairParticipants(['a', 'b'], ['dp'])).toEqual([
      { participantId: 'a', dataProductId: 'dp' },
      { participantId: 'b', dataProductId: 'dp' },
    ]);
  });
});

describe('配置默认值', () => {
  it('无 key 时回退 rule-based，有 key 时 anthropic', () => {
    expect(buildChatConfig({}).llmMode).toBe('rule-based');
    expect(buildChatConfig({ ANTHROPIC_API_KEY: 'sk-x' }).llmMode).toBe('anthropic');
  });

  it('端口与窗口默认值', () => {
    const config = buildChatConfig({});
    expect(config.port).toBe(5032);
    expect(config.defaultMinCell).toBe(5);
    expect(config.defaultWindowDays).toBe(90);
  });

  it('合约列表按逗号切分', () => {
    expect(buildChatConfig({ DEFAULT_CONTRACTS: 'ct-1, ct-2' }).defaultContracts).toEqual([
      'ct-1',
      'ct-2',
    ]);
  });
});

describe('L4 联邦学习', () => {
  const scenario = findScenario('fl-prediction')!;

  it('至少两方参与，且至少一个数据产品', () => {
    expect(scenario.validate({ hospitals: 'p-hosp-a' }, ctx)).toContain('联邦学习至少需要 2 方参与');
    expect(scenario.validate({ hospitals: 'p-hosp-a, p-hosp-b', dataProducts: '' }, ctx)).toContain(
      '至少需要一个数据产品',
    );
    expect(
      scenario.validate({ hospitals: 'p-hosp-a, p-hosp-b', dataProducts: 'dp-hosp-b' }, ctx),
    ).toEqual([]);
  });

  it('直提载荷：hospitals 成对 + spec（模型/轮次/目标）', () => {
    const { submission } = scenario.buildSubmission(
      {
        hospitals: 'p-hosp-a, p-hosp-b',
        dataProducts: 'dp-hosp-b',
        target: 'label_diabetes',
        model: 'logistic_regression',
        rounds: '5',
      },
      ctx,
    );
    expect(submission.mode).toBe('direct');
    expect(submission.endpoint).toBe('/mdop/jobs/fl-prediction');
    expect(submission.payload).toMatchObject({
      hospitals: [
        { participantId: 'p-hosp-a', dataProductId: 'dp-hosp-b' },
        { participantId: 'p-hosp-b', dataProductId: 'dp-hosp-b' },
      ],
      spec: { model: 'logistic_regression', rounds: 5, target: 'label_diabetes' },
      minCell: 5,
    });
  });
});

describe('队列规模统计', () => {
  const scenario = findScenario('cohort-count')!;

  it('至少要一个数据持有方', () => {
    expect(scenario.validate({ holders: '' }, ctx)).toContain('至少需要一个数据持有方');
    expect(scenario.validate({ holders: 'p-hosp-a', dataProducts: 'dp-hosp-b' }, ctx)).toEqual([]);
  });

  it('可选字段为空时不出现在载荷里（不给控制面塞空值）', () => {
    const { submission } = scenario.buildSubmission(
      { holders: 'p-hosp-a, p-hosp-b', dataProducts: 'dp-hosp-b', strataKeys: '', drug: '' },
      ctx,
    );
    expect(submission.payload).not.toHaveProperty('strataKeys');
    expect(submission.payload).not.toHaveProperty('drug');
    expect(submission.payload).toMatchObject({
      holders: [
        { participantId: 'p-hosp-a', dataProductId: 'dp-hosp-b' },
        { participantId: 'p-hosp-b', dataProductId: 'dp-hosp-b' },
      ],
      minCell: 5,
    });
  });

  it('给了分层键与药品时带上', () => {
    const { submission } = scenario.buildSubmission(
      { holders: 'p-hosp-a', dataProducts: 'dp-hosp-b', strataKeys: '<40|M, 40+|F', drug: 'metformin' },
      ctx,
    );
    expect(submission.payload).toMatchObject({
      strataKeys: ['<40|M', '40+|F'],
      drug: 'metformin',
    });
  });
});

describe('需求响应', () => {
  const scenario = findScenario('demand-response')!;
  const targetLoad = Array.from({ length: 24 }, (_, hour) => 100 + hour).join(', ');

  it('目标负荷必须 24 点，窗口开始须早于结束', () => {
    expect(scenario.validate({ participants: 'p-grid-a, p-grid-b', targetLoad: '1, 2' }, ctx)).toContain(
      '目标负荷曲线必须包含 24 个小时值',
    );
    expect(
      scenario.validate(
        { participants: 'p-grid-a, p-grid-b', targetLoad, windowStart: 22, windowEnd: 18 },
        ctx,
      ),
    ).toContain('响应窗口的开始必须早于结束');
    expect(scenario.validate({ participants: 'p-grid-a, p-grid-b', targetLoad }, ctx)).toEqual([]);
  });

  it('模板入参：participants 带 userType，spec 数值化', () => {
    const { submission } = scenario.buildSubmission(
      {
        participants: 'p-grid-a, p-grid-b',
        dataProducts: 'dp-load-a',
        userType: 'commercial',
        targetLoad,
        incentiveBudget: '1500',
        windowStart: '18',
        windowEnd: '22',
      },
      ctx,
    );
    expect(submission.mode).toBe('template');
    expect(submission.template).toBe('power.demand-response');
    const input = submission.templateInput as any;
    expect(input.participants).toEqual([
      { participantId: 'p-grid-a', dataProductId: 'dp-load-a', userType: 'commercial' },
      { participantId: 'p-grid-b', dataProductId: 'dp-load-a', userType: 'commercial' },
    ]);
    expect(input.spec.targetLoad).toHaveLength(24);
    expect(input.spec.incentiveBudget).toBe(1500);
    expect(input.spec.timeWindow).toEqual([18, 22]);
  });
});

describe('窃电检测', () => {
  const scenario = findScenario('theft-detection')!;

  it('至少两个供电局', () => {
    expect(scenario.validate({ participants: 'p-grid-a' }, ctx)).toContain(
      '窃电检测至少需要 2 个供电局参与',
    );
  });

  it('模板入参：检测周期/阈值/TopK 数值化且有缺省', () => {
    const { submission } = scenario.buildSubmission(
      { participants: 'p-grid-a, p-grid-b', dataProducts: 'dp-load-a' },
      ctx,
    );
    expect(submission.template).toBe('power.theft-detection');
    expect((submission.templateInput as any).spec).toEqual({
      detectionPeriod: 30,
      anomalyThreshold: 0.8,
      topK: 10,
    });
  });
});

describe('场景注册表的一致性（新增场景时的护栏）', () => {
  it('每个场景的字段名唯一、必填字段有 label，且治理字段在提交载荷里', () => {
    for (const scenario of SCENARIOS) {
      const names = scenario.buildFields(ctx).map((field) => field.name);
      expect(new Set(names).size).toBe(names.length);
      for (const field of scenario.buildFields(ctx)) {
        expect(field.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('direct 载荷带治理字段（purpose/applicant/contracts/notBefore/notAfter）', () => {
    for (const scenario of SCENARIOS.filter((s) => s.mode === 'direct')) {
      const { submission } = scenario.buildSubmission(CANONICAL_VALUES[scenario.id], ctx);
      const expectedContracts =
        scenario.id === 'external-control-registration'
          ? ['ct-fake-trial', 'ct-fake-1']
          : defaults.contracts;
      expect(submission.payload).toMatchObject({
        purpose: scenario.purposePolicy.default,
        applicant: defaults.applicant,
        contracts: expectedContracts,
        notBefore: defaults.notBefore,
        notAfter: defaults.notAfter,
      });
    }
  });
});

/**
 * 逐场景端到端（工具层）：同一份规范表（test-utils）把「卡片取值 → submit 工具 → API 客户端」跑通。
 */
const CANONICAL_VALUES = CANONICAL_SCENARIO_VALUES;

const toolContext: ToolContext = {
  userId: 'user-1',
  spaceId: 'sh-med',
  sessionId: 'session-1',
  accessToken: 'token-1',
  directory: FAKE_DIRECTORY,
  defaults,
};

describe('逐场景提交（工具 → API 客户端）', () => {
  it('规范表覆盖全部场景', () => {
    expect(Object.keys(CANONICAL_VALUES).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.id}：校验通过并成功提交一次`, async () => {
      const api = new FakeApiClient();
      const tool = buildSubmitTool(scenario, api);
      const result = await tool.execute(
        { values: CANONICAL_VALUES[scenario.id] },
        toolContext,
      );

      expect(result).toMatchObject({ success: true, data: { scenario: scenario.id } });
      expect(api.submissions).toHaveLength(1);
      const submission = api.submissions[0].submission;
      expect(submission.scenarioId).toBe(scenario.id);
      expect(submission.analysisKey).toBe(scenario.analysisKey);
      if (scenario.mode === 'direct') {
        expect(submission.endpoint).toBe(scenario.endpoint);
        expect(submission.payload).toBeTruthy();
      } else {
        expect(submission.template).toBe(scenario.template);
        expect(submission.templateInput).toBeTruthy();
      }
    });
  }
});

describe('多值字段的目录提示（Card 协议无多选，至少让用户知道填什么）', () => {
  it('多值字段的 help 里列出目录候选（id + 名称）', () => {
    const participants = findScenario('load-forecast')!
      .buildFields(ctx)
      .find((field) => field.name === 'participants')!;
    expect(participants.help).toContain('目录可用');
    expect(participants.help).toContain('p-grid-a');
    expect(participants.help).toContain('供电局 A');
  });

  it('目录为空时不出现「目录可用」，但字段仍可用', () => {
    const emptyCtx: ScenarioBuildContext = {
      ...ctx,
      directory: { participants: [], dataProducts: [] },
    };
    const participants = findScenario('theft-detection')!
      .buildFields(emptyCtx)
      .find((field) => field.name === 'participants')!;
    expect(participants.help).not.toContain('目录可用');
    expect(participants.help).toContain('至少 2 个供电局');
  });

  it('候选超过 8 个时截断并标注「等」', () => {
    const manyCtx: ScenarioBuildContext = {
      ...ctx,
      directory: {
        participants: Array.from({ length: 12 }, (_, index) => ({
          id: `p-${index}`,
          name: `参与方 ${index}`,
        })),
        dataProducts: [],
      },
    };
    const help = findScenario('demand-response')!
      .buildFields(manyCtx)
      .find((field) => field.name === 'participants')!.help!;
    expect(help).toContain('p-0');
    expect(help).toContain('等');
    expect(help).not.toContain('p-11');
  });
});
