import { PiAgent } from '../src/agent';
import type { Tool, ToolContext, ToolResult } from '../src';
import type { LLMClient, LLMMessage, LLMResponse } from '../src/llm/client';

// Mock LLM Client
class MockLLMClient implements LLMClient {
  private responses: LLMResponse[];
  private callCount = 0;

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
  }

  async complete(_messages: LLMMessage[], _tools: Tool[]): Promise<LLMResponse> {
    const response = this.responses[this.callCount] || this.responses[this.responses.length - 1];
    this.callCount++;
    return response;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// Mock Tool
const mockTool: Tool = {
  name: 'test_tool',
  description: 'A test tool',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Test message'
      }
    },
    required: ['message']
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { message } = params as { message: string };
    return {
      success: true,
      data: { echo: message, userId: context.userId }
    };
  }
};

describe('PiAgent', () => {
  describe('Basic chat', () => {
    it('should process a simple user message', async () => {
      const mockLLM = new MockLLMClient([
        {
          content: 'Hello! How can I help you?',
          usage: { inputTokens: 10, outputTokens: 8 }
        }
      ]);

      const agent = new PiAgent(
        { systemPrompt: 'You are a helpful assistant.' },
        [],
        mockLLM
      );

      agent.setContext({
        userId: 'user-123',
        spaceId: 'space-456',
        sessionId: 'session-789'
      });

      const response = await agent.chat('Hello');

      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 8 });
      expect(mockLLM.getCallCount()).toBe(1);
    });

    it('should throw error if context not set', async () => {
      const mockLLM = new MockLLMClient([
        { content: 'Test', usage: { inputTokens: 10, outputTokens: 5 } }
      ]);

      const agent = new PiAgent(
        { systemPrompt: 'Test' },
        [],
        mockLLM
      );

      await expect(agent.chat('Hello')).rejects.toThrow('Context must be set');
    });
  });

  describe('Tool execution', () => {
    it('should execute tool and return result', async () => {
      const mockLLM = new MockLLMClient([
        // First response: tool call
        {
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'test_tool',
              parameters: { message: 'test' }
            }
          ],
          usage: { inputTokens: 50, outputTokens: 20 }
        },
        // Second response: final answer
        {
          content: 'Tool executed successfully',
          usage: { inputTokens: 70, outputTokens: 10 }
        }
      ]);

      const agent = new PiAgent(
        { systemPrompt: 'You are a helpful assistant.' },
        [mockTool],
        mockLLM
      );

      agent.setContext({
        userId: 'user-123',
        spaceId: 'space-456',
        sessionId: 'session-789'
      });

      const response = await agent.chat('Execute test tool');

      expect(response.content).toBe('Tool executed successfully');
      expect(mockLLM.getCallCount()).toBe(2);
    });

    it('should handle tool not found', async () => {
      const mockLLM = new MockLLMClient([
        {
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'nonexistent_tool',
              parameters: {}
            }
          ],
          usage: { inputTokens: 50, outputTokens: 20 }
        },
        {
          content: 'Sorry, that tool is not available',
          usage: { inputTokens: 70, outputTokens: 10 }
        }
      ]);

      const agent = new PiAgent(
        { systemPrompt: 'Test' },
        [mockTool],
        mockLLM
      );

      agent.setContext({
        userId: 'user-123',
        spaceId: 'space-456',
        sessionId: 'session-789'
      });

      const response = await agent.chat('Use nonexistent tool');

      expect(response.content).toBe('Sorry, that tool is not available');
      expect(mockLLM.getCallCount()).toBe(2);
    });

    it('should handle tool parameter validation error', async () => {
      const mockLLM = new MockLLMClient([
        {
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'test_tool',
              parameters: {} // Missing required 'message'
            }
          ],
          usage: { inputTokens: 50, outputTokens: 20 }
        },
        {
          content: 'Invalid parameters provided',
          usage: { inputTokens: 70, outputTokens: 10 }
        }
      ]);

      const agent = new PiAgent(
        { systemPrompt: 'Test' },
        [mockTool],
        mockLLM
      );

      agent.setContext({
        userId: 'user-123',
        spaceId: 'space-456',
        sessionId: 'session-789'
      });

      const response = await agent.chat('Execute tool with invalid params');

      expect(response.content).toBe('Invalid parameters provided');
      expect(mockLLM.getCallCount()).toBe(2);
    });

    it('should handle tool execution error', async () => {
      const failingTool: Tool = {
        name: 'failing_tool',
        description: 'A tool that fails',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        },
        execute: async () => {
          throw new Error('Tool execution failed');
        }
      };

      const mockLLM = new MockLLMClient([
        {
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'failing_tool',
              parameters: {}
            }
          ],
          usage: { inputTokens: 50, outputTokens: 20 }
        },
        {
          content: 'The tool encountered an error',
          usage: { inputTokens: 70, outputTokens: 10 }
        }
      ]);

      const agent = new PiAgent(
        { systemPrompt: 'Test' },
        [failingTool],
        mockLLM
      );

      agent.setContext({
        userId: 'user-123',
        spaceId: 'space-456',
        sessionId: 'session-789'
      });

      const response = await agent.chat('Execute failing tool');

      expect(response.content).toBe('The tool encountered an error');
      expect(mockLLM.getCallCount()).toBe(2);
    });
  });

  describe('Conversation history', () => {
    it('should include conversation history in messages', async () => {
      const mockLLM = new MockLLMClient([
        {
          content: 'I remember you asked about weather',
          usage: { inputTokens: 100, outputTokens: 10 }
        }
      ]);

      const agent = new PiAgent(
        { systemPrompt: 'You are a helpful assistant.' },
        [],
        mockLLM
      );

      agent.setContext({
        userId: 'user-123',
        spaceId: 'space-456',
        sessionId: 'session-789'
      });

      const history = [
        { role: 'user' as const, content: 'What is the weather?' },
        { role: 'assistant' as const, content: 'The weather is sunny.' }
      ];

      const response = await agent.chat('What did I ask about?', history);

      expect(response.content).toBe('I remember you asked about weather');
      expect(mockLLM.getCallCount()).toBe(1);
    });
  });

  describe('Max iterations', () => {
    it('should throw error if max tool call iterations exceeded', async () => {
      const mockLLM = new MockLLMClient([
        {
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'test_tool',
              parameters: { message: 'test' }
            }
          ],
          usage: { inputTokens: 50, outputTokens: 20 }
        }
      ]);

      const agent = new PiAgent(
        { systemPrompt: 'Test' },
        [mockTool],
        mockLLM
      );

      agent.setContext({
        userId: 'user-123',
        spaceId: 'space-456',
        sessionId: 'session-789'
      });

      await expect(agent.chat('Test')).rejects.toThrow('Max tool call iterations exceeded');
    });
  });
});

