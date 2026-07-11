import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface FLTaskConfig {
  taskType: string;
  modelType: string;
  datasetConfig: {
    dataAssetIds: string[];
    features: string[];
    target: string;
  };
  trainingConfig: {
    rounds: number;
    clients: number;
    learningRate: number;
    batchSize: number;
    epochs: number;
    fractionFit: number;
    fractionEvaluate: number;
  };
  aggregationConfig?: {
    strategy: "fedavg" | "fedprox" | "fednova";
    proximalMu?: number;
  };
}

export interface FLTaskResponse {
  taskId: string;
  status:
    | "submitted"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  message: string;
  submittedAt: string;
}

export interface FLTaskStatus {
  taskId: string;
  status:
    | "pending"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  progress?: {
    currentRound: number;
    totalRounds: number;
    currentClient?: string;
    metrics?: Record<string, number>;
  };
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface FLTaskResult {
  taskId: string;
  status: "completed" | "failed" | "cancelled";
  metrics: {
    finalLoss?: number;
    finalAccuracy?: number;
    roundsCompleted: number;
    clientMetrics: Array<{
      clientId: string;
      metrics: Record<string, number>;
    }>;
  };
  modelArtifacts?: {
    modelUrl: string;
    checkpointUrl: string;
    size: number;
  };
  completedAt?: string;
  errorMessage?: string;
}

@Injectable()
export class FlowerService {
  private readonly logger = new Logger(FlowerService.name);
  private readonly flowerServerUrl: string;

  constructor(private configService: ConfigService) {
    this.flowerServerUrl = this.configService.get<string>(
      "FLOWER_SERVER_URL",
      "http://localhost:8080",
    );
  }

  /**
   * 提交联邦学习任务到 Flower 服务器
   */
  async submitFLTask(config: FLTaskConfig): Promise<FLTaskResponse> {
    try {
      this.logger.log(
        `Submitting FL task with config: ${JSON.stringify(config)}`,
      );

      const response = await fetch(`${this.flowerServerUrl}/api/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Flower server error: ${response.status} - ${errorText}`,
        );
      }

      const result = await response.json();

      this.logger.log(`FL task submitted successfully: ${result.taskId}`);

      return {
        taskId: result.taskId,
        status: result.status || "submitted",
        message: result.message || "Task submitted successfully",
        submittedAt: result.submittedAt || new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to submit FL task: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * 查询联邦学习任务状态
   */
  async getTaskStatus(taskId: string): Promise<FLTaskStatus> {
    try {
      this.logger.debug(`Querying status for task: ${taskId}`);

      const response = await fetch(
        `${this.flowerServerUrl}/api/tasks/${taskId}/status`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Task not found: ${taskId}`);
        }
        const errorText = await response.text();
        throw new Error(
          `Flower server error: ${response.status} - ${errorText}`,
        );
      }

      const result = await response.json();

      return {
        taskId: result.taskId,
        status: result.status,
        progress: result.progress,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        errorMessage: result.errorMessage,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get task status: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * 获取联邦学习任务结果
   */
  async getTaskResult(taskId: string): Promise<FLTaskResult> {
    try {
      this.logger.debug(`Fetching result for task: ${taskId}`);

      const response = await fetch(
        `${this.flowerServerUrl}/api/tasks/${taskId}/result`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Task not found: ${taskId}`);
        }
        const errorText = await response.text();
        throw new Error(
          `Flower server error: ${response.status} - ${errorText}`,
        );
      }

      const result = await response.json();

      return {
        taskId: result.taskId,
        status: result.status,
        metrics: result.metrics || {
          roundsCompleted: 0,
          clientMetrics: [],
        },
        modelArtifacts: result.modelArtifacts,
        completedAt: result.completedAt,
        errorMessage: result.errorMessage,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get task result: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * 取消正在运行的联邦学习任务
   */
  async cancelTask(
    taskId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Cancelling FL task: ${taskId}`);

      const response = await fetch(
        `${this.flowerServerUrl}/api/tasks/${taskId}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Task not found: ${taskId}`);
        }
        const errorText = await response.text();
        throw new Error(
          `Flower server error: ${response.status} - ${errorText}`,
        );
      }

      const result = await response.json();

      return {
        success: result.success || true,
        message: result.message || "Task cancelled successfully",
      };
    } catch (error) {
      this.logger.error(`Failed to cancel task: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 获取 Flower 服务器健康状态
   */
  async getServerHealth(): Promise<{
    status: string;
    version?: string;
    uptime?: number;
  }> {
    try {
      const response = await fetch(`${this.flowerServerUrl}/health`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return { status: "unhealthy" };
      }

      const result = await response.json();
      return {
        status: result.status || "healthy",
        version: result.version,
        uptime: result.uptime,
      };
    } catch (error) {
      this.logger.error(`Flower server health check failed: ${error.message}`);
      return { status: "unreachable" };
    }
  }
}
