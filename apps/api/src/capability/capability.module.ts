import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
} from '@medtrust/database';
import { CapabilityRegistryService } from './registry.service';
import { CapabilityController } from './capability.controller';

// 七层能力注册表的只读访问域(P0)。autoLoadEntities 会把这 6 张能力表
// 自动并入 AppDataSource;dev synchronize 自动建表。L2 规则表在 P1 引擎接入时再 forFeature。
@Module({
  imports: [
    TypeOrmModule.forFeature([
      L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
    ]),
  ],
  controllers: [CapabilityController],
  providers: [CapabilityRegistryService],
  exports: [CapabilityRegistryService],
})
export class CapabilityModule {}
