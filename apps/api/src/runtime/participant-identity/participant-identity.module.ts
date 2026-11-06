import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CaKeypair,
  ParticipantIdentity,
  Certificate,
  CpConnectorRegistry,
} from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "./ca.service";
import { ParticipantCommercialService } from "./participant-commercial.service";
import { SecureChannelService } from "./secure-channel.service";
import { ParticipantRegistryService } from "./participant-registry.service";
import { ConnectorAdminService } from "./connector-admin.service";
import { ConnectorAuthService } from "./connector-auth.service";
import { ConnectorAdminController } from "./connector-admin.controller";
import { ParticipantDirectorySeedService } from "./participant-directory.seed";

// 身份与可信通信(participant-identity)。中心 CA、SM2 安全信道、准入/授权门禁、
// 连接器注册/注销。CA 根密钥 / 参与方 / 证书 / 连接器注册表持久化在 control-plane 库。
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [CaKeypair, ParticipantIdentity, Certificate, CpConnectorRegistry],
      "controlplane",
    ),
  ],
  controllers: [ConnectorAdminController],
  providers: [
    GMCryptoService,
    CaService,
    SecureChannelService,
    ParticipantRegistryService,
    ConnectorAdminService,
    ConnectorAuthService,
    ParticipantCommercialService,
    ParticipantDirectorySeedService,
  ],
  exports: [
    CaService,
    SecureChannelService,
    ParticipantRegistryService,
    ConnectorAdminService,
    ConnectorAuthService,
    ParticipantCommercialService,
  ],
})
export class ParticipantIdentityModule {}
