import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataProduct, ParticipantIdentity } from "@medtrust/database";
import { PortalController } from "./portal.controller";
import { PortalService } from "./portal.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([DataProduct, ParticipantIdentity], "controlplane"),
  ],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
