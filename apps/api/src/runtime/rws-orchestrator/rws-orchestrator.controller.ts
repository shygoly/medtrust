import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import {
  OrchestrateRwsTaskDto,
  ReviseRwsTaskDto,
} from "./dto/orchestrate-rws-task.dto";
import { RwsOrchestratorService } from "./rws-orchestrator.service";

@ApiTags("rws-orchestrator")
@Controller("rws")
export class RwsOrchestratorController {
  constructor(private readonly orchestrator: RwsOrchestratorService) {}

  @Post("tasks")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("consumer")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "药企发起 RWS 任务 — 校验合约后分派到各院连接器队列",
  })
  submit(
    @Body() body: OrchestrateRwsTaskDto,
    @CurrentUser("participantId") consumerId: string,
  ) {
    return this.orchestrator.submit({
      title: body.title,
      purpose: body.purpose,
      analysis: body.analysis,
      contractIds: body.contractIds,
      consumerId,
    });
  }

  @Get("tasks")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "列出 RWS 编排任务" })
  list() {
    return this.orchestrator.list();
  }

  @Get("inbox")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("provider")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "本院 RWS 任务队列 — 仅当前提供方连接器收到的分派",
  })
  inbox(@CurrentUser("participantId") providerId: string) {
    return this.orchestrator.listInbox(providerId);
  }

  @Get("tasks/:taskId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "获取 RWS 任务状态与合并聚合" })
  get(@Param("taskId") taskId: string) {
    return this.orchestrator.get(taskId);
  }

  @Post("tasks/:taskId/revise")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("consumer")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "修订 RWS 研究方案 — 新版本 + 必填修订原因 + 重新派发",
  })
  revise(
    @Param("taskId") taskId: string,
    @Body() body: ReviseRwsTaskDto,
    @CurrentUser("participantId") consumerId: string,
  ) {
    return this.orchestrator.revise(taskId, {
      analysis: body.analysis,
      revisionReason: body.revisionReason,
      contractIds: body.contractIds,
      consumerId,
    });
  }
}
