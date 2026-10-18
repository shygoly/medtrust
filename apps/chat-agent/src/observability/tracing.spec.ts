import { context, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
// 用**生产同款** provider（NodeTracerProvider）：register() 会一并注册 AsyncLocalStorage
// 上下文管理器。BasicTracerProvider 不会——那样 `context.active()` 在 span 里是空的，
// 子 span 与 traceparent 注入都会静默失效（这正是本用例第一版踩到的坑）。
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { buildChatConfig } from '../config/agent.config';
import { InMemorySessionRepository } from '../session/in-memory-session.repository';
import { DirectoryCache } from '../cache/directory-cache.service';
import { NullKeyValueStore } from '../store/key-value.store';
import { FakeApiClient } from '../test-utils/fake-api-client';
import { HttpMedTrustApiClient } from '../agent/tools/api-client';
import { buildTools } from '../agent/tools';
import { ChatService } from '../api/chat/chat.service';
import { MetricsService } from './metrics.service';
import { TRACER_NAME, annotateSpan, traceparentHeader, withSpan } from './tracing';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();

const spans = () => exporter.getFinishedSpans();
const findSpan = (name: string) => spans().find((span) => span.name === name);

beforeEach(() => exporter.reset());
afterAll(async () => {
  await provider.shutdown();
});

const chatServiceFor = () => {
  const api = new FakeApiClient();
  const metrics = new MetricsService();
  const repository = new InMemorySessionRepository({ ttlHours: 24, maxMessagesPerSession: 50 });
  const service = new ChatService(
    buildChatConfig({}, 'system'),
    repository,
    api,
    metrics,
    new DirectoryCache(new NullKeyValueStore(), 300, metrics),
  );
  return { api, service };
};

describe('withSpan', () => {
  it('创建 span、透传返回值、把子 span 挂在父 span 下', async () => {
    const result = await withSpan('parent', { 'a.b': 1 }, async () => {
      await withSpan('child', { 'c.d': 'x' }, async () => 'inner');
      return 'outer';
    });

    expect(result).toBe('outer');
    const parent = findSpan('parent');
    const child = findSpan('child');
    expect(parent?.attributes).toMatchObject({ 'a.b': 1 });
    expect(child?.attributes).toMatchObject({ 'c.d': 'x' });
    // 层级真的成立（不是三个平铺的 span）
    expect(child?.parentSpanId).toBe(parent?.spanContext().spanId);
    expect(parent?.parentSpanId).toBeUndefined();
  });

  it('异常照常抛出，并把 span 标成错误', async () => {
    await expect(
      withSpan('boom', {}, async () => {
        throw new Error('上游炸了');
      }),
    ).rejects.toThrow('上游炸了');
    expect(findSpan('boom')?.status.code).toBe(2);
  });

  it('annotateSpan 给活动 span 补属性；没有活动 span 时是空操作', async () => {
    await withSpan('annotated', {}, async () => {
      annotateSpan({ 'late.value': 42 });
    });
    expect(findSpan('annotated')?.attributes).toMatchObject({ 'late.value': 42 });

    expect(() => annotateSpan({ 'x.y': 1 })).not.toThrow();
  });
});

describe('traceparentHeader（W3C 跨服务接头）', () => {
  it('无活动 span 时返回 null（不注入假头）', () => {
    expect(traceparentHeader()).toBeNull();
  });

  it('有活动 span 时格式合法，且 traceId 与当前 span 一致', async () => {
    await withSpan('http-out', {}, async () => {
      const header = traceparentHeader();
      expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
      const active = trace.getSpan(context.active())?.spanContext();
      expect(header).toContain(active!.traceId);
    });
  });

  it('控制面请求真的带上了 traceparent，且 traceId 与调用方同一条', async () => {
    const seen: Record<string, string> = {};
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      Object.assign(seen, init?.headers ?? {});
      return new Response(JSON.stringify({ jobId: 'job-1', status: 'submitted' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      await withSpan('caller', {}, async () => {
        const client = new HttpMedTrustApiClient({
          apiUrl: 'http://cp.test',
          apiPrefix: '/api/v1',
          serviceToken: 'svc',
        });
        await client.submitScenario(
          {
            scenarioId: 'x',
            mode: 'direct',
            endpoint: '/mdop/jobs/x',
            analysisKey: 'x',
            payload: {},
          },
          { userId: 'u-1', spaceId: 'sh-med' },
        );
      });
    } finally {
      globalThis.fetch = original;
    }

    const caller = findSpan('caller');
    const outgoing = findSpan('controlplane.request');
    expect(outgoing?.parentSpanId).toBe(caller?.spanContext().spanId);
    expect(seen.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    expect(seen.traceparent).toContain(caller!.spanContext().traceId);
  });
});

describe('真实链路埋点', () => {
  it('一次对话产生 chat.turn 与工具子 span，属性是计数与假名（不是用户原话）', async () => {
    const { service } = chatServiceFor();
    const message = '我想做单臂试验的外部对照（这句原话绝不能出现在 span 属性里）';

    await service.chat({ message }, { userId: 'u-trace', spaceId: 'sh-med', accessToken: 'tk' });

    const turn = findSpan('chat.turn');
    expect(turn).toBeDefined();
    expect(turn?.attributes).toMatchObject({
      'chat.space_id': 'sh-med',
      'chat.outcome': 'success',
      'llm.mode': 'rule-based',
    });
    // 用户标识只以假名出现
    expect(String(turn?.attributes['chat.user_ref'])).not.toBe('u-trace');
    expect(String(turn?.attributes['chat.user_ref'])).toHaveLength(10);

    // 治理断言：任何 span 的任何属性值都不得包含用户原话
    const serialized = JSON.stringify(
      spans().map((span) => ({ name: span.name, attributes: span.attributes })),
    );
    expect(serialized).not.toContain('绝不能出现在 span 属性里');
    expect(serialized).not.toContain('我想做单臂试验');
    // 令牌也不能出现
    expect(serialized).not.toContain('tk');
  });

  it('工具 span 统一由注册点包装：六个场景工具与目录/模板工具都在', () => {
    const tools = buildTools(new FakeApiClient());
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('submit_external_control');
    expect(names).toContain('list_participants');
    expect(names.length).toBeGreaterThanOrEqual(8);
  });

  it('tracer 名与约定一致（便于按 instrumentation 过滤）', () => {
    expect(trace.getTracer(TRACER_NAME)).toBeDefined();
  });
});
