import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataProduct } from '@medtrust/database';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

// 目录管理(数据产品元数据)。替代旧 data-asset 的元数据职责。
// 持久化到 control-plane 连接(D7 物理隔离)。
@Module({
  imports: [TypeOrmModule.forFeature([DataProduct], 'controlplane')],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
