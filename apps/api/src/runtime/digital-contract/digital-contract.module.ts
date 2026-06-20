import { Module } from '@nestjs/common';
import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { ContractService } from './contract.service';
import { AttestationService } from './attestation.service';
import { ContractController } from './contract.controller';

// 数字合约 + 使用控制(控制面侧):合约生成、生效状态、撤销、哈希上链存证。
@Module({
  controllers: [ContractController],
  providers: [GMCryptoService, ContractService, AttestationService],
  exports: [ContractService, AttestationService],
})
export class DigitalContractModule {}
