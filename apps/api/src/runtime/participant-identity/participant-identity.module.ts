import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CaKeypair,
  ParticipantIdentity,
  Certificate,
} from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "./ca.service";
import { SecureChannelService } from "./secure-channel.service";
import { ParticipantRegistryService } from "./participant-registry.service";

// 身份与可信通信(participant-identity)。中心 CA、SM2 安全信道、准入/授权门禁。
// CA 根密钥 / 参与方 / 证书注册表持久化在 control-plane 库。
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [CaKeypair, ParticipantIdentity, Certificate],
      "controlplane",
    ),
  ],
  providers: [
    GMCryptoService,
    CaService,
    SecureChannelService,
    ParticipantRegistryService,
  ],
  exports: [CaService, SecureChannelService, ParticipantRegistryService],
})
export class ParticipantIdentityModule {}
