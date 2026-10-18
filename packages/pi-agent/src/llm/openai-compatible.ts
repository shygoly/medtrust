import type { LLMClient, LLMMessage, LLMResponse } from './client';
import type { Tool } from '../tool';

/**
 * OpenAI 兼容客户端的配置。
 *
 * 用它接 DeepSeek（`https://api.deepseek.com`，/chat/completions）这类
 * "说 OpenAI 协议"的供应商，而不是每接一家写一个适配器。
 */
export interface OpenAiCompatibleConfig {
  apiKey: string;
  /** 不含 /chat/completions 的基址，例如 https://api.deepseek.com */
  baseUrl: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** 单次请求超时（毫秒）。外部供应商必须设上，否则工具循环会挂死。 */
  timeoutMs?: number;
}

/** 只声明我们用到的 fetch 形状：不依赖 DOM 类型，也方便测试打桩。 */
type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: unknown;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

/**
 * OpenAI 兼容 LLM 客户端（支持 function calling）。
 *
 * **关键实现点：assistant.tool_calls 必须回放。**
 * 我们的 agent 循环只把**工具结果**追加进消息（`{role:'tool', name: call.id}`），
 * 不会追加"请求工具的那条 assistant 消息"。Anthropic 协议容忍这种历史，
 * 但 OpenAI 协议要求 `role:'tool'` 消息必须紧跟在带 `tool_calls` 的 assistant 消息之后，
 * 否则直接报错。所以这里在构造请求时**重建**那条 assistant 消息：
 * 从上一轮响应里记住的 id → {name, arguments} 映射里取回原样（并发多个工具也会归到同一条）。
 */
export class OpenAiCompatibleClient implements LLMClient {
  private readonly config: Required<OpenAiCompatibleConfig>;
  /** tool call id → 原始调用，用于忠实回放 assistant.tool_calls */
  private readonly callsById = new Map<string, { name: string; arguments: string }>();

  constructor(config: OpenAiCompatibleConfig) {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) throw new Error('OpenAiCompatibleClient：baseUrl 不能为空');
    this.config = {
      apiKey: config.apiKey,
      baseUrl,
      model: config.model,
      maxTokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 1.0,
      timeoutMs: config.timeoutMs ?? 60_000,
    };
    if (!this.config.apiKey) throw new Error('OpenAiCompatibleClient：apiKey 不能为空');
  }

  async complete(messages: LLMMessage[], tools: Tool[]): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages: this.toOpenAiMessages(messages),
    };
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: tool.parameters.properties ?? {},
            required: tool.parameters.required ?? [],
          },
        },
      }));
      body.tool_choice = 'auto';
    }

    const text = await this.post(body);
    let parsed: {
      choices?: Array<{
        message?: {
          content?: unknown;
          tool_calls?: Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(`响应不是 JSON：${text.slice(0, 200)}`);
    }

    const choice = parsed.choices?.[0];
    if (!choice) throw new Error('响应里没有 choices');

    const message = choice.message ?? {};
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls = rawCalls.map((call) => {
      const id = String(call?.id ?? '');
      const name = String(call?.function?.name ?? '');
      const args = String(call?.function?.arguments ?? '{}');
      if (id) this.callsById.set(id, { name, arguments: args });
      return { id, name, parameters: this.parseArguments(args) };
    });

    return {
      content: typeof message.content === 'string' ? message.content : '',
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      usage: {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
      },
    };
  }

  private async post(body: Record<string, unknown>): Promise<string> {
    const doFetch = (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (typeof doFetch !== 'function') {
      throw new Error('当前运行时没有 fetch，无法调用 OpenAI 兼容接口（需要 Node 18+）');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await doFetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        // 只截断前 300 字符；错误体里可能带上游回显，不做全量透传
        throw new Error(`HTTP ${response.status}：${text.slice(0, 300)}`);
      }
      return text;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`请求超时（${this.config.timeoutMs}ms）`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private toOpenAiMessages(messages: LLMMessage[]): OpenAiMessage[] {
    const out: OpenAiMessage[] = [];
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];

      if (message.role === 'tool') {
        // 连续的工具结果同属一轮 assistant 决策：先补 assistant.tool_calls，再逐条补结果
        const group: LLMMessage[] = [];
        while (index < messages.length && messages[index].role === 'tool') {
          group.push(messages[index]);
          index += 1;
        }
        index -= 1;

        out.push({
          role: 'assistant',
          content: null,
          tool_calls: group.map((item) => {
            const id = item.name ?? '';
            const known = this.callsById.get(id);
            return {
              id,
              type: 'function' as const,
              function: {
                name: known?.name ?? 'unknown_tool',
                // 原样回放模型给的参数；取不到时给空对象（历史留痕，不影响后续推理）
                arguments: known?.arguments ?? '{}',
              },
            };
          }),
        });
        for (const item of group) {
          out.push({ role: 'tool', tool_call_id: item.name ?? '', content: item.content });
        }
        continue;
      }

      if (message.role === 'assistant') {
        out.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (message.role === 'system') {
        out.push({ role: 'system', content: message.content });
        continue;
      }
      out.push({ role: 'user', content: message.content });
    }
    return out;
  }

  private parseArguments(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw || '{}');
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      // 模型偶尔会给出坏 JSON：当成空参数，让工具层的参数校验去报错并回灌给模型
      return {};
    }
  }
}
