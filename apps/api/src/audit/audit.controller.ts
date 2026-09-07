import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../auth/participant-roles.guard";
import { ParticipantRoles } from "../auth/participant-role.decorator";
import { AuditService } from "./audit.service";
import { EvidencePackageService } from "./evidence-package.service";
import { CreateAuditLogDto } from "./dto/create-audit-log.dto";
import { AuditAction } from "@medtrust/database";

@ApiTags("audit")
@Controller("audit")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly evidencePackageService: EvidencePackageService,
  ) {}

  @Post()
  @ApiOperation({ summary: "创建审计日志" })
  create(@Body() createDto: CreateAuditLogDto, @Request() req) {
    return this.auditService.create(
      req.user.userId,
      req.user.tenantId,
      createDto,
      req.ip,
      req.headers["user-agent"],
    );
  }

  @Get()
  @ParticipantRoles("compliance", "operator")
  @ApiOperation({ summary: "获取审计日志列表" })
  findAll(
    @Request() req,
    @Query("action") action?: AuditAction,
    @Query("resource") resource?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.auditService.findAll({
      tenantId: req.user.tenantId,
      action,
      resource,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });
  }

  // P1-5:审计日志防篡改完整性校验(重算 SM3 链比对)
  @Get("integrity")
  @ParticipantRoles("compliance", "operator")
  @ApiOperation({ summary: "校验审计日志链完整性" })
  integrity(@Request() req) {
    return this.auditService.verifyIntegrity(req.user.tenantId);
  }

  @Get("export")
  @ParticipantRoles("compliance", "operator")
  @ApiOperation({ summary: "导出审计报告(JSON + SM3 链校验结论,P2-5)" })
  exportReport(
    @Request() req,
    @Query("action") action?: AuditAction,
    @Query("resource") resource?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.auditService.exportReport({
      tenantId: req.user.tenantId,
      action,
      resource,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit) : 200,
      offset: offset ? parseInt(offset) : 0,
    });
  }

  @Get("evidence-package")
  @ParticipantRoles("compliance", "operator")
  @ApiOperation({
    summary: "导出审计证据包(ZIP,含报告/存证/合约/manifest,P2-5)",
  })
  async evidencePackage(
    @Request() req,
    @Res() res: any,
    @Query("action") action?: AuditAction,
    @Query("resource") resource?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("limit") limit?: string,
  ) {
    const pkg = await this.evidencePackageService.build({
      tenantId: req.user.tenantId,
      action,
      resource,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit) : 200,
    });
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="medtrust-evidence-${Date.now()}.zip"`,
      "X-Evidence-Fingerprint": pkg.fingerprint,
    });
    res.send(pkg.zip);
  }

  @Get("by-user")
  @ApiOperation({ summary: "获取当前用户的审计日志" })
  findByUser(@Request() req, @Query("limit") limit?: string) {
    return this.auditService.findByUser(
      req.user.userId,
      limit ? parseInt(limit) : 50,
    );
  }

  @Get("stats")
  @ParticipantRoles("compliance", "operator")
  @ApiOperation({ summary: "获取审计统计" })
  getStats(@Request() req) {
    return this.auditService.getStats(req.user.tenantId);
  }
}
