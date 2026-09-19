import { Module } from "@nestjs/common";
import { SecretFlowOrchestratorController } from "./secretflow-orchestrator.controller";
import { SecretFlowOrchestratorService } from "./secretflow-orchestrator.service";
import { NodeCapabilityService } from "./node-capability.service";
import { SecretFlowTranspilerService } from "./transpiler.service";
import { OrchestratorFsmService } from "./orchestrator-fsm.service";
import { SecretFlowEventsGateway } from "./secretflow-events.gateway";
import { SecretFlowAdmissionService } from "./secretflow-admission.service";
import { DigitalContractModule } from "../digital-contract/digital-contract.module";
import { SettlementModule } from "../settlement/settlement.module";
import { ComplianceModule } from "../../capability/l2-compliance/compliance.module";
import { CryptoModule } from "../../security/crypto/crypto.module";
import { LoraDeliverableService } from "./lora-deliverable.service";
import { ConnectorTaskSignalingModule } from "../connector-tasks/connector-task-signaling.module";
import { FlRoundQueueService } from "./fl-round-queue.service";

/**
 * Space Orchestrator module — the declarative SecretFlow control plane.
 * Imports DigitalContract (PEP admission + attestation) and Settlement
 * (按贡献分账) so the business closure runs end-to-end.
 */
@Module({
  imports: [
    DigitalContractModule,
    SettlementModule,
    ComplianceModule,
    CryptoModule,
    // 长轮询唤醒 + 下发任务签名(联邦训练轮次经连接器中转)
    ConnectorTaskSignalingModule,
  ],
  controllers: [SecretFlowOrchestratorController],
  providers: [
    SecretFlowOrchestratorService,
    NodeCapabilityService,
    SecretFlowTranspilerService,
    OrchestratorFsmService,
    SecretFlowEventsGateway,
    SecretFlowAdmissionService,
    LoraDeliverableService,
    FlRoundQueueService,
  ],
  exports: [SecretFlowOrchestratorService, FlRoundQueueService],
})
export class SecretFlowOrchestratorModule {}
