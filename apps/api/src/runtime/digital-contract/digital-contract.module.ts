import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DigitalContractEntity } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CatalogModule } from "../catalog/catalog.module";
import { ContractService } from "./contract.service";
import { AttestationService } from "./attestation.service";
import { ContractController } from "./contract.controller";

// 数字合约 + 使用控制(控制面侧):合约生成、生效状态、撤销、哈希上链存证。
// 持久化在 control-plane 库。
@Module({
  imports: [
    TypeOrmModule.forFeature([DigitalContractEntity], "controlplane"),
    CatalogModule,
  ],
  controllers: [ContractController],
  providers: [GMCryptoService, ContractService, AttestationService],
  exports: [ContractService, AttestationService],
})
export class DigitalContractModule {}
