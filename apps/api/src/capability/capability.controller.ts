import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { LayerKind } from "@medtrust/database";
import { CapabilityRegistryService } from "./registry.service";
import { UpsertCapabilityObjectDto } from "./dto/upsert-capability-object.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../auth/participant-roles.guard";
import { ParticipantRoles } from "../auth/participant-role.decorator";

// 能力注册表(知识库后台 / 任务设计的数据源)。读开放;写(L1/L3-L7 系统对象 CRUD)
// 仅平台运营方(operator)。L2 规则层只读,不在此 CRUD。全局前缀 /api/v1。
@Controller("capability")
export class CapabilityController {
  constructor(private readonly registry: CapabilityRegistryService) {}

  @Get(":layer")
  list(@Param("layer") layer: LayerKind) {
    return this.registry.list(layer);
  }

  @Get(":layer/:key")
  get(@Param("layer") layer: LayerKind, @Param("key") key: string) {
    return this.registry.get(layer, key);
  }

  @Post(":layer")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator")
  create(
    @Param("layer") layer: LayerKind,
    @Body() dto: UpsertCapabilityObjectDto,
  ) {
    return this.registry.create(layer, dto as Record<string, unknown>);
  }

  @Patch(":layer/:key")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator")
  update(
    @Param("layer") layer: LayerKind,
    @Param("key") key: string,
    @Body() dto: UpsertCapabilityObjectDto,
  ) {
    return this.registry.update(layer, key, dto as Record<string, unknown>);
  }

  @Delete(":layer/:key")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator")
  remove(@Param("layer") layer: LayerKind, @Param("key") key: string) {
    return this.registry.remove(layer, key);
  }
}
