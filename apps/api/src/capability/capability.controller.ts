import { Controller, Get, Param } from '@nestjs/common';
import { LayerKind } from '@medtrust/database';
import { CapabilityRegistryService } from './registry.service';

// 只读能力注册表(知识库后台 / 任务设计的数据源)。全局前缀 /api/v1 在 main.ts 设置。
@Controller('capability')
export class CapabilityController {
  constructor(private readonly registry: CapabilityRegistryService) {}

  @Get(':layer')
  list(@Param('layer') layer: LayerKind) {
    return this.registry.list(layer);
  }

  @Get(':layer/:key')
  get(@Param('layer') layer: LayerKind, @Param('key') key: string) {
    return this.registry.get(layer, key);
  }
}
