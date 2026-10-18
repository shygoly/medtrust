import { PiAgent, type AgentConfig, type Tool } from '@medtrust/pi-agent';
import type { MedTrustChatConfig } from '../config/agent.config';
import { createLlmClient } from './llm/factory';
import type { SpaceDirectory } from './directory';
import type { ScenarioDefaults } from './scenarios';
import { buildTools } from './tools';
import type { MedTrustApiClient } from './tools/api-client';
import type { AssistantIntent } from './assistant-intent';
import { ASSISTANT_CONFIGS, toolsForIntent } from './assistant-intent';
import type { ScenarioDraft } from './scenario-draft';
import { buildSystemPrompt } from './prompts/system';

export interface CreateAgentDeps {
  config: MedTrustChatConfig;
  /** 请求级上下文：目录、治理默认值、身份 */
  spaceId: string;
  userId: string;
  directory: SpaceDirectory;
  defaults: ScenarioDefaults;
  apiClient: MedTrustApiClient;
  assistantIntent?: AssistantIntent;
  draft?: ScenarioDraft;
  role?: string;
}

/**
 * 每次对话构造一个 PiAgent（无共享可变状态，天然并发安全）。
 * 核心库 `@medtrust/pi-agent` 不含任何 MedTrust 词汇——场景知识全部在 tool/卡片层。
 */
export function createMedTrustAgent(deps: CreateAgentDeps): {
  agent: PiAgent;
  tools: Tool[];
} {
  const ctx = {
    spaceId: deps.spaceId,
    userId: deps.userId,
    directory: deps.directory,
    defaults: deps.defaults,
    assistantIntent: deps.assistantIntent ?? 'access-contract',
    ...(deps.draft ? { draft: deps.draft } : {}),
  };
  const intent = ctx.assistantIntent;
  const tools = buildTools(deps.apiClient, toolsForIntent(intent));
  const llm = createLlmClient(deps.config, ctx);
  const agentConfig: AgentConfig = {
    systemPrompt: buildSystemPrompt({
      intent,
      role: deps.role,
      draft: deps.draft,
      allowedTools: ASSISTANT_CONFIGS[intent].allowedTools,
    }),
    maxTokens: deps.config.llmMaxTokens,
  };
  return { agent: new PiAgent(agentConfig, tools, llm), tools };
}
