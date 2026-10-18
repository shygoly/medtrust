import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { SessionModule } from './session/session.module';
import { ChatModule } from './api/chat/chat.module';
import { ObservabilityModule } from './observability/observability.module';
import { StoreModule } from './store/store.module';

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    StoreModule,
    HealthModule,
    SessionModule,
    ChatModule,
  ],
})
export class AppModule {}
