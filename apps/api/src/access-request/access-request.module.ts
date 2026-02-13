import { Module } from '@nestjs/common';
import { AccessRequestService } from './access-request.service';
import { AccessRequestController } from './access-request.controller';

@Module({
  controllers: [AccessRequestController],
  providers: [AccessRequestService],
  exports: [AccessRequestService],
})
export class AccessRequestModule {}
