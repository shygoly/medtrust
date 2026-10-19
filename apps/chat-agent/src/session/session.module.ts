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

        const { createPostgresSessionRepository } = await import(
          './postgres/create-postgres-repository'
        );
        return createPostgresSessionRepository({
          ...options,
          url: config.databaseUrl,
          synchronize: false,
        });
      },
    },
  ],
  exports: [SESSION_REPOSITORY],
})
export class SessionModule {}
