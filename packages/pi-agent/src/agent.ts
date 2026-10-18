import type {
  Message,
  AgentResponse,
  AgentConfig,
  ToolContext,
  AgentHooks,
  AgentToolEvent,
} from './types/index';
import type { Tool } from './tool';
import { validateToolParameters } from './tool';
import type { LLMClient, LLMMessage } from './llm/client';

/**
 * Pi Agent - Lightweight agent runtime
 */
export class PiAgent {
  private config: AgentConfig;
  private tools: Map<string, Tool>;
  private llm: LLMClient;
  private context: ToolContext | null = null;
  private hooks: AgentHooks = {};

  constructor(config: AgentConfig, tools: Tool[], llm: LLMClient) {
    this.config = config;
    this.tools = new Map(tools.map(tool => [tool.name, tool]));
    this.llm = llm;
  }

  /**
   * Set tool execution context
   */
  setContext(context: ToolContext): void {
    this.context = context;
  }

  /**
   * 注册工具循环钩子（可观测性 / 流式推进）。钩子不影响主流程。
   */
  setHooks(hooks: AgentHooks): void {
    this.hooks = hooks;
  }

  /**
   * Process a user message and return agent response
   * @param userMessage User's message
   * @param history Conversation history
   * @returns Agent response
   */
  async chat(userMessage: string, history: Message[] = []): Promise<AgentResponse> {
    if (!this.context) {
      throw new Error('Context must be set before calling chat');
    }

    // Build messages for LLM
    const messages = this.buildMessages(userMessage, history);

    // Initial LLM call
    let response = await this.llm.complete(messages, Array.from(this.tools.values()));

    // Tool call loop
    const maxIterations = 10;
    let iteration = 0;

    while (response.toolCalls && response.toolCalls.length > 0 && iteration < maxIterations) {
      iteration++;

      // Execute tools
      const toolResults = await this.executeTools(response.toolCalls);

      // Add tool results to messages
      for (const result of toolResults) {
        messages.push(result);
      }

      // Call LLM again with tool results
      response = await this.llm.complete(messages, Array.from(this.tools.values()));
    }

    if (iteration >= maxIterations) {
      throw new Error('Max tool call iterations exceeded');
    }

    return {
      content: response.content,
      toolCalls: response.toolCalls,
      usage: response.usage
    };
  }

  /**
   * Build LLM messages from user input and history
   */
  private buildMessages(userMessage: string, history: Message[]): LLMMessage[] {
    const messages: LLMMessage[] = [
      { role: 'system', content: this.config.systemPrompt }
    ];

    // Add history
    for (const msg of history) {
      messages.push({
        role: msg.role,
        content: msg.content,
        name: msg.name
      });
    }

    // Add user message
    messages.push({
      role: 'user',
      content: userMessage
    });

    return messages;
  }

  /**
   * Execute tool calls and return results
   */
  private async executeTools(toolCalls: Array<{ id: string; name: string; parameters: Record<string, unknown> }>): Promise<LLMMessage[]> {
    const results = await Promise.all(
      toolCalls.map(call => this.executeTool(call))
    );

    return results;
  }

  /**
   * Execute a single tool call
   */
  /** 钩子抛错 MUST NOT 影响主流程。 */
  private async runHook(run: () => void | Promise<void>): Promise<void> {
    try {
      await run();
    } catch {
      // 观察者的问题不是对话的问题：忽略。
    }
  }

  private async notifyToolStart(call: { id: string; name: string; parameters: Record<string, unknown> }): Promise<void> {
    if (!this.hooks.onToolStart) return;
    await this.runHook(() => this.hooks.onToolStart!(call));
  }

  private async notifyToolEnd(event: AgentToolEvent): Promise<void> {
    if (!this.hooks.onToolEnd) return;
    await this.runHook(() => this.hooks.onToolEnd!(event));
  }

  private async executeTool(call: { id: string; name: string; parameters: Record<string, unknown> }): Promise<LLMMessage> {
    const startedAt = Date.now();
    await this.notifyToolStart(call);

    const tool = this.tools.get(call.name);

    if (!tool) {
      const error = `Tool ${call.name} not found`;
      await this.notifyToolEnd({
        call,
        ok: false,
        durationMs: Date.now() - startedAt,
        error,
      });
      return {
        role: 'tool',
        name: call.id,
        content: JSON.stringify({ success: false, error })
      };
    }

    // Validate parameters
    const validationErrors = validateToolParameters(call.parameters, tool.parameters);
    if (validationErrors.length > 0) {
      const error = `Parameter validation failed: ${validationErrors.join(', ')}`;
      await this.notifyToolEnd({
        call,
        ok: false,
        durationMs: Date.now() - startedAt,
        error,
      });
      return {
        role: 'tool',
        name: call.id,
        content: JSON.stringify({ success: false, error })
      };
    }

    // Execute tool
    try {
      const result = await tool.execute(call.parameters, this.context!);
      await this.notifyToolEnd({
        call,
        ok: result.success !== false,
        durationMs: Date.now() - startedAt,
        result,
      });
      return {
        role: 'tool',
        name: call.id,
        content: JSON.stringify(result)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.notifyToolEnd({
        call,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return {
        role: 'tool',
        name: call.id,
        content: JSON.stringify({ success: false, error: message })
      };
    }
  }
}
