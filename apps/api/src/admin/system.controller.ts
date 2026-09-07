import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../auth/participant-roles.guard";
import { ParticipantRoles } from "../auth/participant-role.decorator";

// P2-6:平台管理员(admin)专属系统端点。与 operator 业务运营端点分离。
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/system")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
@ParticipantRoles("admin")
export class SystemController {
  @Get("status")
  @ApiOperation({ summary: "系统运行状态(仅 admin,P2-6)" })
  status() {
    return {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.round(process.uptime()),
      env: {
        NODE_ENV: process.env.NODE_ENV ?? null,
        SPACE_ID: process.env.SPACE_ID ?? null,
        SWAGGER_ENABLED: process.env.SWAGGER_ENABLED ?? null,
        SEED_DEMO_USERS: process.env.SEED_DEMO_USERS ?? null,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
