import { buildChatConfig } from '../config/agent.config';
import { InMemoryRateLimitStore } from '../common/rate-limit.store';
import { InMemorySessionRepository } from '../session/in-memory-session.repository';
import { NullKeyValueStore } from '../store/key-value.store';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const config = buildChatConfig({}, 'system');
  const sessions = new InMemorySessionRepository({ ttlHours: 24, maxMessagesPerSession: 10 });
  const controller = new HealthController(
    config,
    sessions,
    new NullKeyValueStore(),
    new InMemoryRateLimitStore(),
  );

  it('存活探针：报告服务名与版本', () => {
    const live = controller.live();
    expect(live).toMatchObject({ status: 'ok', service: 'chat-agent', version: '0.1.0' });
    expect(typeof live.uptimeSeconds).toBe('number');
  });

  it('就绪探针：如实报告 LLM 模式 / API 地址 / 会话存储驱动', async () => {
    const ready = await controller.ready();
    expect(ready.status).toBe('ready');
    expect(ready.checks).toMatchObject({
      config: 'ok',
      llm: 'rule-based',
      apiUrl: 'http://localhost:5021',
      sessionStore: 'memory',
      // 如实报告：没配 Redis 就是 disabled/每实例，不说成"已连数据库"
      keyValueStore: 'disabled',
      rateLimitStore: 'memory',
    });
  });

  it('配了 Redis 时报告 redis（就绪探针要能回答"配额是不是共享的"）', async () => {
    const redis = new HealthController(
      buildChatConfig({ REDIS_URL: 'redis://localhost:6379' }, 'system'),
      sessions,
      { kind: 'redis' } as never,
      { kind: 'redis' } as never,
    );
    const ready = await redis.ready();
    expect(ready.checks).toMatchObject({ keyValueStore: 'redis', rateLimitStore: 'redis' });
  });
});
