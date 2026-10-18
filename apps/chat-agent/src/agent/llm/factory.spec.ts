import { buildChatConfig } from '../../config/agent.config';
import { FAKE_DIRECTORY } from '../../test-utils/fake-api-client';
import type { ScenarioBuildContext } from '../scenarios';
import { createLlmClient } from './factory';
import { CardRoutingLlmClient } from './card-routing.client';
import { RuleBasedLlmClient } from './rule-based.client';

const ctx: ScenarioBuildContext = {
  spaceId: 'sh-med',
  userId: 'u-1',
  directory: FAKE_DIRECTORY,
  defaults: {
    purpose: 'p',
    applicant: { org: 'u-1', project: 'sh-med' },
    contracts: [],
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2026-04-01T00:00:00.000Z',
    minCell: 5,
    teeNode: 'urn:tds:sh-med:participant:tee-node',
  },
};

const clientFor = (env: Record<string, string>) =>
  createLlmClient(buildChatConfig(env, 'system'), ctx);

const routedDelegate = (env: Record<string, string>): string => {
  const client = clientFor(env);
  expect(client).toBeInstanceOf(CardRoutingLlmClient);
  return (client as CardRoutingLlmClient).delegate.constructor.name;
};

describe('LLM 供应商选择（工厂 + 配置）', () => {
  it('无任何 key → rule-based（默认不出域）', () => {
    expect(clientFor({}).constructor.name).toBe(RuleBasedLlmClient.name);
    expect(buildChatConfig({}).llmMode).toBe('rule-based');
    expect(buildChatConfig({}).llmModelEffective).toBe('rule-based');
  });

  it('只有 DEEPSEEK_API_KEY → deepseek，模型默认 deepseek-flash', () => {
    const config = buildChatConfig({ DEEPSEEK_API_KEY: 'sk-x' });
    expect(config.llmMode).toBe('deepseek');
    expect(config.deepseekModel).toBe('deepseek-flash');
    expect(config.llmModelEffective).toBe('deepseek-flash');
    expect(config.deepseekBaseUrl).toBe('https://api.deepseek.com');
    expect(routedDelegate({ DEEPSEEK_API_KEY: 'sk-x' })).toBe('OpenAiCompatibleClient');
  });

  it('只有 ANTHROPIC_API_KEY → anthropic（现状不变）', () => {
    const config = buildChatConfig({ ANTHROPIC_API_KEY: 'sk-ant' });
    expect(config.llmMode).toBe('anthropic');
    expect(config.llmModelEffective).toBe('claude-3-5-sonnet-20241022');
    expect(routedDelegate({ ANTHROPIC_API_KEY: 'sk-ant' })).toBe('AnthropicClient');
  });

  it('两个 key 都在：LLM_PROVIDER 显式决定用哪个', () => {
    const both = { ANTHROPIC_API_KEY: 'sk-ant', DEEPSEEK_API_KEY: 'sk-ds' };
    expect(routedDelegate({ ...both, LLM_PROVIDER: 'deepseek' })).toBe('OpenAiCompatibleClient');
    expect(routedDelegate({ ...both, LLM_PROVIDER: 'anthropic' })).toBe('AnthropicClient');
  });

  it('显式指定却没给 key → 退回 rule-based（不崩，且就绪探针能看出来）', () => {
    expect(buildChatConfig({ LLM_PROVIDER: 'deepseek' }).llmMode).toBe('rule-based');
    expect(buildChatConfig({ LLM_PROVIDER: 'anthropic' }).llmMode).toBe('rule-based');
    expect(clientFor({ LLM_PROVIDER: 'deepseek' }).constructor.name).toBe(RuleBasedLlmClient.name);
  });

  it('DEEPSEEK_MODEL / DEEPSEEK_BASE_URL 可覆盖（baseUrl 结尾斜杠被归一）', () => {
    const config = buildChatConfig({
      DEEPSEEK_API_KEY: 'sk-x',
      DEEPSEEK_MODEL: 'deepseek-chat',
      DEEPSEEK_BASE_URL: 'https://gateway.internal/v1/',
    });
    expect(config.deepseekModel).toBe('deepseek-chat');
    expect(config.llmModelEffective).toBe('deepseek-chat');
    expect(config.deepseekBaseUrl).toBe('https://gateway.internal/v1');
  });
});
