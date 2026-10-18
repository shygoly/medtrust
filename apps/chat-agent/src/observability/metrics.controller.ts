import { Controller, Get, Header, Inject } from '@nestjs/common';
import { AGENT_CONFIG, type MedTrustChatConfig } from '../config/agent.config';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(AGENT_CONFIG) private readonly config: MedTrustChatConfig,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  render(): string {
    if (!this.config.metricsEnabled) return '# metrics disabled\n';
    return this.metrics.render();
  }
}
