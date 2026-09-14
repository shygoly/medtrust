import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  KriDefinitionEntity,
  KriObservationEntity,
  QtlBreachEntity,
} from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { DigitalContractModule } from "../digital-contract/digital-contract.module";
import { RbqmService } from "./rbqm.service";
import { RbqmController } from "./rbqm.controller";

// RBQM 中心化监查（rbqm-central-monitoring）:KRI 定义 + 站点观测 + QTL 越限。
// 复用 DigitalContractModule 导出的 AttestationService 做越限上链存证。
// 三张表持久化在 control-plane 库。
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [KriDefinitionEntity, KriObservationEntity, QtlBreachEntity],
      "controlplane",
    ),
    DigitalContractModule,
  ],
  controllers: [RbqmController],
  providers: [GMCryptoService, RbqmService],
  exports: [RbqmService],
})
export class RbqmModule {}
