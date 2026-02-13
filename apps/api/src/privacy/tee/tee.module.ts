import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeeComputation } from '@medtrust/database';
import { TeeController } from './tee.controller';
import { TeeService } from './tee.service';
import { AlibabaCloudSgxAdapter } from './adapters/alibaba-cloud-sgx.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([TeeComputation])],
  controllers: [TeeController],
  providers: [TeeService, AlibabaCloudSgxAdapter],
  exports: [TeeService],
})
export class TeeModule {}
