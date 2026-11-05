import { Module } from "@nestjs/common";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { RegionReportingController } from "./region-reporting.controller";
import { RegionReportingService } from "./region-reporting.service";

@Module({
  imports: [ParticipantIdentityModule],
  controllers: [RegionReportingController],
  providers: [RegionReportingService],
  exports: [RegionReportingService],
})
export class RegionReportingModule {}
