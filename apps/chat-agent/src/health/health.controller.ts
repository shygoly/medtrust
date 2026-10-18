import { Controller, Get, Inject } from '@nestjs/common';
import { AGENT_CONFIG, type MedTrustChatConfig } from '../config/agent.config';
import { SESSION_REPOSITORY, type SessionRepository } from '../session/session.types';
import { KEY_VALUE_STORE, type KeyValueStore } from '../store/key-value.store';
import { RATE_LIMIT_STORE, type RateLimitStore } from '../common/rate-limit.store';

/**
 * 探针。就绪信息**如实报告实现细节**：会话存在哪、限流是每实例还是共享、
 * 缓存开没开。排查"为什么重启后会话没了""为什么多实例下配额不对"时，这几行就是答案。
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(AGENT_CONFIG) private readonly config: MedTrustChatConfig,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    @Inject(RATE_LIMIT_STORE) private readonly rateLimit: RateLimitStore,
  ) {}

  @Get()
  live() {
    return {
      status: 'ok',
      service: 'chat-agent',
      version: '0.1.0',
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  @Get('ready')
  async ready() {
    const sessions = await this.sessions.list('__readiness_probe__');
    return {
      status: 'ready',
      checks: {
        config: 'ok',
        llm: this.config.llmMode,
        llmModel: this.config.llmModelEffective,
        apiUrl: this.config.apiUrl,
        sessionStore: sessions.length >= 0 ? this.sessions.kind : 'degraded',
        keyValueStore: this.store.kind,
        rateLimitStore: this.rateLimit.kind,
        directoryCacheTtlSeconds: this.config.directoryCacheTtlSeconds,
      },
    };
  }
}
