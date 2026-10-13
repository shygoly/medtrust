import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { SPACE_ID } from "@medtrust/demo-scenario";
import { SpaceService } from "./space.service";
import { CreateSpaceDto } from "./dto/create-space.dto";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { SpaceAccessGuard } from "./space-access.guard";
import { SpaceMembershipService } from "./space-membership.service";

// 空间基础管理端点(6.5)。创建/删除仅 operator;查询对所有登录角色开放。
@ApiTags("spaces")
@ApiBearerAuth()
@Controller("spaces")
@UseGuards(JwtAuthGuard, SpaceAccessGuard, ParticipantRolesGuard)
export class SpaceController {
  constructor(
    private readonly spaces: SpaceService,
    private readonly membership: SpaceMembershipService,
  ) {}

  @Get()
  async list(
    @Request()
    req: {
      user?: { userId?: number | string; participantId?: string };
    },
  ) {
    const spaces = await this.spaces.list();
    const allowed = await this.visibleSpaceIds(req.user);
    return spaces.filter((space) => allowed.includes(space.id));
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

  private async visibleSpaceIds(user?: {
    userId?: number | string;
    participantId?: string;
  }): Promise<string[]> {
    const ids = new Set<string>();
    if (user?.participantId) {
      for (const id of await this.membership.spacesOfSubject(
        "org",
        user.participantId,
      )) {
        ids.add(id);
      }
    }
    if (user?.userId != null && String(user.userId) !== "") {
      for (const id of await this.membership.spacesOfSubject(
        "user",
        String(user.userId),
      )) {
        ids.add(id);
      }
    }
    if (ids.size === 0) ids.add(SPACE_ID);
    return [...ids];
  }
}
