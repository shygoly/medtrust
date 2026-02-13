import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComputeTask, ComputeTaskStatus } from '@medtrust/database';
import { FlowerClientService } from './flower-client.service';
import { FlowerConfigService } from './flower-config.service';
import {
  FLTaskConfig,
  FLTaskResponse,
  FLTaskStatusResponse,
  FLTaskResultResponse,
  FLTaskStatus,
  FLAlgorithmType,
} from './types';

/**
 * Flower Task Service
 * Manages FL task lifecycle and integration with ComputeTask
 */
@Injectable()
export class FlowerTaskService {
  private readonly logger = new Logger(FlowerTaskService.name);

  constructor(
    private flowerClient: FlowerClientService,
    private flowerConfig: FlowerConfigService,
    @InjectRepository(ComputeTask)
    private computeTaskRepository: Repository<ComputeTask>,
  ) {}

  /**
   * Submit FL task to Flower server and create ComputeTask
   */
  async submitFLTask(
    tenantId: number,
    config: FLTaskConfig,
    name?: string,
    description?: string,
  ): Promise<{ computeTask: ComputeTask; flResponse: FLTaskResponse }> {
    this.logger.log(`Submitting FL task for tenant ${tenantId}`);

    // Submit to Flower server
    const flResponse = await this.flowerClient.submitTask(config);

    // Create ComputeTask record
    const computeTask = this.computeTaskRepository.create({
      tenantId,
      name: name || `FL Task ${flResponse.taskId}`,
      description: description || `Federated Learning Task: ${config.taskType} with ${config.modelType}`,
      method: 'fl' as any, // ComputeMethod.FL
      status: this.mapFLStatusToComputeStatus(flResponse.status),
      algorithmId: config.aggregationConfig?.strategy || FLAlgorithmType.FEDAVG,
      algorithmParams: {
        ...config.trainingConfig,
        aggregationConfig: config.aggregationConfig,
      },
      dataAssets: config.datasetConfig.dataAssetIds,
    });

    const savedTask = await this.computeTaskRepository.save(computeTask);

    // Store Flower task ID mapping (could be stored in a separate entity)
    this.logger.log(`Created ComputeTask ${savedTask.id} for Flower task ${flResponse.taskId}`);

    return { computeTask: savedTask, flResponse };
  }

  /**
   * Get task status from Flower and update local record
   */
  async getTaskStatus(computeTaskId: number): Promise<{
    computeTask: ComputeTask;
    flStatus: FLTaskStatusResponse;
  }> {
    const computeTask = await this.computeTaskRepository.findOne({
      where: { id: computeTaskId },
    });

    if (!computeTask) {
      throw new NotFoundException(`Compute task #${computeTaskId} not found`);
    }

    // Get Flower task ID from stored mapping (simplified - should use separate entity)
    const flowerTaskId = this.getFlowerTaskId(computeTask);

    if (!flowerTaskId) {
      throw new BadRequestException(`Task #${computeTaskId} is not associated with a Flower task`);
    }

    // Query Flower server
    const flStatus = await this.flowerClient.getTaskStatus(flowerTaskId);

    // Update local status if changed
    const newStatus = this.mapFLStatusToComputeStatus(flStatus.status);
    if (computeTask.status !== newStatus) {
      computeTask.status = newStatus;

      if (flStatus.startedAt && !computeTask.startedAt) {
        computeTask.startedAt = new Date(flStatus.startedAt);
      }

      if (flStatus.completedAt) {
        computeTask.completedAt = new Date(flStatus.completedAt);
      }

      if (flStatus.errorMessage) {
        computeTask.errorMessage = flStatus.errorMessage;
      }

      // Store progress in result summary
      if (flStatus.progress) {
        computeTask.resultSummary = {
          ...computeTask.resultSummary,
          progress: flStatus.progress,
        };
      }

      await this.computeTaskRepository.save(computeTask);
    }

    return { computeTask, flStatus };
  }

  /**
   * Get task result from Flower and update local record
   */
  async getTaskResult(computeTaskId: number): Promise<{
    computeTask: ComputeTask;
    flResult: FLTaskResultResponse;
  }> {
    const computeTask = await this.computeTaskRepository.findOne({
      where: { id: computeTaskId },
    });

    if (!computeTask) {
      throw new NotFoundException(`Compute task #${computeTaskId} not found`);
    }

    const flowerTaskId = this.getFlowerTaskId(computeTask);

    if (!flowerTaskId) {
      throw new BadRequestException(`Task #${computeTaskId} is not associated with a Flower task`);
    }

    // Get result from Flower
    const flResult = await this.flowerClient.getTaskResult(flowerTaskId);

    // Update local record
    const newStatus = this.mapFLStatusToComputeStatus(flResult.status);
    computeTask.status = newStatus;
    computeTask.resultSummary = {
      ...computeTask.resultSummary,
      metrics: flResult.metrics,
      modelArtifacts: flResult.modelArtifacts,
    };

    if (flResult.completedAt) {
      computeTask.completedAt = new Date(flResult.completedAt);
    }

    if (flResult.errorMessage) {
      computeTask.errorMessage = flResult.errorMessage;
    }

    // Store model URL if available
    if (flResult.modelArtifacts?.modelUrl) {
      computeTask.resultPath = flResult.modelArtifacts.modelUrl;
    }

    await this.computeTaskRepository.save(computeTask);

    return { computeTask, flResult };
  }

