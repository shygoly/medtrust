import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RwsAssignmentEntity, RwsTaskEntity } from "@medtrust/database";
import { DigitalContractModule } from "../digital-contract/digital-contract.module";
import { CatalogModule } from "../catalog/catalog.module";
import { FlOrchestratorModule } from "../fl-orchestrator/fl-orchestrator.module";
import { RwsOrchestratorController } from "./rws-orchestrator.controller";
import { ConnectorPullController } from "./connector-pull.controller";
import { RwsOrchestratorService } from "./rws-orchestrator.service";
import { RwsAdmissionService } from "./rws-admission.service";
import { ConnectorTokenGuard } from "../../common/guards/connector-token.guard";
import { MetaAnalysisService } from "./meta-analysis.service";
import { L0ValidationMergeService } from "./l0-validation-merge";

@Module({
  imports: [
    DigitalContractModule,
    CatalogModule,
    FlOrchestratorModule,
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
