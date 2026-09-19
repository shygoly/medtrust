import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  FlPredictionAssignmentEntity,
  FlPredictionTaskEntity,
} from "@medtrust/database";
import { ComputeTaskModule } from "../../compute-task/compute-task.module";
import { DigitalContractModule } from "../digital-contract/digital-contract.module";
import { FlOrchestratorController } from "./fl-orchestrator.controller";
import { FlOrchestratorService } from "./fl-orchestrator.service";
import { FlAdmissionService } from "./fl-admission.service";
import { FlAttestationService } from "./fl-attestation.service";
import { SecurityModule } from "../../security/security.module";
import { ConnectorTaskSignalingModule } from "../connector-tasks/connector-task-signaling.module";
import { ComplianceModule } from "../../capability/l2-compliance/compliance.module";

@Module({
  imports: [
    DigitalContractModule,
    SecurityModule,
    ComputeTaskModule,
    // D-CMP-2:任务准入的合规预审复核（PreReviewGate）
    ComplianceModule,
    // 长轮询唤醒:FL 预测派发时 notify
    ConnectorTaskSignalingModule,
    TypeOrmModule.forFeature(
      [FlPredictionTaskEntity, FlPredictionAssignmentEntity],
      "controlplane",
    ),
  ],
  controllers: [FlOrchestratorController],
  providers: [FlOrchestratorService, FlAdmissionService, FlAttestationService],
  exports: [FlOrchestratorService],
})
export class FlOrchestratorModule {}
