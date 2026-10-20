import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CpConnectorRegistry, NotificationEntity } from "@medtrust/database";
import { SpaceContextModule } from "../space-context/space-context.module";
import { NotificationService } from "./notification.service";
import { NotificationStreamService } from "./notification-stream.service";
import { ConnectorHealthNotifierService } from "./connector-health-notifier.service";
import { NotificationController } from "./notification.controller";

// 站内信（D-NOTIF-1）：机构待办的收件箱。持久化在 control-plane 连接。
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [NotificationEntity, CpConnectorRegistry],
      "controlplane",
    ),
    SpaceContextModule,
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationStreamService,
    ConnectorHealthNotifierService,
  ],
  exports: [NotificationService, NotificationStreamService],
})
export class NotificationModule {}
