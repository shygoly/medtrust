import type { LLMMessage } from '@medtrust/pi-agent';
import { encodeCardSubmission } from '@medtrust/chat-cards';
import { extractCardMessages } from '@medtrust/chat-cards';
import { FAKE_DIRECTORY } from '../../test-utils/fake-api-client';
import { buildTools } from '../tools';
import { FakeApiClient } from '../../test-utils/fake-api-client';
import type { ScenarioBuildContext } from '../scenarios';
import { RuleBasedLlmClient } from './rule-based.client';

const ctx: ScenarioBuildContext = {
  spaceId: 'sh-med',
  userId: 'user-1',
  directory: FAKE_DIRECTORY,
  defaults: {
    purpose: '外部对照 RWS',
    applicant: { org: 'user-1', project: 'sh-med' },
    contracts: ['ct-1'],
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2026-04-01T00:00:00.000Z',
    minCell: 5,
    teeNode: 'urn:tds:sh-med:participant:tee-node',
  },
};

const tools = buildTools(new FakeApiClient());
const client = new RuleBasedLlmClient({ ctx });

const system: LLMMessage = { role: 'system', content: 'system' };

describe('确定性回退客户端', () => {
  it('自然语言 → 出场景卡片（含 scenario 标识）', async () => {
    const response = await client.complete(
      [system, { role: 'user', content: '我想做单臂试验的外部对照' }],
      tools,
    );
    expect(response.toolCalls).toBeUndefined();
    const { cards } = extractCardMessages(response.content);
    expect(cards).toHaveLength(1);
    expect(cards[0].scenario).toBe('external-control');
    expect(cards[0].type).toBe('form');
  });

  it('多个候选时不猜，出候选卡片', async () => {
    const response = await client.complete(
      [system, { role: 'user', content: '负荷预测和窃电检测都要' }],
      tools,
    );
    const { cards } = extractCardMessages(response.content);
    expect(cards[0].title).toBe('这几个场景可能都合适');
  });

  it('无匹配时列出全部场景', async () => {
    const response = await client.complete([system, { role: 'user', content: '你好' }], tools);
    const { cards } = extractCardMessages(response.content);
    expect(cards[0].title).toBe('可用的计算场景');
  });

  it('卡片提交信封 → 调用对应 submit 工具', async () => {
    const envelope = encodeCardSubmission({
      kind: 'card-submit',
      cardType: 'form',
      title: '外部对照配置',
      scenario: 'external-control',
      values: { trial: 'p-sponsor', controls: 'p-hosp-a' },
    });
    const response = await client.complete([system, { role: 'user', content: envelope }], tools);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0].name).toBe('submit_external_control');
    expect(response.toolCalls?.[0].parameters).toEqual({
      values: { trial: 'p-sponsor', controls: 'p-hosp-a' },
    });
  });

  it('没有该场景的工具时给出「暂未开放」而不是静默失败', async () => {
    const envelope = encodeCardSubmission({
      kind: 'card-submit',
      cardType: 'form',
      title: 'x',
      scenario: 'external-control',
      values: {},
    });
    const response = await client.complete([system, { role: 'user', content: envelope }], []);
    const { cards } = extractCardMessages(response.content);
    expect(cards[0].title).toBe('场景暂未开放');
  });

  it('工具成功后回报任务 ID 与状态卡', async () => {
    const response = await client.complete(
      [
        system,
        { role: 'user', content: '我想做单臂对照' },
        {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            data: { jobId: 'job-9', status: 'submitted', template: 'rws.external-control', stages: 6 },
          }),
        },
      ],
      tools,
    );
    expect(response.content).toContain('job-9');
    const { cards } = extractCardMessages(response.content);
    expect(cards[0]).toMatchObject({ type: 'status', tone: 'success' });
    expect(cards[0].data).toMatchObject({ jobId: 'job-9' });
  });

  it('状态卡带上这次作业用的合约 id（用户要能看见哪份授权）', async () => {
    const response = await client.complete(
      [
        system,
        { role: 'user', content: '我想做单臂对照' },
        {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            data: {
              jobId: 'job-9',
              status: 'submitted',
              template: 'rws.external-control',
              contractId: 'ct-9',
            },
          }),
        },
      ],
      tools,
    );
    const { cards } = extractCardMessages(response.content);
    expect(cards[0].data).toMatchObject({ jobId: 'job-9', contractId: 'ct-9' });
  });

  it('工具失败时回报失败卡与恢复建议', async () => {
    const response = await client.complete(
      [
        system,
        { role: 'user', content: '我想做单臂对照' },
        { role: 'tool', content: JSON.stringify({ success: false, error: '试验方与对照方不能是同一参与方' }) },
      ],
      tools,
    );
    const { cards } = extractCardMessages(response.content);
    expect(cards[0].tone).toBe('error');
    expect(cards[0].description).toContain('试验方与对照方不能是同一参与方');
  });

  it('校验失败的真实工具产出能驱动预填回卡（生产端 ↔ 消费端的接缝）', async () => {
    // 关键差别：这里**不手写信封**，而是真的跑一遍 submit 工具，
    // 把它真实的返回值喂给客户端。手写信封的用例曾经掩盖过
    // "工具只回 scenario、不回 values，于是回卡根本不出现"这个缺陷。
    const api = new FakeApiClient();
    const tool = buildTools(api).find((item) => item.name === 'submit_external_control')!;
    const toolResult = await tool.execute(
      { values: { trial: 'p-sponsor', controls: 'p-sponsor', strataKeys: '<40|M' } },
      {
        userId: 'user-1',
        spaceId: 'sh-med',
        sessionId: 's-1',
        directory: FAKE_DIRECTORY,
        defaults: ctx.defaults,
      },
    );
    expect(toolResult.success).toBe(false);

    const response = await client.complete(
      [system, { role: 'user', content: '我想做单臂对照' }, { role: 'tool', content: JSON.stringify(toolResult) }],
      tools,
    );
    const { cards } = extractCardMessages(response.content);

    const retry = cards.find((card) => card.type === 'form');
    expect(retry?.title).toBe('修改后重新提交');
    // 值真的回填了（不是一张空表）
    const trialField = (retry as { fields: Array<{ name: string; defaultValue?: unknown }> }).fields.find(
      (field) => field.name === 'trial',
    );
    expect(trialField?.defaultValue).toBe('p-sponsor');
  });

  it('工具失败且能定位场景时，额外给一张预填过的卡片（3.4.3）', async () => {
    const response = await client.complete(
      [
        system,
        { role: 'user', content: '我想做单臂对照' },
        {
          role: 'tool',
          content: JSON.stringify({
            success: false,
            error: '试验方与对照方不能是同一参与方',
            data: {
              scenario: 'external-control',
              values: { trial: 'p-sponsor', controls: 'p-sponsor', strataKeys: '<40|M' },
            },
          }),
        },
      ],
      tools,
    );
    const { cards } = extractCardMessages(response.content);
    const retry = cards.find((card) => card.type === 'form');
    expect(retry?.scenario).toBe('external-control');
    expect(retry?.title).toBe('修改后重新提交');
    expect(retry?.fields?.find((field) => field.name === 'trial')?.defaultValue).toBe('p-sponsor');
    // 失败的取值也回填（用户改的是对照方，不是试验方）
    expect(retry?.fields?.find((field) => field.name === 'controls')?.defaultValue).toBe('p-sponsor');
  });

  it('工具自带卡时原样输出（合规闸的判定卡由工具生成，模型不参与创作）', async () => {
    const api = new FakeApiClient({ contracts: [] });
    const tool = buildTools(api).find((item) => item.name === 'submit_external_control')!;
    const toolResult = await tool.execute(
      {
        values: {
          trial: 'p-sponsor',
          trialDataProduct: 'dp-trial',
          controls: 'p-hosp-a',
          controlsDataProduct: 'dp-controls',
          strataKeys: '<40|M',
        },
      },
      {
        userId: 'user-1',
        spaceId: 'sh-med',
        sessionId: 's-1',
        accessToken: 'token-1',
        directory: FAKE_DIRECTORY,
        defaults: ctx.defaults,
      },
    );
    expect(toolResult.success).toBe(false);

    const response = await client.complete(
      [system, { role: 'user', content: '我想做单臂对照' }, { role: 'tool', content: JSON.stringify(toolResult) }],
      tools,
    );
    const { cards, invalid } = extractCardMessages(response.content);

    expect(invalid).toEqual([]);
    const bundle = cards.find((card) => card.type === 'contract_bundle') as
      | {
          title?: string;
          requirements?: Array<{ role?: string; request?: Record<string, unknown> }>;
        }
      | undefined;
    expect(bundle?.title).toBe('数据合约包需要补齐');
    expect(bundle?.requirements).toHaveLength(2);
    expect(bundle?.requirements?.[0]?.request).toMatchObject({
      dataProductId: 'dp-trial',
      purposeCode: '对话式任务配置（AI Chat Agent）',
    });
    // 引导语用工具给的原因，而不是笼统的"失败"
    expect(response.content).toContain('合约');
  });

  it('合约审批卡的提交信封 → 调 request_contract，参数就是卡片回灌的 values', async () => {
    const envelope = encodeCardSubmission({
      kind: 'card-submit',
      cardType: 'contract_approval',
      title: '数据合约申请审批',
      values: { action: 'request_contract', dataProductId: 'dp-controls', purpose: '单臂试验外部对照分析' },
    });
    const response = await client.complete([system, { role: 'user', content: envelope }], tools);

    expect(response.toolCalls?.[0].name).toBe('request_contract');
    expect(response.toolCalls?.[0].parameters).toEqual({
      values: { action: 'request_contract', dataProductId: 'dp-controls', purpose: '单臂试验外部对照分析' },
    });
  });

  it('合约申请成功但连接器是人工复核 → 出"申请已提交"的 pending 状态卡（不是 success）', async () => {
    const api = new FakeApiClient({ autoOffer: 'offer-only' });
    const tool = buildTools(api).find((item) => item.name === 'request_contract')!;
    const toolResult = await tool.execute(
      {
        values: {
          action: 'request_contract',
          dataProductId: 'dp-controls',
          purpose: '单臂试验外部对照分析',
          retention: '阅后即焚',
          output: '仅聚合统计',
          validDays: 30,
        },
      },
      {
        userId: 'user-1',
        spaceId: 'sh-med',
        sessionId: 's-1',
        accessToken: 'token-1',
        directory: FAKE_DIRECTORY,
        defaults: ctx.defaults,
      },
    );
    expect(toolResult.success).toBe(true);

    const response = await client.complete(
      [system, { role: 'user', content: '好的' }, { role: 'tool', content: JSON.stringify(toolResult) }],
      tools,
    );
    const { cards } = extractCardMessages(response.content);
    expect(cards[0]).toMatchObject({ type: 'status', tone: 'pending' });
    expect(cards[0].data?.contractId).toBe('ct-requested-1');
  });
});
