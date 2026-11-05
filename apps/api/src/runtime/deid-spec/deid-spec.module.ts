import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DeidDictionaryEntity, DeidSpecEntity } from "@medtrust/database";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { DeidSpecService } from "./deid-spec.service";
import { DeidSpecController } from "./deid-spec.controller";
import { DeidDictionaryService } from "./deid-dictionary.service";
import { DeidDictionaryController } from "./deid-dictionary.controller";

// deid-spec：脱敏规格签发/版本/吊销 + 脱敏词表摘要背书（connector-agent-deidentification）。
// 规格随连接器长轮询批次下发（ConnectorTasksModule 消费本模块的 service）。
@Module({
  imports: [
    ParticipantIdentityModule,
    TypeOrmModule.forFeature(
      [DeidSpecEntity, DeidDictionaryEntity],
      "controlplane",
    ),
  ],
  controllers: [DeidSpecController, DeidDictionaryController],
  providers: [GMCryptoService, DeidSpecService, DeidDictionaryService],
  exports: [DeidSpecService, DeidDictionaryService],
})
export class DeidSpecModule {}
