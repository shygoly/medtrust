import { AnthropicClient, OpenAiCompatibleClient, type LLMClient } from '@medtrust/pi-agent';
import type { MedTrustChatConfig } from '../../config/agent.config';
import type { ScenarioBuildContext } from '../scenarios';
import { CardRoutingLlmClient } from './card-routing.client';
import { RuleBasedLlmClient } from './rule-based.client';

/**
 * LLM 客户端工厂。
 *
 * `deepseek` 模式：OpenAI 兼容协议（`DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`）。
 * `anthropic` 模式：Anthropic Messages API（`ANTHROPIC_API_KEY` / `LLM_MODEL`）。
 * `rule-based` 模式：无 key（或显式指定却缺 key）时的确定性回退（问题文本不出域）。
 *
 * 出域边见 AGENT.md AGT-05：三个模式里只有 rule-based 不外发任何内容。
 */
export function createLlmClient(
  config: MedTrustChatConfig,
  ctx: ScenarioBuildContext,
): LLMClient {
  if (config.llmMode === 'deepseek' && config.deepseekApiKey) {
    return new CardRoutingLlmClient(
      new OpenAiCompatibleClient({
        apiKey: config.deepseekApiKey,
        baseUrl: config.deepseekBaseUrl,
        model: config.deepseekModel,
        maxTokens: config.llmMaxTokens,
      }),
      ctx,
    );
  }
  if (config.llmMode === 'anthropic' && config.anthropicApiKey) {
    return new CardRoutingLlmClient(
      new AnthropicClient({
        apiKey: config.anthropicApiKey,
        model: config.llmModel,
        maxTokens: config.llmMaxTokens,
      }),
      ctx,
    );
  }
  // rule-based 自己已经包含卡片提交路由，不再套一层。
  return new RuleBasedLlmClient({ ctx });
}
