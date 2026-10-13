import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CollaborationEntity,
  DataProduct,
  ExchangeAttemptEntity,
  SpaceEntity,
  SpaceMemberEntity,
  User,
} from "@medtrust/database";
import { ConnectorModulesModule } from "../connector-modules/connector-modules.module";
import { SpaceContextModule } from "../space-context/space-context.module";
import { ExchangeAttemptService } from "./exchange-attempt.service";
import { PowerSpaceSeedService } from "./power-space.seed";
import { SpacePackRegistryService } from "./space-pack-registry.service";

/** 能力包装配（P1.2/P1.3）。全局导出，使任何模块可按空间解析启用集。 */
@Global()
@Module({
  imports: [
    SpaceContextModule,
    ConnectorModulesModule,
    TypeOrmModule.forFeature([User]),
    TypeOrmModule.forFeature(
      [
        SpaceEntity,
        DataProduct,
        CollaborationEntity,
        ExchangeAttemptEntity,
        SpaceMemberEntity,
      ],
      "controlplane",
    ),
  ],
  providers: [
    SpacePackRegistryService,
    PowerSpaceSeedService,
    ExchangeAttemptService,
  ],
  exports: [SpacePackRegistryService, ExchangeAttemptService],
})
export class SpacePacksModule {}