describe('PiAgent · 工具循环钩子', () => {
  const makeRecordingTool = (name: string, log: string[], gate?: Promise<void>): Tool => ({
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async (): Promise<ToolResult> => {
      log.push(`${name}:start`);
      if (gate) await gate;
      log.push(`${name}:end`);
      return { success: true, data: { tool: name } };
    },
  });

  const ctx: ToolContext = { userId: 'u', spaceId: 's', sessionId: 'sess' };

  it('onToolStart / onToolEnd 收到调用与结果（含耗时与成败）', async () => {
    const log: string[] = [];
    const llm = new MockLLMClient([
      { content: '', toolCalls: [{ id: 'c1', name: 't1', parameters: {} }] },
      { content: 'done' },
    ]);
    const agent = new PiAgent({ systemPrompt: 'x' }, [makeRecordingTool('t1', log)], llm);

    const starts: string[] = [];
    const ends: Array<{ name: string; ok: boolean; hasDuration: boolean }> = [];
    agent.setHooks({
      onToolStart: (call) => {
        starts.push(call.name);
      },
      onToolEnd: (event) => {
        ends.push({ name: event.call.name, ok: event.ok, hasDuration: Number.isFinite(event.durationMs) });
      },
    });
    agent.setContext(ctx);

    await agent.chat('go');

    expect(starts).toEqual(['t1']);
    expect(ends).toEqual([{ name: 't1', ok: true, hasDuration: true }]);
  });

  it('工具返回 success:false 时事件 ok=false（不误报成功）', async () => {
    const failing: Tool = {
      name: 'bad',
      description: 'bad',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ success: false, error: '拒绝了' }),
    };
    const llm = new MockLLMClient([
      { content: '', toolCalls: [{ id: 'c1', name: 'bad', parameters: {} }] },
      { content: 'done' },
    ]);
    const agent = new PiAgent({ systemPrompt: 'x' }, [failing], llm);
    const events: boolean[] = [];
    agent.setHooks({
      onToolEnd: (event) => {
        events.push(event.ok);
      },
    });
    agent.setContext(ctx);

    await agent.chat('go');
    expect(events).toEqual([false]);
  });

  it('onToolEnd 带回工具结果体（观察者可直接按结果里的判定分类，不必解析文本）', async () => {
    const verdictTool: Tool = {
      name: 'verdict',
      description: 'verdict',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({
        success: false,
        error: '没有合约',
        data: { compliance: { status: 'needs_contract', fix: 'request_contract' } },
      }),
    };
    const llm = new MockLLMClient([
      { content: '', toolCalls: [{ id: 'c1', name: 'verdict', parameters: {} }] },
      { content: 'done' },
    ]);
    const agent = new PiAgent({ systemPrompt: 'x' }, [verdictTool], llm);
    const seen: Array<unknown> = [];
    agent.setHooks({
      onToolEnd: (event) => {
        seen.push((event.result?.data as { compliance?: { status?: string } })?.compliance?.status);
      },
    });
    agent.setContext(ctx);

    await agent.chat('go');

    expect(seen).toEqual(['needs_contract']);
  });

  it('钩子抛错不影响对话（观察者不是主流程）', async () => {
    const log: string[] = [];
    const llm = new MockLLMClient([
      { content: '', toolCalls: [{ id: 'c1', name: 't1', parameters: {} }] },
      { content: 'done' },
    ]);
    const agent = new PiAgent({ systemPrompt: 'x' }, [makeRecordingTool('t1', log)], llm);
    agent.setHooks({
      onToolStart: () => {
        throw new Error('observer exploded');
      },
      onToolEnd: () => {
        throw new Error('observer exploded');
      },
    });
    agent.setContext(ctx);

    const response = await agent.chat('go');
    expect(response.content).toBe('done');
    expect(log).toEqual(['t1:start', 't1:end']);
  });

  it('同一轮多个工具调用并发执行（都先 start，再 end）', async () => {
    const log: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tools = [makeRecordingTool('a', log, gate), makeRecordingTool('b', log, gate)];
    const llm = new MockLLMClient([
      {
        content: '',
        toolCalls: [
          { id: '1', name: 'a', parameters: {} },
          { id: '2', name: 'b', parameters: {} },
        ],
      },
      { content: 'done' },
    ]);
    const agent = new PiAgent({ systemPrompt: 'x' }, tools, llm);
    agent.setContext(ctx);

    const pending = agent.chat('go');
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 两个都已开始（说明是并发，不是串行等第一个完成）
    expect(log).toEqual(['a:start', 'b:start']);

    release();
    await pending;
    expect([...log].sort()).toEqual(['a:end', 'a:start', 'b:end', 'b:start']);
  });
});
