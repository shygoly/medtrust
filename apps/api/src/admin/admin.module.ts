import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Certificate,
  OpenPlatformApp,
  RefreshToken,
  SpaceEntity,
  User,
} from "@medtrust/database";
import { ParticipantIdentityModule } from "../runtime/participant-identity/participant-identity.module";
import { AdminController } from "./admin.controller";
import { SystemController } from "./system.controller";
import { InfraAdminController } from "./infra-admin.controller";
import { AdminService } from "./admin.service";
import { InfraAdminService } from "./infra-admin.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
    TypeOrmModule.forFeature(
      [Certificate, OpenPlatformApp, SpaceEntity],
      "controlplane",
    ),
    ParticipantIdentityModule,
  ],
  controllers: [AdminController, SystemController, InfraAdminController],
  providers: [AdminService, InfraAdminService],
})
export class AdminModule {}
