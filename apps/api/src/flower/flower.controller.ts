import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Logger,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FlowerTaskService } from './flower-task.service';
import { FlowerMonitorService } from './flower-monitor.service';
import { FlowerClientService } from './flower-client.service';
import { FlowerConfigService } from './flower-config.service';
import { FlowerErrorHandler } from './flower-error.handler';
import {
  SubmitFLTaskDto,
  FLTaskResponseDto,
  FLTaskStatusDto,
  FLTaskResultDto,
  UpdateFLTaskDto,
} from './dto';
import { FLTaskConfig } from './types';

@ApiTags('flower')
@Controller('api/v1/flower')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FlowerController {
  private readonly logger = new Logger(FlowerController.name);

  constructor(
    private readonly flowerTaskService: FlowerTaskService,
    private readonly flowerMonitorService: FlowerMonitorService,
    private readonly flowerClient: FlowerClientService,
    private readonly flowerConfig: FlowerConfigService,
    private readonly errorHandler: FlowerErrorHandler,
  ) {}

  /**
   * Submit a new FL task
   * POST /api/v1/flower/tasks
   */
  @Post('tasks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '提交联邦学习任务',
    description: '创建并提交一个新的联邦学习任务到 Flower 服务器',
  })
  @ApiResponse({
    status: 201,
    description: '任务创建成功',
    type: FLTaskResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '请求参数错误',
  })
  @ApiResponse({
    status: 503,
    description: 'Flower 服务器不可用',
  })
  async submitTask(
    @Body() submitDto: SubmitFLTaskDto,
    @Request() req,
  ): Promise<FLTaskResponseDto> {
    this.logger.log(`Received FL task submission from tenant ${req.user.tenantId}`);

    try {
      const config: FLTaskConfig = {
        taskType: submitDto.taskType,
        modelType: submitDto.modelType,
        datasetConfig: submitDto.datasetConfig,
        trainingConfig: submitDto.trainingConfig,
        aggregationConfig: submitDto.aggregationConfig,
      };

      const { computeTask, flResponse } = await this.flowerTaskService.submitFLTask(
        req.user.tenantId,
        config,
        submitDto.name,
        submitDto.description,
      );

      // Store Flower task ID mapping
      await this.flowerTaskService.storeFlowerTaskMapping(computeTask.id, flResponse.taskId);

      return {
        taskId: String(computeTask.id),
        status: flResponse.status,
        message: flResponse.message,
        submittedAt: flResponse.submittedAt,
        flowerTaskId: flResponse.taskId,
      };
    } catch (error) {
      throw this.errorHandler.handleClientError(error, 'submitTask');
    }
  }

  /**
   * Get task status
   * GET /api/v1/flower/tasks/:id/status
   */
  @Get('tasks/:id/status')
  @ApiOperation({
    summary: '查询联邦学习任务状态',
    description: '获取指定任务的当前执行状态和进度',
  })
  @ApiParam({
    name: 'id',
    description: '计算任务 ID',
    example: '123',
  })
  @ApiResponse({
    status: 200,
    description: '查询成功',
    type: FLTaskStatusDto,
  })
  @ApiResponse({
    status: 404,
    description: '任务不存在',
  })
  async getTaskStatus(@Param('id') id: string): Promise<FLTaskStatusDto> {
    this.logger.debug(`Querying status for task: ${id}`);

    try {
      const { computeTask, flStatus } = await this.flowerTaskService.getTaskStatus(parseInt(id));

      return {
        taskId: String(computeTask.id),
        status: flStatus.status,
        progress: flStatus.progress,
        startedAt: flStatus.startedAt,
        completedAt: flStatus.completedAt,
        errorMessage: flStatus.errorMessage,
      };
    } catch (error) {
      throw this.errorHandler.handleClientError(error, 'getTaskStatus');
    }
  }

  /**
   * Get task result
   * GET /api/v1/flower/tasks/:id/result
   */
  @Get('tasks/:id/result')
  @ApiOperation({
    summary: '获取联邦学习任务结果',
    description: '获取已完成任务的训练结果、模型指标和模型文件',
  })
  @ApiParam({
    name: 'id',
    description: '计算任务 ID',
    example: '123',
  })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    type: FLTaskResultDto,
  })
  @ApiResponse({
    status: 404,
    description: '任务不存在',
  })
  @ApiResponse({
    status: 409,
    description: '任务尚未完成',
  })
  async getTaskResult(@Param('id') id: string): Promise<FLTaskResultDto> {
    this.logger.debug(`Fetching result for task: ${id}`);

    try {
      const { flResult } = await this.flowerTaskService.getTaskResult(parseInt(id));

      return {
        taskId: id,
        status: flResult.status,
        metrics: flResult.metrics,
        modelArtifacts: flResult.modelArtifacts,
        completedAt: flResult.completedAt,
        errorMessage: flResult.errorMessage,
      };
    } catch (error) {
      throw this.errorHandler.handleClientError(error, 'getTaskResult');
    }
  }

  /**
   * Cancel task
   * POST /api/v1/flower/tasks/:id/cancel
   */
  @Post('tasks/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '取消联邦学习任务',
    description: '取消正在运行或排队中的联邦学习任务',
  })
  @ApiParam({
    name: 'id',
    description: '计算任务 ID',
    example: '123',
  })
  @ApiResponse({
    status: 200,
    description: '取消成功',
  })
  @ApiResponse({
    status: 404,
    description: '任务不存在',
  })
  @ApiResponse({
    status: 409,
    description: '任务无法取消（可能已完成或已失败）',
  })
  async cancelTask(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Cancelling task: ${id}`);

    try {
      const result = await this.flowerTaskService.cancelTask(parseInt(id));
      return { success: true, message: result.message };
    } catch (error) {
      throw this.errorHandler.handleClientError(error, 'cancelTask');
    }
  }

  /**
   * Get Flower health status
   * GET /api/v1/flower/health
   */
  @Get('health')
  @ApiOperation({
    summary: '检查 Flower 服务器状态',
    description: '检查 Flower 联邦学习服务器的健康状态和可用性',
  })
  @ApiResponse({
    status: 200,
    description: '健康检查完成',
  })
  async getHealth(): Promise<any> {
    this.logger.debug('Checking Flower health');

    try {
      const serverHealth = this.flowerMonitorService.getAllServersHealth();
      const connectionPool = this.flowerClient.getConnectionPool();
      const healthyServers = this.flowerMonitorService.getHealthyServers();

      return {
        servers: serverHealth,
        connectionPool,
        healthyServers,
        totalServers: serverHealth.length,
      };
    } catch (error) {
      throw this.errorHandler.handleClientError(error, 'getHealth');
    }
  }

  /**
   * Update task (webhook callback internal use)
   * PATCH /api/v1/flower/tasks/:id
   */
  @Post('tasks/:id/update')
  @ApiOperation({
    summary: '更新任务状态（内部使用）',
    description: '从 Flower 服务器接收任务状态更新',
  })
  async updateTask(
    @Param('id') id: string,
    @Body() updateDto: UpdateFLTaskDto,
  ): Promise<any> {
    this.logger.debug(`Updating task ${id}: ${JSON.stringify(updateDto)}`);

    // This endpoint is for internal use by webhook handler
    return { taskId: id, updated: true };
  }
}
