import type { LLMClient, LLMMessage, LLMResponse, Tool } from '@medtrust/pi-agent';
import { parseCardSubmission } from '@medtrust/chat-cards';
import { findScenario, type ScenarioBuildContext } from '../scenarios';

/**
 * 卡片提交是**结构化控制消息**，不是自然语言。
 *
 * 无论底层使用 rule-based、DeepSeek 还是 Anthropic，提交按钮回灌的 values 都必须原样
 * 进入对应的受治理工具；不能让模型重新解释参数、猜场景或编造工具结果。
 * 自然语言消息仍全部委托给底层 LLM。
 */
export class CardRoutingLlmClient implements LLMClient {
  constructor(
    readonly delegate: LLMClient,
    private readonly ctx: ScenarioBuildContext,
  ) {}

  async complete(messages: LLMMessage[], tools: Tool[]): Promise<LLMResponse> {
    const last = messages[messages.length - 1];
    // 只在“本轮用户消息就是卡提交”时短路。工具返回后最后一轮是 tool，必须交回原客户端
    // 生成最终结果；否则同一张历史卡会被反复提交，形成无限工具循环。
    if (last?.role !== 'user') return this.delegate.complete(messages, tools);
    const submission = parseCardSubmission(last.content);
    if (!submission) return this.delegate.complete(messages, tools);

    if (
      submission.cardType === 'contract_approval' ||
      submission.cardType === 'contract_apply' ||
      submission.cardType === 'contract_bundle'
    ) {
      const prepare = submission.values.action === 'prepare_contract_apply';
      const toolName = prepare ? 'prepare_contract_apply' : 'request_contract';
      if (!tools.some((tool) => tool.name === toolName)) {
        return { content: '本实例没有注册合约申请工具。' };
      }
      return {
        content: prepare ? '好的，正在准备合约申请单…' : '好的，正在提交合约申请…',
        toolCalls: [
          {
            id: `call-contract-${Date.now()}`,
            name: toolName,
            parameters: prepare ? submission.values : { values: submission.values },
          },
        ],
      };
    }

    if (submission.cardType !== 'form') return this.delegate.complete(messages, tools);
    const scenario = findScenario(submission.scenario ?? '');
    if (!scenario) return { content: '无法识别这张卡片对应的计算场景，请重新描述需求。' };
    if (!tools.some((tool) => tool.name === scenario.toolName)) {
      return { content: `${scenario.title} 的提交工具未注册。` };
    }
    return {
      content: `好的，正在提交「${scenario.title}」…`,
      toolCalls: [
        {
          id: `call-${submission.scenario}-${Date.now()}`,
          name: scenario.toolName,
          parameters: { values: submission.values },
        },
      ],
    };
  }
}
