import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { CatalogService } from "./catalog.service";
import { PublishDataProductDto } from "./dto/publish-data-product.dto";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";

// 新控制面目录端点。前端将从旧 /data-assets 切到这里(8.1 切换前置)。
@ApiTags("catalog")
@ApiBearerAuth()
@Controller("catalog")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list() {
    return this.catalog.list();
  }

  // 仅数据提供方可发布数据产品
  @Post()
  @ParticipantRoles("provider")
  publish(@Body() dto: PublishDataProductDto) {
    return this.catalog.publish(dto);
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const product = await this.catalog.get(id);
    if (!product) throw new NotFoundException("数据产品不存在");
    return product;
  }
}
