import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { SilkRoadService } from "./silk-road.service";

// P2-2:丝路数港区域节点互认。operator/admin 触发同步与上报;
// 登录用户可按 USCC 检索已同步主体并带入机构认证。
@ApiTags("interop")
@ApiBearerAuth()
@Controller()
export class SilkRoadController {
  constructor(private readonly silkRoadService: SilkRoadService) {}

  // ---- 运营/管理侧 ----
  @Post("admin/interop/silk-road/sync")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator", "admin")
  @ApiOperation({ summary: "从丝路数港同步注册主体(P2-2 身份互认)" })
  sync() {
    return this.silkRoadService.syncSubjects();
  }

  @Get("admin/interop/silk-road/subjects")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator", "admin")
  @ApiOperation({ summary: "查看已同步的丝路数港主体" })
  list(@Query("search") search?: string) {
    return this.silkRoadService.listSubjects(search);
  }

  @Post("admin/interop/silk-road/push-catalog")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator", "admin")
  @ApiOperation({ summary: "推送本空间数据产品目录到丝路数港(P2-2 目录同步)" })
  pushCatalog() {
    return this.silkRoadService.pushCatalog();
  }

  @Post("admin/interop/silk-road/report-audit")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator", "admin")
  @ApiOperation({ summary: "上报审计摘要到丝路数港(P2-2 日志上报)" })
  reportAudit(@Request() req: any) {
    return this.silkRoadService.reportAudit(req.user.tenantId);
  }

  // ---- 用户侧 ----
  @Get("account/interop/silk-road/subjects")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "检索已同步的丝路数港主体(按 USCC/名称)" })
  search(@Query("uscc") uscc?: string) {
    return this.silkRoadService.listSubjects(uscc);
  }

  @Post("account/interop/silk-road/subjects/:subjectId/import")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "将丝路数港主体带入机构认证(P2-2)" })
  import(@Request() req: any, @Param("subjectId") subjectId: string) {
    return this.silkRoadService.importSubjectToCertification(
      req.user.userId,
      subjectId,
    );
  }
}
