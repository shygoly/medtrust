import { Global, Module } from '@nestjs/common';
import { AGENT_CONFIG, buildChatConfig, readEnv } from './agent.config';
import { MEDTRUST_SYSTEM_PROMPT } from '../agent/prompts/system';

@Global()
@Module({
  providers: [
    {
      provide: AGENT_CONFIG,
      useFactory: () => buildChatConfig(readEnv(), MEDTRUST_SYSTEM_PROMPT),
    },
  ],
  exports: [AGENT_CONFIG],
})
export class AppConfigModule {}
