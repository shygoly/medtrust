import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { FederatedLearningJob } from '@medtrust/database';
import { FederatedLearningController } from './fl.controller';
import { FederatedLearningService } from './fl.service';
import { FateFlowAdapter } from './adapters/fate-flow.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([FederatedLearningJob]),
    HttpModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [FederatedLearningController],
  providers: [FederatedLearningService, FateFlowAdapter],
  exports: [FederatedLearningService],
})
export class FederatedLearningModule {}
