import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OrgCertificationApplication, User } from "@medtrust/database";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { OrganizationController } from "./organization.controller";
import { OrganizationService } from "./organization.service";
import { UploadService } from "./upload.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([OrgCertificationApplication], "controlplane"),
    TypeOrmModule.forFeature([User]),
    ParticipantIdentityModule,
  ],
  controllers: [OrganizationController],
  providers: [OrganizationService, UploadService],
})
export class OrganizationModule {}
