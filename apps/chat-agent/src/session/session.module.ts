import { Module } from '@nestjs/common';
import { AGENT_CONFIG, type MedTrustChatConfig } from '../config/agent.config';
import { InMemorySessionRepository } from './in-memory-session.repository';
import { SESSION_REPOSITORY, type SessionRepository } from './session.types';

const MAX_MESSAGES_PER_SESSION = 200;

@Module({
  providers: [
    {
      provide: SESSION_REPOSITORY,
      inject: [AGENT_CONFIG],
      useFactory: async (config: MedTrustChatConfig): Promise<SessionRepository> => {
        const options = {
          ttlHours: config.sessionTtlHours,
          maxMessagesPerSession: MAX_MESSAGES_PER_SESSION,
        };

        if (config.dbDriver === 'memory') {
          return new InMemorySessionRepository(options);
        }

        // 动态导入：sqlite 驱动依赖 better-sqlite3（原生模块），
        // 未选用时不得因它加载失败而拖垮进程启动。
        const { createSqliteSessionRepository } = await import('./sqlite/create-sqlite-repository');
        return createSqliteSessionRepository({
          ...options,
          database: config.dbPath,
          synchronize: true,
        });
      },
    },
  ],
  exports: [SESSION_REPOSITORY],
})
export class SessionModule {}
