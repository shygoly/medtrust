import "./load-env";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { TypeOrmModule, TypeOrmModuleOptions } from "@nestjs/typeorm";
import { AuthModule } from "./auth/auth.module";
import { TenantModule } from "./tenant/tenant.module";
import { ComputeTaskModule } from "./compute-task/compute-task.module";
import { AuditModule } from "./audit/audit.module";
import { FlowerModule } from "./flower/flower.module";
import { SecurityModule } from "./security/security.module";
import { HealthModule } from "./health/health.module";
import { FederatedLearningModule } from "./privacy/fl/fl.module";
import { MpcModule } from "./privacy/mpc/mpc.module";
import { TeeModule } from "./privacy/tee/tee.module";
import { BlockchainModule } from "./blockchain/blockchain.module";
import { FhirModule } from "./fhir/fhir.module";
import { ParticipantIdentityModule } from "./runtime/participant-identity/participant-identity.module";
import { DigitalContractModule } from "./runtime/digital-contract/digital-contract.module";
import { CatalogModule } from "./runtime/catalog/catalog.module";
import { SettlementModule } from "./runtime/settlement/settlement.module";
import { RbqmModule } from "./runtime/rbqm/rbqm.module";
import { FederationModule } from "./runtime/federation/federation.module";
import { SpaceModule } from "./runtime/space/space.module";
import { SpaceContextModule } from "./runtime/space-context/space-context.module";
import { SpacePacksModule } from "./runtime/space-packs/space-packs.module";
import { registerMedCollectors, registerMedTemplates } from "@medtrust/domain-med";
import { kernelCollectorRegistry } from "./mdop/operators/collector-registry";
import { kernelTemplateRegistry } from "./mdop/template-registry";

// 组装根（D-SPD-6 / change `pack-med-collectors`，TD-12）：把行业包声明的**平台侧聚合收集器**接进基座注册表。
// 基座不 import 行业包、行业包也不认识基座实现——两者只经 SPI 的注册面相遇；不注册即 fail-closed。
registerMedCollectors(kernelCollectorRegistry);
registerMedTemplates(kernelTemplateRegistry);
import { ConnectorAuditModule } from "./runtime/connector-audit/connector-audit.module";
import { SecretFlowOrchestratorModule } from "./runtime/secretflow-orchestrator/secretflow-orchestrator.module";
import { RwsOrchestratorModule } from "./runtime/rws-orchestrator/rws-orchestrator.module";
import { EndorsementVerificationModule } from "./runtime/endorsement-verification/endorsement-verification.module";
import { FlOrchestratorModule } from "./runtime/fl-orchestrator/fl-orchestrator.module";
import { SecretFlowAssistantModule } from "./secretflow-assistant/secretflow-assistant.module";
import { ResultInterpreterModule } from "./result-interpreter/result-interpreter.module";
import { CapabilityModule } from "./capability/capability.module";
import { ComplianceModule } from "./capability/l2-compliance/compliance.module";
import { XianIntegrationModule } from "./runtime/xian-integration/xian-integration.module";
import { OrganizationModule } from "./runtime/organization/organization.module";
import { PortalModule } from "./runtime/portal/portal.module";
import { SilkRoadModule } from "./runtime/silk-road/silk-road.module";
import { AccountModule } from "./account/account.module";
import { AdminModule } from "./admin/admin.module";
import { ConnectorTasksModule } from "./runtime/connector-tasks/connector-tasks.module";
import { MdopModule } from "./mdop/mdop.module";
import { AppDataSource, ControlPlaneDataSource } from "@medtrust/database";
import securityConfig from "./security/config/security.config";

// Cutover complete (8.1/8.2): the old centralized data-asset / access-request
// modules are removed. Authorization is the federated path — CatalogModule
// (data products) + DigitalContractModule (digital contracts + PEP).

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 1000,
        limit: 100,
      },
      {
        ttl: 1000,
        limit: 20,
      },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [securityConfig],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: async (): Promise<TypeOrmModuleOptions> => ({
        ...(AppDataSource.options as TypeOrmModuleOptions),
        autoLoadEntities: true,
      }),
    }),
    // Federated control-plane metadata DB (D7 physical separation): its own
    // named connection + db file. Holds catalog/contract/settlement/identity
    // metadata only — never raw medical data.
    TypeOrmModule.forRootAsync({
      name: "controlplane",
      // No autoLoadEntities: rely on the explicit `entities: controlPlaneEntities`
      // in ControlPlaneDataSource.options so every cp_ table is created on boot.
      // forFeature([...], 'controlplane') still wires repositories per module.
      useFactory: async (): Promise<TypeOrmModuleOptions> => ({
        ...(ControlPlaneDataSource.options as TypeOrmModuleOptions),
      }),
    }),
    SecurityModule,
    AuthModule,
    TenantModule,
    ComputeTaskModule,
    AuditModule,
    FlowerModule,
    HealthModule,
    FederatedLearningModule,
    MpcModule,
    TeeModule,
    BlockchainModule,
    FhirModule,
    ParticipantIdentityModule,
    DigitalContractModule,
    CatalogModule,
    SettlementModule,
    RbqmModule,
    FederationModule,
    SpaceModule,
    SpaceContextModule,
    SpacePacksModule,
    ConnectorAuditModule,
    SecretFlowOrchestratorModule,
    RwsOrchestratorModule,
    EndorsementVerificationModule,
    FlOrchestratorModule,
    // 统一长轮询下发(RWS + FL 预测 + 联邦训练轮次)
    ConnectorTasksModule,
    MdopModule,
    SecretFlowAssistantModule,
    ResultInterpreterModule,
    CapabilityModule,
    ComplianceModule,
    XianIntegrationModule,
    OrganizationModule,
    PortalModule,
    AccountModule,
    SilkRoadModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
