import { Module } from '@nestjs/common';
import { GMCryptoService } from '../security/crypto/gm-crypto.service';
import { CaService } from './ca.service';
import { SecureChannelService } from './secure-channel.service';
import { ParticipantRegistryService } from './participant-registry.service';

// 身份与可信通信(participant-identity)。中心 CA、SM2 安全信道、准入/授权门禁。
@Module({
  providers: [GMCryptoService, CaService, SecureChannelService, ParticipantRegistryService],
  exports: [CaService, SecureChannelService, ParticipantRegistryService],
})
export class ParticipantIdentityModule {}
