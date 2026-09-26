import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ConnectorDataSource,
  LocalAuditLog,
  LocalDataSourceStatus,
  LocalMdopContract,
  LocalMdopContractPending,
  LocalMdopOperatorWhitelist,
  LocalMdopRevocationState,
  LocalMdopProcessedKey,
  LocalMdopNonce,
  LocalMdopArtifact,
  LocalMdopReceipt,
} from '@medtrust/database';
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
import { CdmDataSourceRegistry } from './domain/data-source/cdm-data-source-registry';
import { CdmCoverageReporter } from './domain/data-source/cdm-coverage-reporter';
import { MdopContractStore } from './mdop/contract-store';
import { MdopContractController } from './mdop/mdop-contract.controller';
import { LocalAdminGuard } from './mdop/local-admin.guard';
import { MdopOperatorWhitelistStore } from './mdop/operator-whitelist';
import { MdopOperatorController } from './mdop/mdop-operator.controller';
import { MdopLocalStore } from './mdop/mdop-local-store';
import { MdopReviewService } from './mdop/mdop-review';
import { MdopStageExecutor } from './mdop/mdop-executor';
import { MdopEgressGuard } from './mdop/mdop-egress';
import { MdopOutboundClient } from './mdop/mdop-client';
import { MdopNodeService } from './mdop/mdop-node.service';
import { L15OperatorWiring } from './mdop/operators/wire-l15';
import { InMemorySealKeyDepositor, SealOperatorWiring } from './mdop/operators/wire-seal';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    TypeOrmModule.forRoot({ ...ConnectorDataSource.options as any, autoLoadEntities: false }),
    TypeOrmModule.forFeature([
      LocalAuditLog,
      LocalDataSourceStatus,
      LocalMdopContract,
      LocalMdopContractPending,
      LocalMdopOperatorWhitelist,
      LocalMdopRevocationState,
      LocalMdopProcessedKey,
      LocalMdopNonce,
      LocalMdopArtifact,
      LocalMdopReceipt,
    ]),
  ],
  controllers: [ConnectorAuditController, MdopContractController, MdopOperatorController],
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
    {
      // third-party-module-admission 闸 5:PEP 执行前查吊销名单,
      // 名单由 ConnectorModuleClient 从长轮询批次收下并按版本合并。
      provide: PolicyEnforcementPoint,
      useFactory: (audit: AuditService, modules: ConnectorModuleClient) =>
        new PolicyEnforcementPoint(audit, modules),
      inject: [AuditService, ConnectorModuleClient],
    },
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
          // 启动预热失败时按需补拉（平台重启窗口内连接器仍能自愈）
          (productId: string) => cp.prefetchCatalogProduct(productId),
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
    // omop-data-source-access(D-CN-6):院内库的句柄只在这里——接入校验、周期复核、覆盖元数据上报
    CdmCoverageReporter,
    CdmDataSourceRegistry,
    // mdop-kernel(D-MDOP-4):本地合约库 + 本地确认/撤销
    MdopContractStore,
    // mdop-kernel(D-MDOP-5):本地算子白名单 + 清单/吊销状态
    MdopOperatorWhitelistStore,
    // mdop-kernel(D-MDOP-1 §8):连接器侧 MDOP 运行时（缺省 MDOP_ENABLED=false 不启用）
    MdopLocalStore,
    MdopReviewService,
    MdopStageExecutor,
    MdopEgressGuard,
    MdopOutboundClient,
    MdopNodeService,
    // mdop-kernel(§9):把 L1.5 四个算子接到既有数据加载/沙箱/输出闸门
    L15OperatorWiring,
    // C2 封装算子（任务 6.2）：未配置 KMS 保管口时，封装一律 fail-closed
    SealOperatorWiring,
    ...(process.env.CONNECTOR_MDOP_KMS_REF ? [InMemorySealKeyDepositor] : []),
    LocalAdminGuard,
  ],
})
export class AppModule {}
