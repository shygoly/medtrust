import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CollaborationEntity,
  DataProduct,
  DigitalContractEntity,
  ExchangeAttemptEntity,
  SpaceEntity,
  SpaceMemberEntity,
  User,
} from "@medtrust/database";
import { ConnectorModulesModule } from "../connector-modules/connector-modules.module";
import { SpaceContextModule } from "../space-context/space-context.module";
import { SpaceModule } from "../space/space.module";
import { ExchangeAttemptController } from "./exchange-attempt.controller";
import { ExchangeAttemptService } from "./exchange-attempt.service";
import { PowerSpaceSeedService } from "./power-space.seed";
import { SpacePackRegistryService } from "./space-pack-registry.service";

/** 能力包装配（P1.2/P1.3）。全局导出，使任何模块可按空间解析启用集。 */
@Global()
@Module({
  imports: [
    SpaceContextModule,
    SpaceModule,
    ConnectorModulesModule,
    TypeOrmModule.forFeature([User]),
    TypeOrmModule.forFeature(
      [
        SpaceEntity,
        DataProduct,
        CollaborationEntity,
        ExchangeAttemptEntity,
        SpaceMemberEntity,
        DigitalContractEntity,
      ],
      "controlplane",
    ),
  ],
  controllers: [ExchangeAttemptController],
  providers: [
    SpacePackRegistryService,
    PowerSpaceSeedService,
    ExchangeAttemptService,
  ],
  exports: [SpacePackRegistryService, ExchangeAttemptService],
})
export class SpacePacksModule {}
