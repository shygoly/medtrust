import type { LLMMessage, Tool, ToolContext } from '@medtrust/pi-agent';
import { encodeCardSubmission, extractCardMessages, type CardMessage } from '@medtrust/chat-cards';
import { CANONICAL_SCENARIO_VALUES } from '../../test-utils/canonical-scenario-values';
import { FAKE_DIRECTORY, FakeApiClient } from '../../test-utils/fake-api-client';
import type { ScenarioBuildContext } from '../scenarios';
import { RuleBasedLlmClient } from '../llm/rule-based.client';
import { matchScenarios } from '../scenario-matcher';
import { buildTools } from '.';

const defaults = {
  purpose: '注册型单臂外部对照研究',
  applicant: { org: 'sponsor', project: 'REG-ECA-001' },
  contracts: [],
  notBefore: '2026-10-18T00:00:00.000Z',
  notAfter: '2026-11-18T00:00:00.000Z',
  minCell: 10,
  teeNode: 'urn:tds:sh-med:participant:tee-node',
};

const scenarioContext: ScenarioBuildContext = {
  spaceId: 'sh-med',
  userId: 'user-1',
  directory: FAKE_DIRECTORY,
  defaults,
};

const toolContext: ToolContext = {
  userId: 'user-1',
  spaceId: 'sh-med',
  sessionId: 'registration-chat-1',
  accessToken: 'token-1',
  directory: FAKE_DIRECTORY,
  defaults,
};

const REQUIRED_TOOLS = [
  'draft_registration_study',
  'validate_registration_profile',
  'resolve_registration_sources',
  'review_registration_plan',
  'prepare_synthetic_registration',
  'submit_external_control_registration',
  'get_registration_job',
  'build_registration_report',
  'download_registration_report',
] as const;

function findTool(tools: Tool[], name: string): Tool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

function firstCard(content: string): CardMessage {
  const { cards, invalid } = extractCardMessages(content);
  expect(invalid).toEqual([]);
  expect(cards.length).toBeGreaterThan(0);
  return cards[0]!;
}

function cardSubmission(card: CardMessage): string {
  return encodeCardSubmission({
    kind: 'card-submit',
    cardType: card.type,
    title: card.title,
    ...(card.scenario ? { scenario: card.scenario } : {}),
    values: card.data ?? {},
  });
}

describe('WP0 注册研究助手闭环', () => {
  it('注册 9 个确定性工具', () => {
    const names = new Set(buildTools(new FakeApiClient()).map((tool) => tool.name));
    expect(REQUIRED_TOOLS.every((name) => names.has(name))).toBe(true);
  });

  it('规则回退从自然语言一路走到 A10 下载卡', async () => {
    const api = new FakeApiClient();
    const tools = buildTools(api);
    const client = new RuleBasedLlmClient({ ctx: scenarioContext });
    const messages: LLMMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: '创建一项单臂外部对照注册研究并生成模拟报告' },
    ];
    const called: string[] = [];
    expect(matchScenarios('创建一项单臂外部对照注册研究并生成模拟报告', 3)[0]).toMatchObject({
      scenario: { id: 'external-control-registration' },
    });

    const execute = async (response: Awaited<ReturnType<RuleBasedLlmClient['complete']>>) => {
      const call = response.toolCalls?.[0];
      expect(call).toBeDefined();
      called.push(call!.name);
      const result = await findTool(tools, call!.name).execute(call!.parameters, toolContext);
      messages.push({ role: 'tool', content: JSON.stringify(result) });
      return client.complete(messages, tools);
    };

    let response = await client.complete(messages, tools);
    expect(response.toolCalls?.[0]?.name).toBe('draft_registration_study');
    response = await execute(response);
    let card = firstCard(response.content);
    expect(card).toMatchObject({
      type: 'form',
      scenario: 'external-control-registration',
      title: 'A02 · 注册研究草稿',
    });

    messages.push({
      role: 'user',
      content: encodeCardSubmission({
        kind: 'card-submit',
        cardType: card.type,
        title: card.title,
        scenario: card.scenario,
        values: CANONICAL_SCENARIO_VALUES['external-control-registration']!,
      }),
    });
    response = await client.complete(messages, tools);
    expect(response.toolCalls?.[0]?.name).toBe('validate_registration_profile');
    response = await execute(response);
    card = firstCard(response.content);
    expect(card.title).toContain('A03');

    for (const expectedTitle of ['A04', 'A05', 'A06']) {
      messages.push({ role: 'user', content: cardSubmission(card) });
      response = await client.complete(messages, tools);
      response = await execute(response);
      card = firstCard(response.content);
      expect(card.title).toContain(expectedTitle);
    }

    messages.push({ role: 'user', content: cardSubmission(card) });
    response = await client.complete(messages, tools);
    expect(response.toolCalls?.[0]?.name).toBe(
      'submit_external_control_registration',
    );
    response = await execute(response);
    card = firstCard(response.content);
    expect(card).toMatchObject({ type: 'status', tone: 'success' });
    expect(card.data?.jobId).toBeTruthy();

    messages.push({ role: 'user', content: '查询注册研究任务状态' });
    response = await client.complete(messages, tools);
    expect(response.toolCalls?.[0]?.name).toBe('get_registration_job');
    response = await execute(response);
    expect(firstCard(response.content).title).toContain('A08');

    messages.push({ role: 'user', content: '生成模拟注册研究报告' });
    response = await client.complete(messages, tools);
    expect(response.toolCalls?.[0]?.name).toBe('build_registration_report');
    response = await execute(response);
    expect(firstCard(response.content).title).toContain('A09');

    messages.push({ role: 'user', content: '下载模拟注册研究报告和证据包' });
    response = await client.complete(messages, tools);
    expect(response.toolCalls?.[0]?.name).toBe('download_registration_report');
    response = await execute(response);
    const download = firstCard(response.content);
    expect(download.title).toContain('A10');
    expect(download.description).toContain('SIMULATION ONLY');
    expect(download.data).toMatchObject({
      docx: expect.stringContaining('format=docx'),
      evidenceZip: expect.stringContaining('format=evidence-zip'),
    });

    expect(called).toEqual([
      'draft_registration_study',
      'validate_registration_profile',
      'resolve_registration_sources',
      'review_registration_plan',
      'prepare_synthetic_registration',
      'submit_external_control_registration',
      'get_registration_job',
      'build_registration_report',
      'download_registration_report',
    ]);
    expect(api.submissions).toHaveLength(1);
    expect(api.registrationReportBuilds).toHaveLength(1);
  });

  it('真实研究未冻结 P0 时在任何控制面提交前拒绝', async () => {
    const api = new FakeApiClient();
    const tool = findTool(
      buildTools(api),
      'validate_registration_profile',
    );
    const values = {
      ...CANONICAL_SCENARIO_VALUES['external-control-registration'],
      synthetic: false,
      p0DecisionsFrozen: false,
    };
    const result = await tool.execute({ values }, toolContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('P0');
    expect(api.submissions).toHaveLength(0);
  });
});
