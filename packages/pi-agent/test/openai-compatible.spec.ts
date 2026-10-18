import { OpenAiCompatibleClient } from '../src/llm/openai-compatible';
import type { LLMMessage } from '../src/llm/client';
import type { Tool } from '../src/tool';

const tools: Tool[] = [
  {
    name: 'submit_external_control',
    description: '提交外部对照作业',
    parameters: {
      type: 'object',
      properties: { values: { type: 'object', description: '表单值' } },
      required: ['values'],
    } as never,
    execute: async () => ({ success: true }),
  },
];

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** 打桩 fetch：返回给定 JSON，并记录请求。 */
function stubFetch(response: {
  status?: number;
  json?: unknown;
  text?: string;
  failWith?: Error;
  delayMs?: number;
}): { calls: Captured[] } {
  const calls: Captured[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string,
    init: { headers: Record<string, string>; body: string; signal?: unknown },
  ) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (response.failWith) {
      if (response.delayMs) {
        // 模拟超时：等 abort 信号
        await new Promise((_resolve, reject) => {
          const signal = init.signal as { addEventListener?: (t: string, cb: () => void) => void };
          signal?.addEventListener?.('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
      throw response.failWith;
    }
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      text: async () => response.text ?? JSON.stringify(response.json ?? {}),
    };
  };
  return { calls };
}

const client = (over: Partial<ConstructorParameters<typeof OpenAiCompatibleClient>[0]> = {}) =>
  new OpenAiCompatibleClient({
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com/',
    model: 'deepseek-flash',
    ...over,
  });

describe('OpenAiCompatibleClient（DeepSeek 等 OpenAI 兼容供应商）', () => {
  afterEach(() => {
    delete (globalThis as unknown as { fetch?: unknown }).fetch;
  });

  it('请求体：模型、工具按 function 格式映射、tool_choice=auto、Bearer 鉴权', async () => {
    const { calls } = stubFetch({
      json: { choices: [{ message: { content: '你好' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } },
    });

    const result = await client().complete(
      [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      tools,
    );

    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions'); // 结尾斜杠被归一
    expect(calls[0].headers.authorization).toBe('Bearer sk-test');
    expect(calls[0].body).toMatchObject({ model: 'deepseek-flash', tool_choice: 'auto' });
    expect((calls[0].body.tools as unknown[])[0]).toEqual({
      type: 'function',
      function: {
        name: 'submit_external_control',
        description: '提交外部对照作业',
        parameters: { type: 'object', properties: { values: { type: 'object', description: '表单值' } }, required: ['values'] },
      },
    });
    expect(result.content).toBe('你好');
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(result.toolCalls).toBeUndefined();
  });

  it('解析 tool_calls 并把 arguments 解成对象', async () => {
    stubFetch({
      json: {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'call_1', function: { name: 'submit_external_control', arguments: '{"values":{"trial":"p-a"}}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      },
    });

    const result = await client().complete([{ role: 'user', content: 'go' }], tools);
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'submit_external_control', parameters: { values: { trial: 'p-a' } } },
    ]);
  });

  it('**回放 assistant.tool_calls**：tool 结果前必须补出带 tool_calls 的 assistant 消息', async () => {
    const { calls } = stubFetch({ json: { choices: [{ message: { content: 'ok' } }] } });
    const c = client();

    // 第一轮：模型要调工具
    stubFetch({
      json: {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'call_1', function: { name: 'submit_external_control', arguments: '{"values":{}}' } },
              ],
            },
          },
        ],
      },
    });
    await c.complete([{ role: 'user', content: 'go' }], tools);

    // 第二轮：agent 循环只追加了 tool 结果（name 里存的是 call id）
    const history: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
      { role: 'tool', name: 'call_1', content: '{"success":true}' },
    ];
    const { calls: second } = stubFetch({ json: { choices: [{ message: { content: 'ok' } }] } });
    await c.complete(history, tools);
    void calls;

    const sent = second[0].body.messages as Array<Record<string, unknown>>;
    // 顺序：system → user → assistant(tool_calls) → tool
    expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(sent[2].tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'submit_external_control', arguments: '{"values":{}}' },
      },
    ]);
    expect(sent[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_1', content: '{"success":true}' });
  });

  it('并发工具调用：多条 tool 结果归到同一条 assistant 消息下', async () => {
    const c = client();
    stubFetch({
      json: {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'call_a', function: { name: 'tool_a', arguments: '{}' } },
                { id: 'call_b', function: { name: 'tool_b', arguments: '{}' } },
              ],
            },
          },
        ],
      },
    });
    await c.complete([{ role: 'user', content: 'go' }], tools);

    const { calls } = stubFetch({ json: { choices: [{ message: { content: 'ok' } }] } });
    await c.complete(
      [
        { role: 'user', content: 'go' },
        { role: 'tool', name: 'call_a', content: 'A' },
        { role: 'tool', name: 'call_b', content: 'B' },
      ],
      tools,
    );

    const sent = calls[0].body.messages as Array<Record<string, unknown>>;
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
    expect((sent[1].tool_calls as unknown[]).length).toBe(2);
    expect((sent[2] as Record<string, unknown>).content).toBe('A');
    expect((sent[3] as Record<string, unknown>).content).toBe('B');
  });

  it('非 2xx：抛错并带上状态码与截断后的响应体', async () => {
    stubFetch({ status: 401, text: '{"error":{"message":"Authentication Fails"}}' });
    await expect(client().complete([{ role: 'user', content: 'hi' }], tools)).rejects.toThrow(
      /HTTP 401.*Authentication Fails/s,
    );
  });

  it('超时：映射成可读的超时错误（不是裸 AbortError）', async () => {
    stubFetch({ failWith: new Error('aborted'), delayMs: 50 });
    await expect(
      client({ timeoutMs: 20 }).complete([{ role: 'user', content: 'hi' }], tools),
    ).rejects.toThrow(/请求超时（20ms）/);
  });

  it('工具参数是坏 JSON 时给空对象（交给工具层参数校验去报错）', async () => {
    stubFetch({
      json: {
        choices: [
          { message: { content: '', tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{坏' } }] } },
        ],
      },
    });
    const result = await client().complete([{ role: 'user', content: 'go' }], tools);
    expect(result.toolCalls?.[0].parameters).toEqual({});
  });

  it('构造与运行时校验：空 baseUrl / 空 key / 无 fetch 都要给出明确错误', async () => {
    expect(() => client({ baseUrl: '  ' })).toThrow(/baseUrl/);
    expect(() => client({ apiKey: '' })).toThrow(/apiKey/);

    delete (globalThis as unknown as { fetch?: unknown }).fetch;
    await expect(client().complete([{ role: 'user', content: 'hi' }], [])).rejects.toThrow(/没有 fetch/);
  });

  it('无工具时不下发 tools 字段（不是空数组）', async () => {
    const { calls } = stubFetch({ json: { choices: [{ message: { content: 'ok' } }] } });
    await client().complete([{ role: 'user', content: 'hi' }], []);
    expect(calls[0].body.tools).toBeUndefined();
    expect(calls[0].body.tool_choice).toBeUndefined();
  });
});
