import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { CatalogService } from "./catalog.service";
import { PublishDataProductDto } from "./dto/publish-data-product.dto";
import { UpdateDataProductDto } from "./dto/update-data-product.dto";
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

  // 目录查询可按类型过滤:data=数据产品 / service=数据服务(P0-2)。
  // includeArchived=true 时返回已下架产品(运营审计用)。
  @Get()
  list(
    @Query("type") type?: "data" | "service",
    @Query("includeArchived") includeArchived?: string,
  ) {
    return this.catalog.list(type, includeArchived === "true");
  }

  // 仅数据提供方可发布数据产品
  @Post()
  @ParticipantRoles("provider")
  publish(@Body() dto: PublishDataProductDto) {
    return this.catalog.publish(dto);
  }

  // P1-1:数据产品更新
  @Put(":id")
  @ParticipantRoles("provider")
  update(@Param("id") id: string, @Body() dto: UpdateDataProductDto) {
    return this.catalog.update(id, dto);
  }

  // P1-1:数据产品下架(软删 archived;存量合约不受影响)
  @Post(":id/archive")
  @ParticipantRoles("provider")
  archive(@Param("id") id: string) {
    return this.catalog.archive(id);
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const product = await this.catalog.get(id);
    if (!product) throw new NotFoundException("数据产品不存在");
    return product;
  }
}
