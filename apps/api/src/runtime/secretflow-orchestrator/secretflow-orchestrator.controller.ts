import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { OrchestrateSecretFlowTaskDto } from "./dto/orchestrate-secretflow-task.dto";
import { SecretFlowOrchestratorService } from "./secretflow-orchestrator.service";

@ApiTags("secretflow-orchestrator")
@Controller("secretflow")
export class SecretFlowOrchestratorController {
  constructor(private readonly orchestrator: SecretFlowOrchestratorService) {}

  @Post("preview")
  @ApiOperation({
    summary:
      "Validate + plan + transpile a SecretFlow task without dispatching.",
  })
  preview(@Body() body: OrchestrateSecretFlowTaskDto) {
    return this.orchestrator.preview(body);
  }

  @Post("tasks")
  @ApiOperation({
    summary:
      "Dispatch a SecretFlow federated training task: 轮次任务经连接器长轮询下发(控制面不直连 agent)",
  })
  async orchestrate(@Body() body: OrchestrateSecretFlowTaskDto) {
    const record = await this.orchestrator.orchestrate(body);
    return {
      taskId: record.taskId,
      state: record.state,
      nodePlan: record.nodePlan,
      contractRefs: record.contractRefs,
      // 日志经 /ws/secretflow 推给前端;控制面不再连入 agent,故无 taskStreamUrl
      transpiledPayload: record.transpiledPayload,
    };
  }

  @Get("tasks")
  @ApiOperation({ summary: "List SecretFlow orchestrations." })
  list() {
    return this.orchestrator.list().map((r) => ({
      taskId: r.taskId,
      state: r.state,
      lastLoss: r.lastLoss,
      currentEpoch: r.currentEpoch,
      droppedParties: r.droppedParties,
      purpose: r.spec.purpose,
      createdAt: r.history[0]?.at ?? "",
      consumerId:
        r.spec.parties.find((p) => p.role === "consumer")?.participantId ?? "",
      providerCount: r.spec.parties.filter((p) => p.role === "provider").length,
    }));
  }

  @Get("tasks/:taskId")
  @ApiOperation({ summary: "Get the FSM status of one orchestration." })
  status(@Param("taskId") taskId: string) {
    return this.orchestrator.status(taskId);
  }

  @Get("tasks/:taskId/result")
  @ApiOperation({
    summary: "Get the output-gated result of one orchestration.",
  })
  result(@Param("taskId") taskId: string) {
    return this.orchestrator.result(taskId);
  }

  @Get("tasks/:taskId/settlement")
  @ApiOperation({
    summary: "Get the contribution-weighted settlement for one orchestration.",
  })
  settlement(@Param("taskId") taskId: string) {
    return this.orchestrator.status(taskId).settlement ?? null;
  }

  @Get("tasks/:taskId/deliverables/lora-adapter")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Download SM2-envelope encrypted federated LoRA adapter (consumer or operator).",
  })
  downloadLoraAdapter(
    @Param("taskId") taskId: string,
    @Request() req: { user: { role?: string; participantId?: string } },
  ) {
    return this.orchestrator.downloadLoraDeliverable(taskId, req.user);
  }

  @Post("tasks/:taskId/deliverables/lora-adapter/verify-demo")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Demo pharma-side SM2/SM4 decrypt + loraDeltaHash verification (consumer or operator).",
  })
  verifyDemoLoraAdapter(
    @Param("taskId") taskId: string,
    @Request() req: { user: { role?: string; participantId?: string } },
  ) {
    return this.orchestrator.verifyDemoLoraDeliverable(taskId, req.user);
  }
}
