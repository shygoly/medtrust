import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  DataProduct,
  InteropSubject,
  OrgCertificationApplication,
  ParticipantIdentity,
} from "@medtrust/database";
import { AuditModule } from "../../audit/audit.module";
import { SilkRoadController } from "./silk-road.controller";
import { SilkRoadService } from "./silk-road.service";

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [InteropSubject, DataProduct, OrgCertificationApplication, ParticipantIdentity],
      "controlplane",
    ),
    AuditModule,
  ],
  controllers: [SilkRoadController],
  providers: [SilkRoadService],
})
export class SilkRoadModule {}
