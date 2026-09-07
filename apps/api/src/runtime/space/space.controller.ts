import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { SpaceService } from "./space.service";
import { CreateSpaceDto } from "./dto/create-space.dto";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";

// 空间基础管理端点(6.5)。创建/删除仅 operator;查询对所有登录角色开放。
@ApiTags("spaces")
@ApiBearerAuth()
@Controller("spaces")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
export class SpaceController {
  constructor(private readonly spaces: SpaceService) {}

  @Get()
  list() {
    return this.spaces.list();
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const space = await this.spaces.get(id);
    if (!space) throw new NotFoundException("空间不存在");
    return space;
  }

  @Post()
  @ParticipantRoles("operator")
  create(@Body() dto: CreateSpaceDto) {
    return this.spaces.create(dto);
  }

  @Delete(":id")
  @ParticipantRoles("operator")
  async remove(@Param("id") id: string) {
    await this.spaces.remove(id);
    return { deleted: true };
  }
}
