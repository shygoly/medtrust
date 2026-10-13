import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CollaborationEntity,
  DataProduct,
  SpaceEntity,
  SpaceInvitationEntity,
  SpaceMemberEntity,
} from "@medtrust/database";
import { SecurityModule } from "../../security/security.module";
import { SpaceController } from "./space.controller";
import { SpaceService } from "./space.service";
import { SpaceMembershipController } from "./space-membership.controller";
import { SpaceThemeController } from "./space-theme.controller";
import { SpaceThemeService } from "./space-theme.service";
import { CollaborationService } from "./collaboration.service";
import { SpaceMembershipService } from "./space-membership.service";

// 空间基础管理(6.5)。持久化到 control-plane 连接(D7 物理隔离)。
// 全局导出成员服务，供各模块的角色守卫按空间取角色，而不是读全局用户角色。
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SpaceEntity], "controlplane"),
    TypeOrmModule.forFeature(
      [
        SpaceMemberEntity,
        SpaceInvitationEntity,
        CollaborationEntity,
        DataProduct,
      ],
      "controlplane",
    ),
    SecurityModule,
  ],
  controllers: [
    SpaceController,
    SpaceMembershipController,
    SpaceThemeController,
  ],
  providers: [
    SpaceService,
    SpaceMembershipService,
    SpaceThemeService,
    CollaborationService,
  ],
  exports: [
    SpaceService,
    SpaceMembershipService,
    SpaceThemeService,
    CollaborationService,
  ],
})
export class SpaceModule {}
