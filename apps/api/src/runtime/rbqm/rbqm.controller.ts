import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { RbqmService, IngestObservation } from "./rbqm.service";

// RBQM 中心化监查端点。读视图（定义/观测/越限）门控给合规方与运营方；
// 观测回传门控给运营方（连接器 M2M 接入为后续集成点）。
@ApiTags("rbqm")
@ApiBearerAuth()
@Controller("rbqm")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
export class RbqmController {
  constructor(private readonly rbqm: RbqmService) {}

  @Get("kris")
  @ParticipantRoles("compliance", "operator")
  @ApiOperation({ summary: "KRI 定义（含风险分层与 QTL 阈值）" })
  kris() {
    return this.rbqm.listDefinitions();
  }

  @Get("observations")
  @ParticipantRoles("compliance", "operator")
  @ApiOperation({ summary: "站点级 KRI 观测（仅聚合，无个体）" })
  observations(@Query("studyId") studyId?: string) {
    return this.rbqm.listObservations(studyId);
  }

  @Get("breaches")
  @ParticipantRoles("compliance", "operator")
  @ApiOperation({ summary: "QTL 越限清单" })
  breaches(@Query("status") status?: string) {
    return this.rbqm.listBreaches(status);
  }

  @Post("observations")
  @ParticipantRoles("operator")
  @ApiOperation({ summary: "回传站点级 KRI 聚合观测（触发越限检测与存证）" })
  ingest(@Body() body: IngestObservation) {
    return this.rbqm.ingest(body);
  }

  @Post("breaches/:id/acknowledge")
  @ParticipantRoles("compliance", "operator")
  @ApiOperation({ summary: "确认一条 QTL 越限" })
  acknowledge(@Param("id") id: string) {
    return this.rbqm.acknowledgeBreach(id);
  }
}
