import { Module } from '@nestjs/common';
import { GMCryptoService } from '../security/crypto/gm-crypto.service';
import { CaService } from '../participant-identity/ca.service';
import { FederationService } from './federation.service';
import { FederationController } from './federation.controller';

// 跨空间互联(space-interconnect):联邦信任清单 + 目录联邦。
@Module({
  controllers: [FederationController],
  providers: [GMCryptoService, CaService, FederationService],
  exports: [FederationService],
})
export class FederationModule {}
