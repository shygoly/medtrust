import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BlockchainAttestation } from "@medtrust/database";
import { BlockchainController } from "./blockchain.controller";
import { BlockchainService } from "./blockchain.service";
import { ChainAdapter } from "./adapters/chain.adapter";

@Module({
  imports: [TypeOrmModule.forFeature([BlockchainAttestation])],
  controllers: [BlockchainController],
  providers: [BlockchainService, ChainAdapter],
  exports: [BlockchainService],
})
export class BlockchainModule {}
