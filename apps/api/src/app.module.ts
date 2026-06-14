import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { DataAssetModule } from './data-asset/data-asset.module';
import { AccessRequestModule } from './access-request/access-request.module';
import { ComputeTaskModule } from './compute-task/compute-task.module';
import { AuditModule } from './audit/audit.module';
import { FlowerModule } from './flower/flower.module';
import { SecurityModule } from './security/security.module';
import { HealthModule } from './health/health.module';
import { FederatedLearningModule } from './privacy/fl/fl.module';
import { MpcModule } from './privacy/mpc/mpc.module';
import { TeeModule } from './privacy/tee/tee.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { FhirModule } from './fhir/fhir.module';
import { ParticipantIdentityModule } from './participant-identity/participant-identity.module';
import { DigitalContractModule } from './digital-contract/digital-contract.module';
import { CatalogModule } from './catalog/catalog.module';
import { SettlementModule } from './settlement/settlement.module';
import { FederationModule } from './federation/federation.module';
import { AppDataSource } from '@medtrust/database';
import securityConfig from './security/config/security.config';

// Cutover rollback switch. Old centralized modules (data aggregation +
// one-shot access approval) stay ON by default; set LEGACY_CENTRALIZED=off to
// disable them and rely on the federated path (CatalogModule + DigitalContractModule).
// Reversible — no code is removed (tasks 8.1/8.2).
const legacyCentralizedModules =
  process.env.LEGACY_CENTRALIZED === 'off' ? [] : [DataAssetModule, AccessRequestModule];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [securityConfig],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: async () => ({
        ...AppDataSource.options,
      }),
    }),
    SecurityModule,
    AuthModule,
    TenantModule,
    ...legacyCentralizedModules,
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
    FederationModule,
  ],
})
export class AppModule {}
