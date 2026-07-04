import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { OrchestrateSecretFlowTaskDto } from './dto/orchestrate-secretflow-task.dto';
import { SecretFlowOrchestratorService } from './secretflow-orchestrator.service';

@ApiTags('secretflow-orchestrator')
@Controller('secretflow')
export class SecretFlowOrchestratorController {
  constructor(private readonly orchestrator: SecretFlowOrchestratorService) {}

  @Post('preview')
  @ApiOperation({
    summary: 'Validate + plan + transpile a SecretFlow task without dispatching.',
  })
  preview(@Body() body: OrchestrateSecretFlowTaskDto) {
    return this.orchestrator.preview(body);
  }

  @Post('tasks')
  @ApiOperation({ summary: 'Dispatch a SecretFlow federated training task to local agents.' })
  async orchestrate(@Body() body: OrchestrateSecretFlowTaskDto) {
    const record = await this.orchestrator.orchestrate(body);
    return {
      taskId: record.taskId,
      state: record.state,
      nodePlan: record.nodePlan,
      contractRefs: record.contractRefs,
      taskStreamUrl: record.taskStreamUrl,
      transpiledPayload: record.transpiledPayload,
    };
  }

  @Get('tasks')
  @ApiOperation({ summary: 'List SecretFlow orchestrations.' })
  list() {
    return this.orchestrator.list().map((r) => ({
      taskId: r.taskId,
      state: r.state,
      lastLoss: r.lastLoss,
      currentEpoch: r.currentEpoch,
      droppedParties: r.droppedParties,
    }));
  }

  @Get('tasks/:taskId')
  @ApiOperation({ summary: 'Get the FSM status of one orchestration.' })
  status(@Param('taskId') taskId: string) {
    return this.orchestrator.status(taskId);
  }

  @Get('tasks/:taskId/result')
  @ApiOperation({ summary: 'Get the output-gated result of one orchestration.' })
  result(@Param('taskId') taskId: string) {
    return this.orchestrator.result(taskId);
  }

  @Get('tasks/:taskId/settlement')
  @ApiOperation({ summary: 'Get the contribution-weighted settlement for one orchestration.' })
  settlement(@Param('taskId') taskId: string) {
    return this.orchestrator.status(taskId).settlement ?? null;
  }

  @Get('tasks/:taskId/deliverables/lora-adapter')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Download SM2-envelope encrypted federated LoRA adapter (consumer or operator).',
  })
  downloadLoraAdapter(@Param('taskId') taskId: string, @Request() req: { user: { role?: string; participantId?: string } }) {
    return this.orchestrator.downloadLoraDeliverable(taskId, req.user);
  }
}
