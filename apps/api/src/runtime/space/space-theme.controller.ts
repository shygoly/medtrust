import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { SpaceBranding } from "@medtrust/database";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { SpaceThemeService } from "./space-theme.service";

/** 空间主题（P7.2）。读开放给登录用户；写限 operator。 */
@ApiTags("spaces")
@ApiBearerAuth()
@Controller("spaces")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
export class SpaceThemeController {
  constructor(private readonly theme: SpaceThemeService) {}

  @Get(":spaceId/theme")
  resolve(@Param("spaceId") spaceId: string) {
    return this.theme.resolve(spaceId);
  }

  @Put(":spaceId/theme")
  @ParticipantRoles("operator")
  update(
    @Param("spaceId") spaceId: string,
    @Body() body: SpaceBranding,
    @Request() req: any,
  ) {
    return this.theme.update(spaceId, body, req?.user?.email);
  }
}
