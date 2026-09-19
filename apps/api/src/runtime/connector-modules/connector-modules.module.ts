import { Module } from "@nestjs/common";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AlgorithmModuleRegistry } from "./algorithm-module.registry";

// algorithm-sandbox:算法模块分发。
@Module({
  imports: [ParticipantIdentityModule],
  providers: [GMCryptoService, AlgorithmModuleRegistry],
  exports: [AlgorithmModuleRegistry],
})
export class ConnectorModulesModule {}
