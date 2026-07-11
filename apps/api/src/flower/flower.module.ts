import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ComputeTask } from "@medtrust/database";
import { ScheduleModule } from "@nestjs/schedule";

// Controllers
import { FlowerController } from "./flower.controller";
import { FlowerWebhookController } from "./flower-webhook.controller";
import { FlowerHealthController } from "./flower-health.controller";

// Services
import { FlowerService } from "./flower.service";
import { FlowerClientService } from "./flower-client.service";
import { FlowerTaskService } from "./flower-task.service";
import { FlowerConfigService } from "./flower-config.service";
import { FlowerMonitorService } from "./flower-monitor.service";
import { FlowerResultService } from "./flower-result.service";
import { FlowerErrorHandler } from "./flower-error.handler";

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([ComputeTask]),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    FlowerController,
    FlowerWebhookController,
    FlowerHealthController,
  ],
  providers: [
    // Legacy service (for backwards compatibility)
    FlowerService,
    // New services
    FlowerClientService,
    FlowerTaskService,
    FlowerConfigService,
    FlowerMonitorService,
    FlowerResultService,
    FlowerErrorHandler,
  ],
  exports: [
    FlowerService,
    FlowerClientService,
    FlowerTaskService,
    FlowerConfigService,
    FlowerMonitorService,
    FlowerResultService,
    FlowerErrorHandler,
  ],
})
export class FlowerModule {}
