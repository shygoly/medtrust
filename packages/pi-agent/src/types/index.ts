/**
 * Core types for Pi Agent
 */

/**
 * Message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Message in conversation history
 */
export interface Message {
  role: MessageRole;
  content: string;
  name?: string;  // For tool messages
  toolCallId?: string;  // For tool result messages
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

/**
 * Agent response
 */
export interface AgentResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Tool execution context
 */
export interface ToolContext {
  userId: string;
  spaceId: string;
  sessionId: string;
  [key: string]: unknown;  // Allow custom context fields
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** 一次工具调用结束后的事件（供可观测性 / 流式推进使用）。 */
export interface AgentToolEvent {
  call: ToolCall;
  ok: boolean;
  durationMs: number;
  error?: string;
  /**
   * 工具返回体（成功时才有）。
   *
   * 观察者要按**结果里的判定**分类（如合规闸是 ready / needs_contract / needs_permission），
   * 光有 ok 布尔只能分出「成/败」两级，拦下来的原因就丢了；而让观察者自己去解析
   * 工具回灌给模型的文本，等于把渲染格式当成契约。
   */
  result?: ToolResult;
}

/**
 * 工具循环的观察钩子。
 *
 * 钩子 MUST NOT 影响主流程：钩子抛错由 PiAgent 吞掉（只记在返回结果里不影响），
 * 否则一个坏的监控点就能让对话失败。
 */
export interface AgentHooks {
  onToolStart?: (call: ToolCall) => void | Promise<void>;
  onToolEnd?: (event: AgentToolEvent) => void | Promise<void>;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  systemPrompt: string;
  maxTokens?: number;
  temperature?: number;
}
