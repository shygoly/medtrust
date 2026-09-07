import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { OrchestrateFlPredictionTaskDto } from "./dto/orchestrate-fl-prediction-task.dto";
import { FlOrchestratorService } from "./fl-orchestrator.service";

@ApiTags("fl-orchestrator")
@Controller("fl-prediction")
export class FlOrchestratorController {
  constructor(private readonly orchestrator: FlOrchestratorService) {}

  @Post("tasks")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("consumer")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "消费方发起 L4 联邦预测任务 — 校验合约后分派到各院连接器",
  })
  submit(
    @Body() body: OrchestrateFlPredictionTaskDto,
    @CurrentUser("participantId") consumerId: string,
  ) {
    return this.orchestrator.submit({
      title: body.title,
      flPredictionSpec: body.flPredictionSpec,
      contractIds: body.contractIds,
      consumerId,
      computeTaskId: body.computeTaskId,
    });
  }

  @Get("tasks")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "列出 FL 预测编排任务" })
  list() {
    return this.orchestrator.list();
  }

  @Get("inbox")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("provider")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "本院 FL 任务队列 — 仅当前提供方连接器收到的分派",
  })
  inbox(@CurrentUser("participantId") providerId: string) {
    return this.orchestrator.listInbox(providerId);
  }

  @Get("tasks/:taskId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "获取 FL 预测任务状态与合并结果" })
  get(@Param("taskId") taskId: string) {
    return this.orchestrator.get(taskId);
  }

  @Get("tasks/:taskId/weight-bundle")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("consumer")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "下载 FedAvg 权重包（药企浏览器本地推理；患者特征不上送）",
  })
  getWeightBundle(
    @Param("taskId") taskId: string,
    @CurrentUser("participantId") consumerId: string,
  ) {
    return this.orchestrator.getWeightBundle(taskId, consumerId);
  }
}