  /**
   * Cancel running task
   */
  async cancelTask(computeTaskId: number): Promise<{ computeTask: ComputeTask; message: string }> {
    const computeTask = await this.computeTaskRepository.findOne({
      where: { id: computeTaskId },
    });

    if (!computeTask) {
      throw new NotFoundException(`Compute task #${computeTaskId} not found`);
    }

    // Check if task can be cancelled
    if (![ComputeTaskStatus.PENDING, ComputeTaskStatus.RUNNING].includes(computeTask.status as any)) {
      throw new BadRequestException(`Task #${computeTaskId} cannot be cancelled (status: ${computeTask.status})`);
    }

    const flowerTaskId = this.getFlowerTaskId(computeTask);

    if (flowerTaskId) {
      // Cancel on Flower server
      const result = await this.flowerClient.cancelTask(flowerTaskId);

      // Update local status
      computeTask.status = ComputeTaskStatus.CANCELLED;
      computeTask.completedAt = new Date();
      await this.computeTaskRepository.save(computeTask);

      return { computeTask, message: result.message };
    } else {
      // Just update local status
      computeTask.status = ComputeTaskStatus.CANCELLED;
      computeTask.completedAt = new Date();
      await this.computeTaskRepository.save(computeTask);

      return { computeTask, message: 'Task cancelled locally' };
    }
  }

  /**
   * Update task status from webhook notification
   */
  async updateTaskFromWebhook(
    flowerTaskId: string,
    status: FLTaskStatus,
    data?: any,
  ): Promise<ComputeTask | null> {
    // Find compute task by Flower task ID (simplified - should use separate entity)
    const computeTask = await this.computeTaskRepository.findOne({
      where: { resultPath: flowerTaskId }, // Using resultPath as temporary storage
    });

    if (!computeTask) {
      this.logger.warn(`ComputeTask not found for Flower task ${flowerTaskId}`);
      return null;
    }

    computeTask.status = this.mapFLStatusToComputeStatus(status);

    if (data?.progress) {
      computeTask.resultSummary = {
        ...computeTask.resultSummary,
        progress: data.progress,
      };
    }

    if (data?.errorMessage) {
      computeTask.errorMessage = data.errorMessage;
    }

    if ([FLTaskStatus.COMPLETED, FLTaskStatus.FAILED, FLTaskStatus.CANCELLED].includes(status)) {
      computeTask.completedAt = new Date();
    }

    return this.computeTaskRepository.save(computeTask);
  }

  /**
   * Map FL task status to ComputeTask status
   */
  private mapFLStatusToComputeStatus(flStatus: FLTaskStatus): ComputeTaskStatus {
    switch (flStatus) {
      case FLTaskStatus.PENDING:
      case FLTaskStatus.QUEUED:
        return ComputeTaskStatus.PENDING;
      case FLTaskStatus.RUNNING:
        return ComputeTaskStatus.RUNNING;
      case FLTaskStatus.COMPLETED:
        return ComputeTaskStatus.COMPLETED;
      case FLTaskStatus.FAILED:
        return ComputeTaskStatus.FAILED;
      case FLTaskStatus.CANCELLED:
        return ComputeTaskStatus.CANCELLED;
      default:
        return ComputeTaskStatus.PENDING;
    }
  }

  /**
   * Get Flower task ID from ComputeTask
   * This is a simplified implementation - should use a separate FlowerTask entity
   */
  private getFlowerTaskId(computeTask: ComputeTask): string | null {
    // Store Flower task ID in resultSummary or a separate mapping table
    if (computeTask.resultSummary?.flowerTaskId) {
      return computeTask.resultSummary.flowerTaskId;
    }
    // For now, return null if not found
    return null;
  }

  /**
   * Store Flower task ID mapping
   */
  async storeFlowerTaskMapping(computeTaskId: number, flowerTaskId: string): Promise<void> {
    const computeTask = await this.computeTaskRepository.findOne({
      where: { id: computeTaskId },
    });

    if (computeTask) {
      computeTask.resultSummary = {
        ...computeTask.resultSummary,
        flowerTaskId,
      };
      await this.computeTaskRepository.save(computeTask);
    }
  }
}
