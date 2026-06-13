import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { PublishDataProductDto } from './dto/publish-data-product.dto';

// 新控制面目录端点。前端将从旧 /data-assets 切到这里(8.1 切换前置)。
@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list() {
    return this.catalog.list();
  }

  @Post()
  publish(@Body() dto: PublishDataProductDto) {
    return this.catalog.publish(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const product = this.catalog.get(id);
    if (!product) throw new NotFoundException('数据产品不存在');
    return product;
  }
}
