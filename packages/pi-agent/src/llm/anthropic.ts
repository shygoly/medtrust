import Anthropic from '@anthropic-ai/sdk';
import type { LLMClient, LLMMessage, LLMResponse } from './client';
import type { Tool } from '../tool';

/**
 * Anthropic client configuration
 */
export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Anthropic LLM client implementation
 */
export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private config: Required<AnthropicConfig>;

  constructor(config: AnthropicConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'claude-3-5-sonnet-20241022',
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 1.0
    };
  }

  async complete(messages: LLMMessage[], tools: Tool[]): Promise<LLMResponse> {
    // Extract system message
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Convert to Anthropic format
    const anthropicMessages = conversationMessages.map(msg => {
      if (msg.role === 'tool') {
        return {
          role: 'user' as const,
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: msg.name || 'unknown',
              content: msg.content
            }
          ]
        };
      }

      return {
        role: msg.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: msg.content
      };
    });

    // Convert tools to Anthropic format
    const anthropicTools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: tool.parameters.properties,
        required: tool.parameters.required
      }
    }));

    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system: systemMessage?.content,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined
      });

      // Extract content
      const textContent = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      // Extract tool calls
      const toolCalls = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map(block => ({
          id: block.id,
          name: block.name,
          parameters: block.input as Record<string, unknown>
        }));

      return {
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
        }
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Anthropic API error: ${error.message}`);
      }
      throw error;
    }
  }
}
