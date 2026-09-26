import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ModuleAdmissionEntity,
  ModuleRevocationEntity,
} from "@medtrust/database";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AlgorithmModuleRegistry } from "./algorithm-module.registry";
import { ModuleAdmissionService } from "./module-admission.service";
import { ModuleAdmissionController } from "./module-admission.controller";

// algorithm-sandbox:算法模块分发。
// third-party-module-admission:第三方模块准入（五道闸）与吊销。
@Module({
  imports: [
    ParticipantIdentityModule,
    TypeOrmModule.forFeature(
      [ModuleAdmissionEntity, ModuleRevocationEntity],
      "controlplane",
    ),
  ],
  controllers: [ModuleAdmissionController],
  providers: [GMCryptoService, AlgorithmModuleRegistry, ModuleAdmissionService],
  exports: [AlgorithmModuleRegistry, ModuleAdmissionService],
})
export class ConnectorModulesModule {}
