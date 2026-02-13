import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FlowerClientService } from './flower-client.service';
import { FlowerTaskService } from './flower-task.service';
import { FLTaskResultResponse, FLTaskStatus } from './types';

/**
 * Flower Result Service
 * Handles result storage and retrieval for FL tasks
 */
@Injectable()
export class FlowerResultService {
  private readonly logger = new Logger(FlowerResultService.name);

  constructor(
    private flowerClient: FlowerClientService,
    private flowerTaskService: FlowerTaskService,
  ) {}

  /**
   * Fetch and store task result
   */
  async fetchAndStoreResult(computeTaskId: number): Promise<{
    success: boolean;
    result?: FLTaskResultResponse;
    error?: string;
  }> {
    try {
      this.logger.log(`Fetching result for task ${computeTaskId}`);

      const { computeTask, flResult } = await this.flowerTaskService.getTaskResult(computeTaskId);

      // Verify task is in a terminal state
      if (![FLTaskStatus.COMPLETED, FLTaskStatus.FAILED, FLTaskStatus.CANCELLED].includes(flResult.status)) {
        return {
          success: false,
          error: `Task is not complete (status: ${flResult.status})`,
        };
      }

      // Store model artifacts if available
      if (flResult.modelArtifacts) {
        await this.storeModelArtifacts(computeTaskId, flResult.modelArtifacts);
      }

      // Store metrics
      await this.storeMetrics(computeTaskId, flResult.metrics);

      this.logger.log(`Result stored for task ${computeTaskId}`);

      return {
        success: true,
        result: flResult,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch/store result: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Store model artifacts
   */
  private async storeModelArtifacts(
    computeTaskId: number,
    artifacts: FLTaskResultResponse['modelArtifacts'],
  ): Promise<void> {
    if (!artifacts) return;

    this.logger.log(`Storing model artifacts for task ${computeTaskId}`);

    // In a real implementation, this would:
    // 1. Download model files from artifacts.modelUrl
    // 2. Store them in persistent storage (S3, etc.)
    // 3. Update database with storage paths

    // For now, just log the artifact URLs
    this.logger.log(`Model URL: ${artifacts.modelUrl}`);
    this.logger.log(`Checkpoint URL: ${artifacts.checkpointUrl}`);
    this.logger.log(`Model size: ${artifacts.size} bytes`);
  }

  /**
   * Store metrics
   */
  private async storeMetrics(
    computeTaskId: number,
    metrics: FLTaskResultResponse['metrics'],
  ): Promise<void> {
    this.logger.log(`Storing metrics for task ${computeTaskId}`);

    // Log metrics for now
    this.logger.log(`Final loss: ${metrics.finalLoss}`);
    this.logger.log(`Final accuracy: ${metrics.finalAccuracy}`);
    this.logger.log(`Rounds completed: ${metrics.roundsCompleted}`);
    this.logger.log(`Client metrics count: ${metrics.clientMetrics.length}`);

    // In a real implementation, store detailed metrics in a metrics table
  }

  /**
   * Get stored result summary
   */
  async getResultSummary(computeTaskId: number): Promise<any> {
    const { computeTask, flResult } = await this.flowerTaskService.getTaskResult(computeTaskId);

    return {
      taskId: computeTaskId,
      status: flResult.status,
      metrics: {
        finalLoss: flResult.metrics.finalLoss,
        finalAccuracy: flResult.metrics.finalAccuracy,
        roundsCompleted: flResult.metrics.roundsCompleted,
      },
      hasModelArtifacts: !!flResult.modelArtifacts,
      completedAt: flResult.completedAt,
    };
  }

  /**
   * Export results in different formats
   */
  async exportResult(computeTaskId: number, format: 'json' | 'csv'): Promise<any> {
    const { flResult } = await this.flowerTaskService.getTaskResult(computeTaskId);

    switch (format) {
      case 'json':
        return flResult;

      case 'csv':
        return this.convertToCsv(flResult);

      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Convert result to CSV format
   */
  private convertToCsv(result: FLTaskResultResponse): string {
    const rows: string[] = [];

    // Header
    rows.push('clientId,metric,value');

    // Client metrics
    for (const clientMetric of result.metrics.clientMetrics) {
      for (const [metric, value] of Object.entries(clientMetric.metrics)) {
        rows.push(`${clientMetric.clientId},${metric},${value}`);
      }
    }

    // Global metrics
    if (result.metrics.finalLoss !== undefined) {
      rows.push(`global,finalLoss,${result.metrics.finalLoss}`);
    }
    if (result.metrics.finalAccuracy !== undefined) {
      rows.push(`global,finalAccuracy,${result.metrics.finalAccuracy}`);
    }
    rows.push(`global,roundsCompleted,${result.metrics.roundsCompleted}`);

    return rows.join('\n');
  }
}
