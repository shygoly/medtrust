import { Module } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ConnectorTokenGuard } from "../../common/guards/connector-token.guard";
import { FlOrchestratorModule } from "../fl-orchestrator/fl-orchestrator.module";
import { RwsOrchestratorModule } from "../rws-orchestrator/rws-orchestrator.module";
import { SecretFlowOrchestratorModule } from "../secretflow-orchestrator/secretflow-orchestrator.module";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { ConnectorModulesModule } from "../connector-modules/connector-modules.module";
import { MdopModule } from "../../mdop/mdop.module";
import { ConnectorTaskSignalingModule } from "./connector-task-signaling.module";
import { ConnectorTasksController } from "./connector-tasks.controller";

/**
 * 统一长轮询下发（RWS + FL 预测 + 联邦训练轮次）。
 * 信令（notifier/signer）在最底层模块，各编排器模块导入它做 notify；
 * 这里反向聚合三者，提供单一入口。
 */
@Module({
  imports: [
    RwsOrchestratorModule,
    FlOrchestratorModule,
    SecretFlowOrchestratorModule,
    ConnectorTaskSignalingModule,
    // 守卫依赖 ConnectorAuthService(证书验签),由 ParticipantIdentityModule 导出
    ParticipantIdentityModule,
    // third-party-module-admission 闸 5:批次里带吊销名单
    ConnectorModulesModule,
    // mdop-kernel:批次里带算子清单与**平台节点密钥签名**的 MDOP 吊销名单
    MdopModule,
  ],
  controllers: [ConnectorTasksController],
  providers: [GMCryptoService, ConnectorTokenGuard],
})
export class ConnectorTasksModule {}
