import { Module } from '@nestjs/common';
import { AGENT_CONFIG, type MedTrustChatConfig } from '../../config/agent.config';
import { HttpMedTrustApiClient, MEDTRUST_API_CLIENT } from '../../agent/tools/api-client';
import { DirectoryCache, DIRECTORY_CACHE_TTL } from '../../cache/directory-cache.service';
import { SessionModule } from '../../session/session.module';
import { RateLimitGuard } from '../../common/rate-limit.guard';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [SessionModule],
  controllers: [ChatController],
  providers: [
    RateLimitGuard,
    DirectoryCache,
    {
      provide: DIRECTORY_CACHE_TTL,
      inject: [AGENT_CONFIG],
      useFactory: (config: MedTrustChatConfig) => config.directoryCacheTtlSeconds,
    },
    {
      provide: MEDTRUST_API_CLIENT,
      inject: [AGENT_CONFIG],
      useFactory: (config: MedTrustChatConfig) =>
        new HttpMedTrustApiClient({
          apiUrl: config.apiUrl,
          apiPrefix: config.apiPrefix,
          serviceToken: config.serviceToken,
        }),
    },
    ChatService,
  ],
})
export class ChatModule {}
