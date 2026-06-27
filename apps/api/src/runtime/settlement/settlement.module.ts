import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementRecord, SettlementLine } from '@medtrust/database';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

// 价值共创结算(控制面):台账 + 按角色查询。持久化在 control-plane 库。
@Module({
  imports: [TypeOrmModule.forFeature([SettlementRecord, SettlementLine], 'controlplane')],
  controllers: [SettlementController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
