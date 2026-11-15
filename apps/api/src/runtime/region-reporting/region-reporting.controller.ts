import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { RegionReportingService } from "./region-reporting.service";

@ApiTags("interop")
@ApiBearerAuth()
@Controller("admin/interop/region-reporting")
export class RegionReportingController {
  constructor(private readonly reporting: RegionReportingService) {}

  @Get("status")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator", "admin")
  @ApiOperation({
    summary:
      "区域节点状态上报状态（未配置时为 unconfigured，不得表述为已上报）",
  })
  status() {
    return this.reporting.status();
  }

  @Get("snapshot")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator", "admin")
  @ApiOperation({
    summary:
      "连接器状态聚合快照（与上报告共用同一构造；含平台状态、空间标识与连接器快照）",
  })
  snapshot() {
    return this.reporting.adminView();
  }

  @Post("report")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator", "admin")
  @ApiOperation({
    summary: "立即上报一次连接器状态（失败不影响主链路；忽略退避窗口）",
  })
  report() {
    return this.reporting.reportNow(true);
  }
}
