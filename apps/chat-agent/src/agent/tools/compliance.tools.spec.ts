import type { ToolContext } from '@medtrust/pi-agent';
import {
  FAKE_DIRECTORY,
  FAKE_USABLE_CONTRACT,
  FakeApiClient,
} from '../../test-utils/fake-api-client';
import { buildComplianceTools } from './compliance.tools';

const context: ToolContext = {
  userId: 'user-1',
  spaceId: 'sh-med',
  sessionId: 'session-1',
  accessToken: 'token-1',
  directory: FAKE_DIRECTORY,
  defaults: {},
};

const tool = (api: FakeApiClient, name: string) => {
  const found = buildComplianceTools(api).find((item) => item.name === name);
  if (!found) throw new Error(`未注册工具：${name}`);
  return found;
};

interface CardShape {
  type: string;
  title?: string;
  reason?: string;
  steps?: string[];
  contract?: {
    purpose?: string;
    providerId?: string;
    autoApprove?: boolean;
    contractId?: string;
    request?: Record<string, unknown>;
  };
}

const cardOf = (data: unknown): CardShape | undefined => (data as { card?: CardShape }).card;

describe('check_data_access（产品级 ACL，D-ACL-1）', () => {
  it('已授权 → allowed:true（不打扰用户）', async () => {
    const result = await tool(new FakeApiClient(), 'check_data_access').execute(
      { dataProductId: 'dp-controls' },
      context,
    );
    expect(result).toMatchObject({ success: true, data: { allowed: true } });
    expect(cardOf(result.data)).toBeUndefined();
  });

  it('未授权 → success:false + 找提供方开权限的引导卡（agent 不承诺自己能开权限）', async () => {
    const result = await tool(new FakeApiClient({ dataAccess: {} }), 'check_data_access').execute(
      { dataProductId: 'dp-controls' },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('还没有授权给你所在的参与方');
    const card = cardOf(result.data);
    expect(card?.type).toBe('contract_request');
    expect(card?.steps?.join()).toContain('数据提供方');
  });

  it('缺 dataProductId → 参数错（不拿空 id 去问控制面）', async () => {
    await expect(tool(new FakeApiClient(), 'check_data_access').execute({}, context)).resolves
      .toMatchObject({ success: false, error: 'dataProductId 不能为空' });
  });

  it('查询不可用 → allowed:null（unknown，不拦）', async () => {
    const result = await tool(new FakeApiClient({ dataAccess: 'fail' }), 'check_data_access').execute(
      { dataProductId: 'dp-controls' },
      context,
    );
    expect(result).toMatchObject({ success: true, data: { allowed: null, reason: 'unknown' } });
  });
});

describe('check_space_membership', () => {
  it('属于空间 → isMember 与角色；不属于 → success:false 且带原因', async () => {
    const api = new FakeApiClient();
    const check = tool(api, 'check_space_membership');

    await expect(check.execute({ spaceId: 'sh-med' }, context)).resolves.toMatchObject({
      success: true,
      data: { spaceId: 'sh-med', isMember: true, role: 'consumer' },
    });

    await expect(check.execute({}, { ...context, spaceId: 'other-space' })).resolves.toMatchObject({
      success: false,
      data: { spaceId: 'other-space', isMember: false },
    });
  });
});

describe('check_contract_status（含"下一步该做什么"的现成卡）', () => {
  it('合约可用 → 不出卡，只回判定与合约 id', async () => {
    const api = new FakeApiClient();
    const result = await tool(api, 'check_contract_status').execute(
      {
        requirements: [
          { participantId: 'p-hosp-a', dataProductId: 'dp-controls' },
        ],
        purpose: 'mdop.external-control',
      },
      context,
    );

    expect(result).toMatchObject({
      success: true,
      data: { status: 'usable', contractId: 'ct-fake-1', contractStatus: 'active' },
    });
    expect(cardOf(result.data)).toBeUndefined();
  });

  it('没有合约 + 已知数据产品 → 出"合约申请"卡，入参带默认条款、提供方取自目录', async () => {
    const api = new FakeApiClient({ contracts: [] });
    const result = await tool(api, 'check_contract_status').execute(
      {
        requirements: [
          { participantId: 'p-hosp-a', dataProductId: 'dp-controls' },
        ],
        purpose: '单臂试验外部对照分析',
        dataProductId: 'dp-controls',
        validDays: 14,
      },
      context,
    );

    expect(result).toMatchObject({ success: false, data: { status: 'missing', fix: 'request_contract' } });
    const card = cardOf(result.data);
    expect(card?.type).toBe('contract_approval');
    // 提供方来自目录的数据产品 ownerId，不是模型编的
    expect(card?.contract?.providerId).toBe('p-hosp-a');
    expect(card?.contract?.autoApprove).toBe(false);
    expect(card?.contract?.request).toMatchObject({
      dataProductId: 'dp-controls',
      purpose: '单臂试验外部对照分析',
      retention: '阅后即焚',
      output: '仅聚合统计',
      validDays: 14,
    });
  });

  it('有合约但未签发 → 出"等签发"引导卡（不让用户重复申请）', async () => {
    const api = new FakeApiClient({
      contracts: [{ ...FAKE_USABLE_CONTRACT, id: 'ct-draft', status: 'draft', holderSigned: false }],
    });
    const result = await tool(api, 'check_contract_status').execute(
      {
        requirements: [
          { participantId: 'p-hosp-a', dataProductId: 'dp-controls' },
        ],
        purpose: 'mdop.external-control',
      },
      context,
    );

    expect(result).toMatchObject({ success: false, data: { status: 'not-usable', fix: 'await_provider_approval' } });
    const card = cardOf(result.data);
    expect(card?.type).toBe('contract_request');
    expect(card?.contract?.contractId).toBe('ct-draft');
    expect(result.error).toContain('E_CONTRACT_UNSIGNED');
  });

  it('单数据源缺合约 → 用 matrix 中显式 dataProductId 生成审批卡，不要求模型再猜', async () => {
    const api = new FakeApiClient({ contracts: [] });
    const result = await tool(api, 'check_contract_status').execute(
      {
        requirements: [
          { participantId: 'p-hosp-a', dataProductId: 'dp-controls' },
        ],
      },
      context,
    );

    const card = cardOf(result.data);
    expect(card?.type).toBe('contract_approval');
    expect(card?.contract?.request).toMatchObject({ dataProductId: 'dp-controls' });
  });

  it('查询故障（unknown）→ 不拦、不出卡（交给控制面判定）', async () => {
    const api = new FakeApiClient({ complianceFailWith: 'ECONNREFUSED' });
    const result = await tool(api, 'check_contract_status').execute(
      {
        requirements: [
          { participantId: 'p-hosp-a', dataProductId: 'dp-controls' },
        ],
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ status: 'unknown' });
    expect(cardOf(result.data)).toBeUndefined();
  });

  it('requirements 为空 → 直接报参数错（不拿空集合去判定）', async () => {
    const api = new FakeApiClient();
    await expect(tool(api, 'check_contract_status').execute({}, context)).resolves.toMatchObject({
      success: false,
      error: 'requirements 不能为空（每项需 participantId + dataProductId）',
    });
  });

  it('双数据源各一份 active 合约 → ready，不因“一份合约没有覆盖两方”误拦', async () => {
    const api = new FakeApiClient({
      contracts: [
        {
          ...FAKE_USABLE_CONTRACT,
          id: 'ct-trial',
          providerId: 'p-sponsor',
          consumerId: 'pharma-demo',
          dataProductId: 'dp-trial',
        },
        {
          ...FAKE_USABLE_CONTRACT,
          id: 'ct-controls',
          providerId: 'p-hosp-a',
          consumerId: 'pharma-demo',
          dataProductId: 'dp-controls',
        },
      ],
    });
    const result = await tool(api, 'check_contract_status').execute(
      {
        requirements: [
          { role: 'trial', participantId: 'p-sponsor', dataProductId: 'dp-trial' },
          { role: 'controls', participantId: 'p-hosp-a', dataProductId: 'dp-controls' },
        ],
        purpose: '对话式任务配置（AI Chat Agent）',
      },
      context,
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        status: 'usable',
        contractBundle: { status: 'active' },
      },
    });
  });

  it('双缺失 → 一张 contract_bundle 卡同时返回两条依赖', async () => {
    const api = new FakeApiClient({ contracts: [] });
    const result = await tool(api, 'check_contract_status').execute(
      {
        requirements: [
          { role: 'trial', participantId: 'p-sponsor', dataProductId: 'dp-trial' },
          { role: 'controls', participantId: 'p-hosp-a', dataProductId: 'dp-controls' },
        ],
        purpose: '对话式任务配置（AI Chat Agent）',
      },
      context,
    );
    expect(result.success).toBe(false);
    const card = cardOf(result.data) as CardShape & {
      requirements?: Array<{ role: string; state: string }>;
    };
    expect(card.type).toBe('contract_bundle');
    expect(card.requirements).toHaveLength(2);
    expect(card.requirements?.map((item) => item.role)).toEqual(['trial', 'controls']);
  });

  it('两份合约都存在但用途不符 → 返回真实 E_PURPOSE_MISMATCH，不降级成 missing', async () => {
    const api = new FakeApiClient({
      contracts: [
        { ...FAKE_USABLE_CONTRACT, purposeCode: 'drug-registration' },
        {
          ...FAKE_USABLE_CONTRACT,
          id: 'ct-controls',
          dataProductId: 'dp-controls',
          purposeCode: 'drug-registration',
        },
      ],
    });
    const result = await tool(api, 'check_contract_status').execute(
      {
        requirements: [
          { role: 'trial', participantId: 'p-hosp-a', dataProductId: 'dp-controls' },
        ],
        purpose: '对话式任务配置（AI Chat Agent）',
      },
      context,
    );
    expect(result.success).toBe(false);
    expect((result.data as { status?: string }).status).toBe('not-usable');
    expect(result.error).toContain('E_PURPOSE_MISMATCH');
    expect(result.error).not.toContain('E_CONTRACT_MISSING');
  });
});
