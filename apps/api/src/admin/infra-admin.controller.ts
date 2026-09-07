import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../auth/participant-roles.guard";
import { ParticipantRoles } from "../auth/participant-role.decorator";
import { InfraAdminService } from "./infra-admin.service";
import { CreateAppDto } from "./dto/create-app.dto";

// P2-6:平台管理员基础设施管理端点。全部 admin 门禁。
// 注:空间的创建/删除保持唯一入口 /spaces(operator 门禁,INV-SPACE-01);
// 此处空间仅只读展示,避免双入口角色口径冲突。
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/infra")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
@ParticipantRoles("admin")
export class InfraAdminController {
  constructor(private readonly infra: InfraAdminService) {}

  @Get("spaces")
  @ApiOperation({ summary: "空间列表(只读)" })
  spaces() {
    return this.infra.listSpaces();
  }

  @Get("certificates")
  @ApiOperation({ summary: "证书注册表" })
  certificates() {
    return this.infra.listCertificates();
  }

  @Post("certificates/:fingerprint/revoke")
  @ApiOperation({ summary: "吊销证书" })
  revokeCertificate(@Param("fingerprint") fingerprint: string) {
    return this.infra.revokeCertificate(fingerprint);
  }

  @Get("ca/info")
  @ApiOperation({ summary: "CA 信息(公钥/签发量/吊销量,不含私钥)" })
  caInfo() {
    return this.infra.caInfo();
  }

  @Get("open-platform/apps")
  @ApiOperation({ summary: "开放平台应用列表" })
  apps() {
    return this.infra.listApps();
  }

  @Post("open-platform/apps")
  @ApiOperation({ summary: "创建开放平台应用(密钥仅返回一次)" })
  createApp(@Body() dto: CreateAppDto) {
    return this.infra.createApp(dto);
  }

  @Post("open-platform/apps/:id/revoke")
  @ApiOperation({ summary: "吊销开放平台应用" })
  revokeApp(@Param("id") id: string) {
    return this.infra.revokeApp(id);
  }
}
