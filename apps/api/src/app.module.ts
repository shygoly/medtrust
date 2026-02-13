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
import { AppDataSource } from '@medtrust/database';
import securityConfig from './security/config/security.config';

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
    DataAssetModule,
    AccessRequestModule,
    ComputeTaskModule,
    AuditModule,
    FlowerModule,
    HealthModule,
    FederatedLearningModule,
    MpcModule,
    TeeModule,
    BlockchainModule,
    FhirModule,
  ],
})
export class AppModule {}
