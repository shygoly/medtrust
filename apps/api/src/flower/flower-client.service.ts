import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, from, throwError, timer } from 'rxjs';
import { mergeMap, retryWhen, delayWhen, tap, catchError } from 'rxjs/operators';
import {
  FLTaskConfig,
  FLTaskResponse,
  FLTaskStatusResponse,
  FLTaskResultResponse,
  FLTaskCancelResponse,
  FlowerServerHealth,
  FlowerRetryConfig,
  FlowerConnectionPool,
} from './types';

/**
 * Flower HTTP Client Service
 * Handles HTTP communication with Flower server with retry logic and connection pooling
 */
@Injectable()
export class FlowerClientService {
  private readonly logger = new Logger(FlowerClientService.name);
  private readonly serverUrl: string;
  private readonly apiKey?: string;
  private readonly requestTimeout: number;
  private readonly maxRetries: number;
  private readonly maxConnections: number;
  private activeConnections = 0;
  private queuedRequests = 0;

  constructor(private configService: ConfigService) {
    this.serverUrl = this.configService.get<string>('FLOWER_SERVER_URL', 'http://localhost:8080');
    this.apiKey = this.configService.get<string>('FLOWER_API_KEY');
    this.requestTimeout = this.configService.get<number>('FLOWER_REQUEST_TIMEOUT', 30000);
    this.maxRetries = this.configService.get<number>('FLOWER_MAX_RETRIES', 3);
    this.maxConnections = this.configService.get<number>('FLOWER_MAX_CONNECTIONS', 10);
  }

  /**
   * Get retry configuration with exponential backoff
   */
  private getRetryConfig(): FlowerRetryConfig {
    return {
      maxRetries: this.maxRetries,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
    };
  }

  /**
   * Get connection pool status
   */
  getConnectionPool(): FlowerConnectionPool {
    return {
      maxConnections: this.maxConnections,
      activeConnections: this.activeConnections,
      queuedRequests: this.queuedRequests,
    };
  }

  /**
   * Execute HTTP request with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string,
  ): Promise<T> {
    const retryConfig = this.getRetryConfig();
    let attempt = 0;

    return from(operation())
      .pipe(
        retryWhen((errors) =>
          errors.pipe(
            tap((error) => {
              attempt++;
              this.logger.warn(
                `${context} failed (attempt ${attempt}/${retryConfig.maxRetries}): ${error.message}`,
              );
            }),
            delayWhen((error) => {
              if (attempt >= retryConfig.maxRetries) {
                return throwError(() => error);
              }
              const delayMs = Math.min(
                retryConfig.baseDelayMs * Math.pow(retryConfig.backoffMultiplier, attempt - 1),
                retryConfig.maxDelayMs,
              );
              this.logger.log(`Retrying ${context} in ${delayMs}ms...`);
              return timer(delayMs);
            }),
          ),
        ),
        catchError((error) => {
          this.logger.error(`${context} failed after ${retryConfig.maxRetries} attempts: ${error.message}`);
          throw new Error(`Flower server communication failed: ${error.message}`);
        }),
      )
      .toPromise();
  }

  /**
   * Acquire connection slot with pool management
   */
  private async acquireConnection(): Promise<void> {
    if (this.activeConnections < this.maxConnections) {
      this.activeConnections++;
      return;
    }

    this.queuedRequests++;
    this.logger.debug(`Connection pool full, queuing request. Queue size: ${this.queuedRequests}`);

    // Wait for available connection
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.activeConnections < this.maxConnections) {
          clearInterval(checkInterval);
          this.queuedRequests--;
          this.activeConnections++;
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Release connection slot
   */
  private releaseConnection(): void {
    if (this.activeConnections > 0) {
      this.activeConnections--;
    }
  }

  /**
   * Make HTTP request with timeout and connection management
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    await this.acquireConnection();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      };

      if (this.apiKey) {
        headers['X-API-Key'] = this.apiKey;
      }

      const response = await fetch(`${this.serverUrl}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return (await response.json()) as T;
    } finally {
      this.releaseConnection();
    }
  }

  /**
   * Submit FL task to Flower server
   */
  async submitTask(config: FLTaskConfig): Promise<FLTaskResponse> {
    return this.executeWithRetry(
      () =>
        this.makeRequest<FLTaskResponse>('/api/tasks', {
          method: 'POST',
          body: JSON.stringify(config),
        }),
      'Submit FL task',
    );
  }

  /**
   * Get task status from Flower server
   */
  async getTaskStatus(taskId: string): Promise<FLTaskStatusResponse> {
    return this.executeWithRetry(
      () =>
        this.makeRequest<FLTaskStatusResponse>(`/api/tasks/${taskId}/status`, {
          method: 'GET',
        }),
      `Get task status for ${taskId}`,
    );
  }

  /**
   * Get task result from Flower server
   */
  async getTaskResult(taskId: string): Promise<FLTaskResultResponse> {
    return this.executeWithRetry(
      () =>
        this.makeRequest<FLTaskResultResponse>(`/api/tasks/${taskId}/result`, {
          method: 'GET',
        }),
      `Get task result for ${taskId}`,
    );
  }

  /**
   * Cancel task on Flower server
   */
  async cancelTask(taskId: string): Promise<FLTaskCancelResponse> {
    return this.executeWithRetry(
      () =>
        this.makeRequest<FLTaskCancelResponse>(`/api/tasks/${taskId}/cancel`, {
          method: 'POST',
        }),
      `Cancel task ${taskId}`,
    );
  }

  /**
   * Check Flower server health
   */
  async checkHealth(): Promise<FlowerServerHealth> {
    try {
      const result = await this.makeRequest<FlowerServerHealth>('/health', {
        method: 'GET',
      });
      return {
        ...result,
        status: 'healthy',
      };
    } catch (error) {
      this.logger.error(`Flower server health check failed: ${error.message}`);
      return {
        status: 'unreachable',
      };
    }
  }

  /**
   * List all tasks from Flower server
   */
  async listTasks(): Promise<FLTaskResponse[]> {
    return this.executeWithRetry(
      () =>
        this.makeRequest<FLTaskResponse[]>('/api/tasks', {
          method: 'GET',
        }),
      'List tasks',
    );
  }
}
