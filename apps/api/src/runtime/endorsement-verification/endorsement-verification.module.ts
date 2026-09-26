import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Certificate } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { EndorsementVerificationController } from "./endorsement-verification.controller";

// on-chain-provider-endorsement — 存证背书的独立核验通道（信任锚发布 + 便利核验）。
@Module({
  imports: [
    ParticipantIdentityModule,
    TypeOrmModule.forFeature([Certificate], "controlplane"),
  ],
  controllers: [EndorsementVerificationController],
  providers: [GMCryptoService],
})
export class EndorsementVerificationModule {}
