import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorDataSource } from '@medtrust/database';
import { AuditService } from './domain/audit';
import { Deidentifier } from './domain/deidentifier';
import { FhirGateway } from './domain/fhir-gateway';
import { LocalStore } from './domain/local-store';
import { RwsExecutor } from './domain/rws-executor';
import { TaskPuller } from './domain/task-puller';
import { PolicyEnforcementPoint } from './domain/policy-enforcement';
import { TaskScratch } from './domain/task-scratch';
import { RetentionEnforcer } from './domain/retention';
import { ConnectorTaskRunner } from './domain/connector-task-runner';
import { FlTaskRunner } from './domain/fl-prediction/fl-task-runner';
import { SoftwareTee } from './domain/tee';
import { OutputGate } from './domain/output-gate';
import { RwsOrchestrator } from './domain/rws-orchestrator';
import { SettlementService } from './domain/settlement';
import { CrossSpaceGateway } from './domain/cross-space-gateway';
import { LocalDataLoader } from './domain/local-data-loader';
import { DataProductLocalSource } from './domain/data-product-local-source';
import { ControlPlaneClient } from './domain/control-plane-client';
import { ConnectorWorkerService } from './domain/connector-worker.service';
import { TaskProgressReporter } from './domain/task-progress-reporter';
import { ConnectorAuditController } from './domain/connector-audit.controller';
import { ConnectorTokenGuard } from './domain/connector-token.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    TypeOrmModule.forRoot({ ...ConnectorDataSource.options as any, autoLoadEntities: false }),
  ],
  controllers: [ConnectorAuditController],
  providers: [
    AuditService,
    Deidentifier,
    FhirGateway,
    LocalStore,
    SoftwareTee,
    OutputGate,
    RwsExecutor,
    TaskPuller,
    PolicyEnforcementPoint,
    TaskScratch,
    RetentionEnforcer,
    ConnectorTaskRunner,
    FlTaskRunner,
    RwsOrchestrator,
    SettlementService,
    CrossSpaceGateway,
    LocalDataLoader,
    ControlPlaneClient,
    {
      provide: DataProductLocalSource,
      useFactory: (
        store: LocalStore,
        loader: LocalDataLoader,
        audit: AuditService,
        cp: ControlPlaneClient,
      ) => new DataProductLocalSource(store, loader, audit, cp.asCatalogResolver()),
      inject: [LocalStore, LocalDataLoader, AuditService, ControlPlaneClient],
    },
    ConnectorWorkerService,
    TaskProgressReporter,
    ConnectorTokenGuard,
  ],
})
export class AppModule {}
