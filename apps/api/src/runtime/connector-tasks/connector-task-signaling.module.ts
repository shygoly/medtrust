import { Module } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { ConnectorTaskNotifier } from "./connector-task-notifier.service";
import { ConnectorTaskSigner } from "./connector-task-signer.service";

/**
 * 低层信令模块：长轮询唤醒登记 + 下发任务签名。
 *
 * 放在被各编排器（RWS / FL 预测 / 联邦训练）导入的最底层，避免
 * 「编排器要 notify → 信令模块要编排器拉任务」的循环依赖：
 * 真正聚合三类待办的 ConnectorTasksModule 才导入各编排器模块。
 */
@Module({
  imports: [ParticipantIdentityModule],
  providers: [GMCryptoService, ConnectorTaskNotifier, ConnectorTaskSigner],
  exports: [ConnectorTaskNotifier, ConnectorTaskSigner],
})
export class ConnectorTaskSignalingModule {}
