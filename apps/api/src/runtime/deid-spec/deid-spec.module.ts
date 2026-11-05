import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DeidSpecEntity } from "@medtrust/database";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { DeidSpecService } from "./deid-spec.service";
import { DeidSpecController } from "./deid-spec.controller";

// deid-spec：脱敏规格签发/版本/吊销（connector-agent-deidentification）。
// 规格随连接器长轮询批次下发（ConnectorTasksModule 消费本模块的 service）。
@Module({
  imports: [
    ParticipantIdentityModule,
    TypeOrmModule.forFeature([DeidSpecEntity], "controlplane"),
  ],
  controllers: [DeidSpecController],
  providers: [GMCryptoService, DeidSpecService],
  exports: [DeidSpecService],
})
export class DeidSpecModule {}
