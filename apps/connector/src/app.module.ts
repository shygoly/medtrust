import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorDataSource, LocalAuditLog } from '@medtrust/database';
import { AuditService } from './domain/audit';
import { Deidentifier } from './domain/deidentifier';
import { FhirGateway } from './domain/fhir-gateway';
import { LocalStore } from './domain/local-store';
import { RwsExecutor } from './domain/rws-executor';
import { CausalExecutor } from './domain/causal/causal-executor';
import { createProductionCausalBackend } from './domain/causal/causal-backend';
import { TaskPuller } from './domain/task-puller';
import { PolicyEnforcementPoint } from './domain/policy-enforcement';
import { TaskScratch } from './domain/task-scratch';
import { RetentionEnforcer } from './domain/retention';
import { ConnectorTaskRunner } from './domain/connector-task-runner';
import { FlTaskRunner } from './domain/fl-prediction/fl-task-runner';
import { SoftwareTee } from './domain/tee';
import { OutputGate } from './domain/output-gate';
import { RwsOrchestrator } from './domain/rws-orchestrator';
import { AlgorithmValidationExecutor } from './domain/algorithm-validation-executor';
import { LocalGoldStandardStore } from './domain/local-gold-standard-store';
import { SettlementService } from './domain/settlement';
import { CrossSpaceGateway } from './domain/cross-space-gateway';
import { LocalDataLoader } from './domain/local-data-loader';
import { DataProductLocalSource } from './domain/data-product-local-source';
import { ControlPlaneClient } from './domain/control-plane-client';
import { ConnectorWorkerService } from './domain/connector-worker.service';
import { TaskProgressReporter } from './domain/task-progress-reporter';
import { ConnectorAuditController } from './domain/connector-audit.controller';
import { ConnectorTokenGuard } from './domain/connector-token.guard';
import { WasmSandboxRunner } from './domain/sandbox/sandbox-runner';
import { ConnectorModuleClient } from './domain/sandbox/module-client';
import { AlgorithmSandboxExecutor } from './domain/sandbox/algorithm-sandbox-executor';
import { FlRoundExecutor } from './domain/fl-round/fl-round-executor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    TypeOrmModule.forRoot({ ...ConnectorDataSource.options as any, autoLoadEntities: false }),
    TypeOrmModule.forFeature([LocalAuditLog]),
  ],
  controllers: [ConnectorAuditController],
  providers: [
    AuditService,
    Deidentifier,
    FhirGateway,
    LocalStore,
    SoftwareTee,
    OutputGate,
    {
      provide: CausalExecutor,
      useFactory: (store: LocalStore, tee: SoftwareTee) =>
        new CausalExecutor(store, tee, createProductionCausalBackend()),
      inject: [LocalStore, SoftwareTee],
    },
    RwsExecutor,
    LocalGoldStandardStore,
    AlgorithmValidationExecutor,
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
        gold: LocalGoldStandardStore,
      ) =>
        new DataProductLocalSource(
          store,
          loader,
          audit,
          cp.asCatalogResolver(),
          gold,
        ),
      inject: [
        LocalStore,
        LocalDataLoader,
        AuditService,
        ControlPlaneClient,
        LocalGoldStandardStore,
      ],
    },
    ConnectorWorkerService,
    TaskProgressReporter,
    ConnectorTokenGuard,
    // algorithm-sandbox(D-CN-2):签名 Wasm 模块的能力受限执行
    WasmSandboxRunner,
    ConnectorModuleClient,
    AlgorithmSandboxExecutor,
    // 长轮询下发 + 联邦训练轮次中转(outbound-longpoll-agent-auth)
    // 注:ConnectorTaskDedupe 不注册为 provider —— 它由 ConnectorWorkerService 手动
    // new(需注入 number ttl,Nest 无法解析基元参数),注册反而导致 DI 启动崩溃。
    FlRoundExecutor,
  ],
})
export class AppModule {}
