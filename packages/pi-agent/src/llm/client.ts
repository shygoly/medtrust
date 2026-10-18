import type { ToolCall } from '../types/index';
import type { Tool } from '../tool';

/**
 * LLM message format (internal)
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

/**
 * LLM response format
 */
export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * LLM client interface
 */
export interface LLMClient {
  /**
   * Complete a chat conversation
   * @param messages Conversation messages
   * @param tools Available tools
   * @returns LLM response
   */
  complete(messages: LLMMessage[], tools: Tool[]): Promise<LLMResponse>;
}
