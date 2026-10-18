import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NotificationEntity } from "@medtrust/database";
import { SpaceContextModule } from "../space-context/space-context.module";
import { NotificationService } from "./notification.service";
import { NotificationController } from "./notification.controller";

// 站内信（D-NOTIF-1）：机构待办的收件箱。持久化在 control-plane 连接。
@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationEntity], "controlplane"),
    SpaceContextModule,
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
