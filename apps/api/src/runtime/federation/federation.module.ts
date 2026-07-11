import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FederationTrust, RemoteCatalogEntry } from "@medtrust/database";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { FederationService } from "./federation.service";
import { FederationController } from "./federation.controller";

// 跨空间互联(space-interconnect):联邦信任清单 + 目录联邦。
// 复用 ParticipantIdentityModule 导出的单一 CaService(避免多实例 / 多 CA 根密钥);
// 信任清单 + 远端目录持久化在 control-plane 库。
@Module({
  imports: [
    ParticipantIdentityModule,
    TypeOrmModule.forFeature(
      [FederationTrust, RemoteCatalogEntry],
      "controlplane",
    ),
  ],
  controllers: [FederationController],
  providers: [FederationService],
  exports: [FederationService],
})
export class FederationModule {}
