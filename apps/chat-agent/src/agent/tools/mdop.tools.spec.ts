import type { ToolContext } from '@medtrust/pi-agent';
import { FakeApiClient, FAKE_DIRECTORY, FAKE_USABLE_CONTRACT } from '../../test-utils/fake-api-client';
import { findScenario, type ScenarioDefaults } from '../scenarios';
import { buildRefreshCardTool, buildSubmitTool } from './mdop.tools';

const defaults: ScenarioDefaults = {
  purpose: '外部对照 RWS',
  applicant: { org: 'user-1', project: 'sh-med' },
  contracts: ['ct-1'],
  notBefore: '2026-01-01T00:00:00.000Z',
  notAfter: '2026-04-01T00:00:00.000Z',
  minCell: 5,
  teeNode: 'urn:tds:sh-med:participant:tee-node',
};

const context: ToolContext = {
  userId: 'user-1',
  spaceId: 'sh-med',
  sessionId: 'session-1',
  accessToken: 'token-1',
  directory: FAKE_DIRECTORY,
  defaults,
};

describe('submit 工具', () => {
  it('单臂外部对照：校验通过后按 direct 提交并回传 jobId', async () => {
    const api = new FakeApiClient();
    const tool = buildSubmitTool(findScenario('external-control')!, api);

    const result = await tool.execute(
      {
        values: {
          trial: 'p-sponsor',
          trialDataProduct: 'dp-trial',
          controls: 'p-hosp-a',
          controlsDataProduct: 'dp-controls',
          strataKeys: '<40|M, 40+|F',
        },
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ jobId: 'job-fake-1', title: '单臂试验外部对照' });
    // 任务与授权在数据上对齐（plan 成功指标：任务提交都有关联合约）
    expect(result.data).toMatchObject({
      contractId: 'ct-fake-trial',
      contractIds: ['ct-fake-trial', 'ct-fake-1'],
      compliance: { status: 'ready', contractId: 'ct-fake-trial' },
    });
    expect(api.submissions).toHaveLength(1);
    expect(api.submissions[0].submission.mode).toBe('direct');
    expect(api.submissions[0].ctx).toMatchObject({ spaceId: 'sh-med', userId: 'user-1', token: 'token-1' });
  });

  it('两个数据源各签一份合约 → 计划携带两份合约，并记录每一方对应哪一份', async () => {
    const api = new FakeApiClient({
      contracts: [
        {
          ...FAKE_USABLE_CONTRACT,
          id: 'ct-trial',
          providerId: 'p-sponsor',
          consumerId: 'pharma-demo',
          dataProductId: 'dp-trial',
          purposeCode: '对话式任务配置（AI Chat Agent）',
        },
        {
          ...FAKE_USABLE_CONTRACT,
          id: 'ct-controls',
          providerId: 'p-hosp-a',
          consumerId: 'pharma-demo',
          dataProductId: 'dp-controls',
          purposeCode: '对话式任务配置（AI Chat Agent）',
        },
      ],
    });
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    const result = await tool.execute(
      {
        values: {
          trial: 'p-sponsor',
          trialDataProduct: 'dp-trial',
          controls: 'p-hosp-a',
          controlsDataProduct: 'dp-controls',
          strataKeys: '<40|M, 40+|F',
        },
      },
      { ...context, defaults: { ...defaults, contracts: [] } },
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      contractId: 'ct-trial',
      contractIds: ['ct-trial', 'ct-controls'],
    });
    expect(api.submissions[0].submission.payload).toMatchObject({
      contracts: ['ct-trial', 'ct-controls'],
      contractsByParticipant: {
        'p-sponsor': 'ct-trial',
        'p-hosp-a': 'ct-controls',
      },
    });
  });

  it('跨字段校验失败时不调用 API', async () => {
    const api = new FakeApiClient();
    const tool = buildSubmitTool(findScenario('external-control')!, api);

    const result = await tool.execute(
      { values: { trial: 'p-sponsor', controls: 'p-sponsor', strataKeys: '<40|M' } },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('不能是同一参与方');
    expect(api.submissions).toHaveLength(0);
    // 必须把 values 带回来：上层靠它出「预填回卡」。这条断言是接缝的生产端契约——
    // 早先只回 scenario，于是校验失败反而拿不到回卡（E2E 演示用例暴露）。
    expect(result.data).toMatchObject({
      scenario: 'external-control',
      values: { trial: 'p-sponsor', controls: 'p-sponsor', strataKeys: '<40|M' },
    });
  });

  it('合约不可用 → 提交前就拦下，且不调用控制面（附 compliance 与预填值）', async () => {
    const api = new FakeApiClient({ contracts: [] });
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    const result = await tool.execute(
      { values: { trial: 'p-sponsor', controls: 'p-hosp-a', strataKeys: '<40|M' } },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('E_CONTRACT_MISSING');
    expect(result.data).toMatchObject({
      scenario: 'external-control',
      compliance: { status: 'needs_contract', fix: 'request_contract' },
    });
    // 关键：没有打控制面（控制面本来也会 400，但用户先得到可读原因）
    expect(api.submissions).toHaveLength(0);
  });

  it('合约不可用 → 连"下一步该做什么"的卡一起回来（含申请入参，无 key 也能把流程走完）', async () => {
    const api = new FakeApiClient({ contracts: [] });
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    const result = await tool.execute(
      {
        values: {
          trial: 'p-sponsor',
          trialDataProduct: 'dp-trial',
          controls: 'p-hosp-a',
          controlsDataProduct: 'dp-controls',
          strataKeys: '<40|M',
        },
      },
      context,
    );

    expect(result.success).toBe(false);
    const card = (result.data as {
      card?: {
        type: string;
        requirements?: Array<{ request?: Record<string, unknown> }>;
      };
    }).card;
    expect(card?.type).toBe('contract_bundle');
    expect(card?.requirements).toHaveLength(2);
    expect(card?.requirements?.[0]?.request).toMatchObject({
      dataProductId: 'dp-trial',
      purposeCode: '对话式任务配置（AI Chat Agent）',
      retention: '作业完成后 30 天',
      output: '仅聚合统计',
      validDays: 30,
    });
  });

  it('数据产品未授权 → 提交前拦下（产品级 ACL），给"找提供方开权限"的引导卡', async () => {
    const api = new FakeApiClient({ dataAccess: {} });
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    const result = await tool.execute(
      {
        values: {
          trial: 'p-sponsor',
          trialDataProduct: 'dp-trial',
          controls: 'p-hosp-a',
          controlsDataProduct: 'dp-controls',
          strataKeys: '<40|M',
        },
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      compliance: { status: 'needs_data_access', fix: 'request_data_access' },
    });
    expect(api.submissions).toHaveLength(0);
    const card = (result.data as { card?: { type: string; title?: string; steps?: string[] } }).card;
    expect(card?.type).toBe('contract_request');
    expect(card?.title).toContain('访问授权');
    expect(card?.steps?.join()).toContain('数据提供方');
  });

  it('授权查询不可用 → 不拦（unknown 交给控制面，与合约同一套失败策略）', async () => {
    const api = new FakeApiClient({ dataAccess: 'fail' });
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    const result = await tool.execute(
      {
        values: {
          trial: 'p-sponsor',
          trialDataProduct: 'dp-trial',
          controls: 'p-hosp-a',
          controlsDataProduct: 'dp-controls',
          strataKeys: '<40|M',
        },
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(api.submissions).toHaveLength(1);
  });

  it('登录态失效（401）→ 提交前拦下并提示重新登录，不带着坏 token 打控制面', async () => {
    const api = new FakeApiClient({ complianceUnauthorized: true });
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    const result = await tool.execute(
      {
        values: {
          trial: 'p-sponsor',
          trialDataProduct: 'dp-trial',
          controls: 'p-hosp-a',
          controlsDataProduct: 'dp-controls',
          strataKeys: '<40|M',
        },
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('重新登录');
    expect(api.submissions).toHaveLength(0);
    expect(result.data).toMatchObject({ compliance: { status: 'needs_permission' } });
  });

  it('权限不足 → 拦下但不出合约卡（问题不是合约，别把用户引偏）', async () => {
    const api = new FakeApiClient({
      mySpaces: { spaces: ['other'], memberships: [{ spaceId: 'other', role: 'consumer' }] },
    });
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    const result = await tool.execute(
      { values: { trial: 'p-sponsor', controls: 'p-hosp-a', strataKeys: '<40|M' } },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({ compliance: { status: 'needs_permission' } });
    expect((result.data as { card?: unknown }).card).toBeUndefined();
    expect(api.submissions).toHaveLength(0);
  });

  it('查到可用合约且载荷没带 → 自动补上 contractId 再提交', async () => {
    const api = new FakeApiClient();
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    // ToolContext.defaults 是 unknown（开放上下文）；测试里显式收窄
    const defaults = (context as unknown as { defaults: { contracts: string[] } }).defaults;
    const noContracts = {
      ...context,
      defaults: { ...defaults, contracts: [] },
    } as typeof context;

    const result = await tool.execute(
      { values: { trial: 'p-sponsor', controls: 'p-hosp-a', strataKeys: '<40|M' } },
      noContracts,
    );

    expect(result.success).toBe(true);
    expect(api.submissions).toHaveLength(1);
    expect((api.submissions[0].submission.payload as { contracts?: string[] }).contracts).toEqual([
      FAKE_USABLE_CONTRACT.id,
    ]);
  });

  it('载荷已配置合约时**不覆盖**（DEFAULT_CONTRACTS 优先，注入只填空）', async () => {
    const api = new FakeApiClient();
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    const result = await tool.execute(
      { values: { trial: 'p-sponsor', controls: 'p-hosp-a', strataKeys: '<40|M' } },
      context,
    );

    expect(result.success).toBe(true);
    const contracts = (api.submissions[0].submission.payload as { contracts?: string[] }).contracts;
    expect(contracts).not.toEqual([FAKE_USABLE_CONTRACT.id]);
    expect(contracts).toEqual(
      (context as unknown as { defaults: { contracts: string[] } }).defaults.contracts,
    );
  });

  it('合规查询失败 → 不拦（unknown 交给控制面判定，不把查询故障升级成不能用）', async () => {
    const api = new FakeApiClient({ complianceFailWith: 'ECONNREFUSED' });
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    const result = await tool.execute(
      { values: { trial: 'p-sponsor', controls: 'p-hosp-a', strataKeys: '<40|M' } },
      context,
    );

    expect(result.success).toBe(true);
    expect(api.submissions).toHaveLength(1);
  });

  it('负荷预测走模板两步，工具只声明 values', async () => {
    // 模板场景的参与方来自 templateInput：合约必须覆盖电网双方，否则前置闸会拦下
    const api = new FakeApiClient({
      contracts: [
        { ...FAKE_USABLE_CONTRACT, id: 'ct-grid-1', providerId: 'p-grid-a', consumerId: 'p-grid-b' },
      ],
    });
    const tool = buildSubmitTool(findScenario('load-forecast')!, api);
    const result = await tool.execute(
      {
        values: {
          participants: 'p-grid-a, p-grid-b',
          dataProducts: 'dp-load-a, dp-load-b',
          forecastHorizon: 24,
          features: 'load',
        },
      },
      context,
    );
    expect(result.success).toBe(true);
    expect(api.submissions[0].submission.mode).toBe('template');
    expect(api.submissions[0].submission.template).toBe('power.load-forecast');
    expect(tool.parameters.required).toEqual(['values']);
  });

  it('API 失败被转成 ToolResult 错误（不抛出）', async () => {
    const api = new FakeApiClient({ failWith: '409 [E_CHANNEL_UNKNOWN]' });
    const tool = buildSubmitTool(findScenario('external-control')!, api);
    const result = await tool.execute(
      {
        values: {
          trial: 'p-sponsor',
          trialDataProduct: 'dp-trial',
          controls: 'p-hosp-a',
          controlsDataProduct: 'dp-controls',
          strataKeys: '<40|M',
        },
      },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('E_CHANNEL_UNKNOWN');
  });

  it('refresh_scenario_card 重新出卡', async () => {
    const tool = buildRefreshCardTool([findScenario('external-control')!]);
    const ok = await tool.execute({ scenarioId: 'external-control' }, context);
    expect(ok.success).toBe(true);
    expect((ok.data as { scenario?: string }).scenario).toBe('external-control');
    const bad = await tool.execute({ scenarioId: 'nope' }, context);
    expect(bad.success).toBe(false);
  });
});
