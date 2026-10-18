import type { ToolContext } from '@medtrust/pi-agent';
import { FAKE_DIRECTORY, FakeApiClient } from '../../test-utils/fake-api-client';
import { buildContractRequestTool } from './contract.tools';
import { APPROVAL_SLA_HOURS, buildContractProgressTool } from './contract.tools';

const context: ToolContext = {
  userId: 'user-1',
  spaceId: 'sh-med',
  sessionId: 'session-1',
  accessToken: 'token-1',
  directory: FAKE_DIRECTORY,
  defaults: {},
};

const request = {
  dataProductId: 'dp-controls',
  purpose: '单臂试验外部对照分析',
  retention: '阅后即焚',
  output: '仅聚合统计',
  validDays: 30,
};

/** 卡片回灌的真实形态：values 里带 action（见 ContractApprovalCard 的 onClick）。 */
const submitted = { values: { action: 'request_contract', ...request } };

describe('request_contract 工具', () => {
  it('唯一预审时自动引用，把申请递出去（申请方身份用调用者，不借 agent 凭证）', async () => {
    const api = new FakeApiClient({ autoOffer: 'reject' });
    const result = await buildContractRequestTool(api).execute(submitted, context);

    expect(result.success).toBe(true);
    expect(api.contractRequests).toHaveLength(1);
    expect(api.contractRequests[0].input).toMatchObject({
      dataProductId: 'dp-controls',
      compositionId: 'comp-fake-1',
      purpose: '单臂试验外部对照分析',
      retention: '阅后即焚',
      output: '仅聚合统计',
      validDays: 30,
    });
    // 申请方身份与控制面一致：用调用者的 token/空间，不借 agent 自己的凭证
    expect(api.contractRequests[0].ctx).toMatchObject({ userId: 'user-1', spaceId: 'sh-med', token: 'token-1' });
    expect(result.data).toMatchObject({
      contractId: 'ct-requested-1',
      status: 'draft',
      requiresProviderApproval: true,
      fix: 'await_provider_approval',
    });
  });

  it('未预授权时：回"申请已提交、等提供方签发"的 pending 卡（并写明自动推进为何没走）', async () => {
    const api = new FakeApiClient({ autoOffer: 'reject' });
    const result = await buildContractRequestTool(api).execute(request, context);
    const card = (result.data as { card?: { type: string; tone?: string; data?: Record<string, unknown> } }).card;

    expect(card).toMatchObject({ type: 'status', tone: 'pending' });
    expect(card?.data?.contractId).toBe('ct-requested-1');
    expect(result.data).toMatchObject({ autoOffered: false });
    expect(
      (result.data as { contractRequest: { autoOfferSkipped?: string } }).contractRequest
        .autoOfferSkipped,
    ).toContain('尚未预授权');
  });

  it('Phase 3 自动创建：预授权 + 院内自动签 → 合约即刻可用，回"已自动生效"卡', async () => {
    const api = new FakeApiClient(); // 缺省 = 控制面接受自动推进，且连接器自动签
    const result = await buildContractRequestTool(api).execute(request, context);
    const data = result.data as {
      status?: string;
      requiresProviderApproval?: boolean;
      autoOffered?: boolean;
      card?: { type: string; tone?: string; title?: string; data?: Record<string, unknown> };
    };

    expect(data.status).toBe('active');
    expect(data.requiresProviderApproval).toBe(false);
    expect(data.autoOffered).toBe(true);
    expect(data.card).toMatchObject({ type: 'status', tone: 'success' });
    expect(data.card?.title).toContain('自动生效');
    expect(data.card?.data?.contractId).toBe('ct-requested-1');
  });

  it('预授权已发要约、但连接器策略是人工复核 → 不假装成功，回"等签发"卡', async () => {
    const api = new FakeApiClient({ autoOffer: 'offer-only' });
    const result = await buildContractRequestTool(api).execute(request, context);
    const data = result.data as {
      autoOffered?: boolean;
      fix?: string | null;
      card?: { type: string; tone?: string; description?: string };
    };

    expect(data.autoOffered).toBe(true);
    expect(data.fix).toBe('await_provider_approval');
    expect(data.card).toMatchObject({ type: 'status', tone: 'pending' });
    expect(data.card?.description).toContain('自动发出要约');
  });

  it('显式给了 compositionId 就不再查预审列表（用户选定的那一份）', async () => {
    const api = new FakeApiClient({ compositions: [] });
    const result = await buildContractRequestTool(api).execute(
      { ...request, compositionId: 'comp-chosen' },
      context,
    );

    expect(result.success).toBe(true);
    expect(api.contractRequests[0].input.compositionId).toBe('comp-chosen');
  });

  it('必填缺失 → 不调用控制面，并列出缺哪些字段', async () => {
    const api = new FakeApiClient();
    const result = await buildContractRequestTool(api).execute(
      { values: { dataProductId: 'dp-1', purpose: '  ' } },
      context,
    );

    expect(result.success).toBe(false);
    expect(api.contractRequests).toHaveLength(0);
    expect(result.error).toContain('retention');
    expect((result.data as { contractRequest: { missing: string[] } }).contractRequest.missing).toEqual([
      'purpose',
      'retention',
      'output',
    ]);
  });

  it('没有登录态 → 如实拒绝（申请方身份由控制面按 JWT 判定，agent 不代签）', async () => {
    const api = new FakeApiClient();
    const anon: ToolContext = { ...context, accessToken: undefined };
    const result = await buildContractRequestTool(api).execute(request, anon);

    expect(result.success).toBe(false);
    expect(api.contractRequests).toHaveLength(0);
    expect(result.data).toMatchObject({ contractRequest: { fix: 'sign_in' } });
  });

  it('本方没有合规预审 → 引导去建预审（不编 compositionId）', async () => {
    const api = new FakeApiClient({ compositions: [] });
    const result = await buildContractRequestTool(api).execute(request, context);

    expect(result.success).toBe(false);
    expect(api.contractRequests).toHaveLength(0);
    expect(result.data).toMatchObject({ contractRequest: { fix: 'create_pre_review' } });
    const card = (result.data as { card?: { type: string; steps?: string[] } }).card;
    expect(card?.type).toBe('contract_request');
    expect(card?.steps?.join()).toContain('合规预审');
  });

  it('多份预审且未指定 → 列候选让用户选，而不是随便挑一份', async () => {
    const api = new FakeApiClient({
      compositions: [
        { id: 'comp-a', scenarioKey: 'rws.external-control', verdict: 'pass' },
        { id: 'comp-b', scenarioKey: 'rws.cohort-count', verdict: 'review' },
      ],
    });
    const result = await buildContractRequestTool(api).execute(request, context);

    expect(result.success).toBe(false);
    expect(api.contractRequests).toHaveLength(0);
    const data = result.data as {
      contractRequest: { fix: string; candidates: Array<{ compositionId: string }> };
      card?: { type: string; steps?: string[] };
    };
    expect(data.contractRequest.fix).toBe('choose_pre_review');
    expect(data.contractRequest.candidates.map((item) => item.compositionId)).toEqual(['comp-a', 'comp-b']);
    expect(data.card?.type).toBe('contract_request');
    expect(data.card?.steps?.join()).toContain('comp-a');
  });

  it('控制面拒绝 → 原样把原因带回来（不吞成通用错误）', async () => {
    const api = new FakeApiClient({ contractRequestFailWith: '403 只能引用属于本方的合规预审' });
    const result = await buildContractRequestTool(api).execute(request, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('只能引用属于本方的合规预审');
    expect(result.data).toMatchObject({ contractRequest: { fix: 'request_contract_failed' } });
  });

  it('有效期超范围时回落到 30 天（不把 9999 天递给控制面）', async () => {
    const api = new FakeApiClient();
    await buildContractRequestTool(api).execute({ ...request, validDays: 9999 }, context);
    expect(api.contractRequests[0].input.validDays).toBe(30);
  });
});

describe('list_contract_requests 工具（Phase 4.4 审批进度）', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  const withContracts = (contracts: unknown[]) =>
    new FakeApiClient({ contracts: contracts as never });

  it('逐条给出状态与等待时长，并对超过 24h 的申请标 SLA 超时', async () => {
    const api = withContracts([
      {
        id: 'ct-pending-slow',
        providerId: 'p-hosp-a',
        consumerId: 'p-sponsor',
        status: 'draft',
        createdAt: hoursAgo(30),
      },
      {
        id: 'ct-pending-fresh',
        providerId: 'p-hosp-a',
        consumerId: 'p-sponsor',
        status: 'draft',
        createdAt: hoursAgo(2),
      },
      {
        id: 'ct-ready',
        providerId: 'p-hosp-a',
        consumerId: 'p-sponsor',
        status: 'active',
        mdopStatus: 'active',
        holderSigned: true,
        createdAt: hoursAgo(5),
      },
    ]);
    const result = await buildContractProgressTool(api).execute({}, context);
    const data = result.data as {
      pending?: number;
      ready?: number;
      slaHours?: number;
      requests?: Array<{ contractId: string; state: string; waitingHours: number; slaBreached: boolean }>;
      card?: { tone?: string; description?: string };
    };

    expect(data.pending).toBe(2);
    expect(data.ready).toBe(1);
    expect(data.slaHours).toBe(APPROVAL_SLA_HOURS);
    const slow = data.requests?.find((row) => row.contractId === 'ct-pending-slow');
    expect(slow).toMatchObject({ state: 'pending_issuance', slaBreached: true });
    expect(slow?.waitingHours).toBeGreaterThanOrEqual(29.9);
    expect(data.requests?.find((row) => row.contractId === 'ct-pending-fresh')?.slaBreached).toBe(
      false,
    );
    expect(data.requests?.find((row) => row.contractId === 'ct-ready')?.state).toBe('ready');
    // 有超时件 → 卡片用 warning 语气，并把"超过 24 小时"写进正文
    expect(data.card?.tone).toBe('warning');
    expect(data.card?.description).toContain('超过 24 小时');
  });

  it('status 过滤：只看待签发 / 只看已就绪', async () => {
    const api = withContracts([
      { id: 'ct-p', providerId: 'p-hosp-a', consumerId: 'p-sponsor', status: 'draft', createdAt: hoursAgo(1) },
      {
        id: 'ct-r',
        providerId: 'p-hosp-a',
        consumerId: 'p-sponsor',
        status: 'active',
        mdopStatus: 'active',
        holderSigned: true,
        createdAt: hoursAgo(1),
      },
    ]);
    const pending = await buildContractProgressTool(api).execute({ status: 'pending' }, context);
    expect((pending.data as { requests: unknown[] }).requests).toHaveLength(1);
    expect((pending.data as { requests: Array<{ contractId: string }> }).requests[0].contractId).toBe(
      'ct-p',
    );

    const ready = await buildContractProgressTool(api).execute({ status: 'ready' }, context);
    expect((ready.data as { requests: Array<{ contractId: string }> }).requests[0].contractId).toBe(
      'ct-r',
    );
  });

  it('控制面没给创建时间 → 等待时长记 null（未知），不拿 0 冒充', async () => {
    const api = withContracts([
      { id: 'ct-unknown', providerId: 'p-hosp-a', consumerId: 'p-sponsor', status: 'draft' },
    ]);
    const result = await buildContractProgressTool(api).execute({}, context);
    const row = (result.data as { requests: Array<{ waitingHours: number | null; slaBreached: boolean }> })
      .requests[0];
    expect(row.waitingHours).toBeNull();
    expect(row.slaBreached).toBe(false);
  });

  it('没有登录态 → 如实拒绝（进度按调用者身份过滤，不能借用 agent 凭证）', async () => {
    const api = withContracts([]);
    const anon: ToolContext = { ...context, accessToken: undefined };
    await expect(buildContractProgressTool(api).execute({}, anon)).resolves.toMatchObject({
      success: false,
      error: '查询合约进度需要你的登录态',
    });
  });

  it('没有任何申请时出"还没有合约申请"的说明卡（不空回）', async () => {
    const api = withContracts([]);
    const result = await buildContractProgressTool(api).execute({}, context);
    const card = (result.data as { card?: { title?: string } }).card;
    expect(card?.title).toContain('还没有合约申请');
  });
});
