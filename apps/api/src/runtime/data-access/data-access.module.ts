import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  DataProduct,
  DataProductAccessGrantEntity,
  DataProductAccessRequestEntity,
  User,
} from "@medtrust/database";
import { AuditModule } from "../../audit/audit.module";
import { SpaceContextModule } from "../space-context/space-context.module";
import { NotificationModule } from "../notifications/notification.module";
import { DataAccessService } from "./data-access.service";
import { DataAccessController } from "./data-access.controller";

// 产品级 ACL（D-ACL-1）：访问授权表 + 授予/回收/判定端点。持久化在 control-plane 连接。
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [DataProductAccessGrantEntity, DataProductAccessRequestEntity, DataProduct],
      "controlplane",
    ),
    // 申请人姓名快照（默认连接上的 users 表）。
    TypeOrmModule.forFeature([User]),
    AuditModule,
    SpaceContextModule,
    NotificationModule,
  ],
  controllers: [DataAccessController],
  providers: [DataAccessService],
  exports: [DataAccessService],
})
export class DataAccessModule {}
