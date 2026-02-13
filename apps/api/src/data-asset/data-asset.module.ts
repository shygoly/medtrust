import { Module } from '@nestjs/common';
import { DataAssetService } from './data-asset.service';
import { DataAssetController } from './data-asset.controller';

@Module({
  controllers: [DataAssetController],
  providers: [DataAssetService],
  exports: [DataAssetService],
})
export class DataAssetModule {}
