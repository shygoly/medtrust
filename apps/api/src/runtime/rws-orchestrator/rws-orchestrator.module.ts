import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RwsAssignmentEntity, RwsTaskEntity } from '@medtrust/database';
import { DigitalContractModule } from '../digital-contract/digital-contract.module';
import { CatalogModule } from '../catalog/catalog.module';
import { RwsOrchestratorController } from './rws-orchestrator.controller';
import { ConnectorPullController } from './connector-pull.controller';
import { RwsOrchestratorService } from './rws-orchestrator.service';
import { RwsAdmissionService } from './rws-admission.service';
import { ConnectorTokenGuard } from '../../common/guards/connector-token.guard';

@Module({
  imports: [
    DigitalContractModule,
    CatalogModule,
    TypeOrmModule.forFeature([RwsTaskEntity, RwsAssignmentEntity], 'controlplane'),
  ],
  controllers: [RwsOrchestratorController, ConnectorPullController],
  providers: [RwsOrchestratorService, RwsAdmissionService, ConnectorTokenGuard],
  exports: [RwsOrchestratorService],
})
export class RwsOrchestratorModule {}
