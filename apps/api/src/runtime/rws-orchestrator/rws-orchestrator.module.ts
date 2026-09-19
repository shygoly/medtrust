import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RwsAssignmentEntity, RwsTaskEntity } from "@medtrust/database";
import { DigitalContractModule } from "../digital-contract/digital-contract.module";
import { CatalogModule } from "../catalog/catalog.module";
import { FlOrchestratorModule } from "../fl-orchestrator/fl-orchestrator.module";
import { ConnectorAuditModule } from "../connector-audit/connector-audit.module";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { RwsOrchestratorController } from "./rws-orchestrator.controller";
import { ConnectorPullController } from "./connector-pull.controller";
import { RwsOrchestratorService } from "./rws-orchestrator.service";
import { RwsAdmissionService } from "./rws-admission.service";
import { ConnectorTokenGuard } from "../../common/guards/connector-token.guard";
import { MetaAnalysisService } from "./meta-analysis.service";
import { L0ValidationMergeService } from "./l0-validation-merge";
import { ConnectorModulesModule } from "../connector-modules/connector-modules.module";
import { ConnectorTaskSignalingModule } from "../connector-tasks/connector-task-signaling.module";
import { ComplianceModule } from "../../capability/l2-compliance/compliance.module";

@Module({
  imports: [
    DigitalContractModule,
    CatalogModule,
    FlOrchestratorModule,
    ConnectorAuditModule,
    ParticipantIdentityModule,
    ConnectorModulesModule,
    // D-CMP-2:任务准入的合规预审复核（PreReviewGate）
    ComplianceModule,
    // 长轮询唤醒(outbound-longpoll-agent-auth D2):派发新任务时 notify
    ConnectorTaskSignalingModule,
    TypeOrmModule.forFeature(
      [RwsTaskEntity, RwsAssignmentEntity],
      "controlplane",
    ),
  ],
  controllers: [RwsOrchestratorController, ConnectorPullController],
  providers: [
    RwsOrchestratorService,
    RwsAdmissionService,
    MetaAnalysisService,
    L0ValidationMergeService,
    ConnectorTokenGuard,
  ],
  exports: [
    RwsOrchestratorService,
    MetaAnalysisService,
    L0ValidationMergeService,
  ],
})
export class RwsOrchestratorModule {}
