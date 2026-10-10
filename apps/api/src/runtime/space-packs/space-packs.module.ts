import { Global, Module } from "@nestjs/common";
import { ConnectorModulesModule } from "../connector-modules/connector-modules.module";
import { SpaceContextModule } from "../space-context/space-context.module";
import { SpacePackRegistryService } from "./space-pack-registry.service";

/** 能力包装配（P1.2/P1.3）。全局导出，使任何模块可按空间解析启用集。 */
@Global()
@Module({
  imports: [SpaceContextModule, ConnectorModulesModule],
  providers: [SpacePackRegistryService],
  exports: [SpacePackRegistryService],
})
export class SpacePacksModule {}
