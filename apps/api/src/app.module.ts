import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
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

// Cutover complete (8.1/8.2): the old centralized data-asset / access-request
// modules are removed. Authorization is the federated path — CatalogModule
// (data products) + DigitalContractModule (digital contracts + PEP).

@Module({
  imports: [
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
    FederationModule,
  ],
})
export class AppModule {}
