import { context, trace, type Span, type SpanOptions } from '@opentelemetry/api';
import type { MedTrustChatConfig } from '../config/agent.config';

/**
 * 分布式追踪（4.2.3）。
 *
 * 两条纪律：
 *
 * 1. **库代码只依赖 `@opentelemetry/api`**。没有注册 SDK 时所有 API 都是 no-op，
 *    零开销、零配置——不该为了"可能要看 trace"就给每个部署加载一套 SDK。
 *    SDK（NodeTracerProvider + 导出器）由 `startTracing()` 在 **OTEL_ENABLED=true** 时懒加载。
 *
 * 2. **span 属性里不放用户内容**。只放工具名、场景、路径、状态、计数与假名化的用户标识。
 *    用户原话、卡片取值、令牌一律不进属性——trace 后端往往比日志保留更久、权限更松，
 *    往那里复制一份用户原话等于给自己开第二条数据出口。
 */
export const TRACER_NAME = 'medtrust-chat-agent';

export interface TracingHandle {
  shutdown: () => Promise<void>;
  /** 便于测试断言：当前注册的 tracer provider 类型 */
  exporter: 'otlp' | 'console';
}

/** 每次都现取 tracer：SDK 可能在进程启动后才注册，缓存会拿到 no-op tracer。 */
function tracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * 在一个 span 里跑一段异步逻辑。没有注册 SDK 时它就是一个直通的包装（不产生任何开销）。
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  run: (span: Span | undefined) => Promise<T>,
  options: SpanOptions = {},
): Promise<T> {
  const t = tracer();
  return t.startActiveSpan(name, { ...options, attributes }, async (span) => {
    try {
      const result = await run(span);
      span.setStatus({ code: 1 }); // SpanStatusCode.OK
      return result;
    } catch (error) {
      // 只记错误类型，不记原始 message（它可能带上游返回的原文）
      span.setStatus({ code: 2, message: error instanceof Error ? error.name : 'Error' });
      span.recordException(error instanceof Error ? error : new Error('unknown'));
      throw error;
    } finally {
      span.end();
    }
  });
}

/** 给当前 span 补属性（计数/结果这类跑完才知道的值）。无活动 span 时是空操作。 */
export function annotateSpan(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getSpan(context.active());
  if (!span) return;
  for (const [key, value] of Object.entries(attributes)) span.setAttribute(key, value);
}

/**
 * 当前 span 的 W3C `traceparent` 头（跨服务追踪的接头）。
 *
 * 不用 `@opentelemetry/core` 的 propagator：格式就这一行，自己拼比多引一个包更容易审计。
 * 没有活动 span（未启用追踪）时返回 null —— 不注入假头。
 */
export function traceparentHeader(): string | null {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (!spanContext || !spanContext.traceId) return null;
  const flags = (spanContext.traceFlags ?? 0).toString(16).padStart(2, '0');
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

export interface StartTracingOptions {
  serviceName: string;
  exporter: 'otlp' | 'console';
  endpoint?: string;
}

/**
 * 启用追踪（**只在 OTEL_ENABLED=true 时调用**）。
 *
 * 支持两个导出器：`otlp`（生产，指向 collector）与 `console`（本地肉眼验证）。
 * SDK 通过动态 import 加载：不启用追踪的部署不会因为这几个包而增加启动面。
 */
export async function startTracing(options: StartTracingOptions): Promise<TracingHandle> {
  const [{ NodeTracerProvider }, { BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter }] =
    await Promise.all([
      import('@opentelemetry/sdk-trace-node'),
      import('@opentelemetry/sdk-trace-base'),
    ]);

  const processor =
    options.exporter === 'console'
      ? new SimpleSpanProcessor(new ConsoleSpanExporter())
      : new BatchSpanProcessor(
          // 动态 import 的另一半：OTLP 导出器只在真的要用时才加载
          await (async () => {
            const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
            return new OTLPTraceExporter(
              options.endpoint ? { url: options.endpoint } : undefined,
            );
          })(),
        );

  // 不自己拼 Resource：SDK 的默认 Resource 会读 OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES，
  // 把服务名交给标准环境变量=少一处需要跟部署文档对拍的代码。
  if (!process.env.OTEL_SERVICE_NAME) process.env.OTEL_SERVICE_NAME = options.serviceName;
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();

  return {
    exporter: options.exporter,
    shutdown: async () => {
      await provider.shutdown();
    },
  };
}

export function tracingConfig(config: MedTrustChatConfig): StartTracingOptions {
  return {
    serviceName: config.otelServiceName,
    exporter: config.otelExporter,
    ...(config.otelEndpoint ? { endpoint: config.otelEndpoint } : {}),
  };
}
