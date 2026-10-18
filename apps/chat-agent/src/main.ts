import './load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AGENT_CONFIG, type MedTrustChatConfig } from './config/agent.config';
import { setupApiDocs } from './api/docs/api-docs';
import { JsonLogger } from './observability/json.logger';
import { startTracing, tracingConfig } from './observability/tracing';

async function bootstrap(): Promise<void> {
  // bufferLogs：先把启动期日志缓冲住，等 JsonLogger 接管后再统一 flush，
  // 否则 Nest 初始化那几行会是默认格式（日志格式前后不一致 = 采集侧要多写一条解析规则）。
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix('api/v1');

  // 端口与 CORS 只有一个事实源：AGENT_CONFIG（由 readEnv 组装）。
  // 这里 MUST NOT 再写一份字面缺省——那正是"配置说 A、进程听 B"的来源。
  const config = app.get<MedTrustChatConfig>(AGENT_CONFIG);

  // 结构化日志（4.2.1）：JSON 一行一条，敏感字段经 redact 打码。启动即接管 Nest Logger。
  app.useLogger(new JsonLogger({ level: config.logLevel, format: config.logFormat }));
  app.flushLogs();
  app.enableCors({ origin: config.corsOrigins, credentials: true });

  // API 文档（4.5.3）：/api/docs（UI）与 /api/docs-json（OpenAPI）。
  // 路径不走全局前缀，避免出现 /api/v1/api/docs 这种叠字。
  if (config.swaggerEnabled) setupApiDocs(app);

  // 追踪（4.2.3）：默认关闭。开启时才懒加载 SDK——不追踪的部署不承担这套依赖的启动面。
  // 必须在开始服务请求之前注册，否则早期请求会落在 no-op tracer 上。
  if (config.otelEnabled) {
    const tracing = await startTracing(tracingConfig(config));
    new Logger('bootstrap').log(`tracing enabled（exporter=${tracing.exporter}）`);
    // 收到终止信号时先 flush 再退：BatchSpanProcessor 里还没导出的 span 不该随进程一起消失
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        void tracing.shutdown().finally(() => process.exit(0));
      });
    }
  }

  await app.listen(config.port);
  new Logger('bootstrap').log(
    `chat-agent listening on http://localhost:${config.port}/api/v1`,
  );
}

void bootstrap();
