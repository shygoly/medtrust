import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainAttestation } from '@medtrust/database';
import { BlockchainController } from './blockchain.controller';
import { BlockchainService } from './blockchain.service';
import { FiscoBcosAdapter } from './adapters/fisco-bcos.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([BlockchainAttestation])],
  controllers: [BlockchainController],
  providers: [BlockchainService, FiscoBcosAdapter],
  exports: [BlockchainService],
})
export class BlockchainModule {}
