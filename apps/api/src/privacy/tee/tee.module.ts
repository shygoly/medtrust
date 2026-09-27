import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TeeComputation } from "@medtrust/database";
import { TeeController } from "./tee.controller";
import { TeeService } from "./tee.service";
import { ConfidentialComputeAttestationAdapter } from "./adapters/confidential-compute-attestation.adapter";

@Module({
  imports: [TypeOrmModule.forFeature([TeeComputation])],
  controllers: [TeeController],
  providers: [TeeService, ConfidentialComputeAttestationAdapter],
  exports: [TeeService],
})
export class TeeModule {}
