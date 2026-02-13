/**
 * Flower Federated Learning Types
 * Core type definitions for Flower integration
 */

export enum FLTaskStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum FLAlgorithmType {
  FEDAVG = 'fedavg',
  FEDPROX = 'fedprox',
  FEDNOVA = 'fednova',
  FEDYOGI = 'fedyogi',
  FEDADAM = 'fedadam',
}

export enum FLModelType {
  LOGISTIC_REGRESSION = 'logistic_regression',
  RANDOM_FOREST = 'random_forest',
  XGBOOST = 'xgboost',
  NEURAL_NETWORK = 'neural_network',
  CNN = 'cnn',
  RNN = 'rnn',
  TRANSFORMER = 'transformer',
}

export enum FLTaskType {
  CLASSIFICATION = 'classification',
  REGRESSION = 'regression',
  CLUSTERING = 'clustering',
  ANOMALY_DETECTION = 'anomaly_detection',
}

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
    strategy: 'fedavg' | 'fedprox' | 'fednova';
    proximalMu?: number;
  };
}

export interface FLTaskResponse {
  taskId: string;
  status: FLTaskStatus;
  message: string;
  submittedAt: string;
}

export interface FLTaskStatusResponse {
  taskId: string;
  status: FLTaskStatus;
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

export interface FLTaskResultResponse {
  taskId: string;
  status: FLTaskStatus.COMPLETED | FLTaskStatus.FAILED | FLTaskStatus.CANCELLED;
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

export interface FLTaskCancelResponse {
  success: boolean;
  message: string;
}

export interface FlowerServerHealth {
  status: 'healthy' | 'unhealthy' | 'unreachable';
  version?: string;
  uptime?: number;
  activeTasks?: number;
  queuedTasks?: number;
  connectedClients?: number;
}

export interface FlowerConfig {
  serverUrl: string;
  apiKey?: string;
  requestTimeout: number;
  maxRetries: number;
  maxConnections: number;
  webhookSecret: string;
  healthCheckInterval: number;
}

export interface WebhookPayload {
  event: 'task.created' | 'task.started' | 'task.progress' | 'task.completed' | 'task.failed' | 'task.cancelled';
  taskId: string;
  timestamp: string;
  data: {
    status?: FLTaskStatus;
    progress?: {
      currentRound: number;
      totalRounds: number;
      metrics?: Record<string, number>;
    };
    errorMessage?: string;
    result?: FLTaskResultResponse;
  };
}

export interface FlowerConnectionPool {
  maxConnections: number;
  activeConnections: number;
  queuedRequests: number;
}

export interface FlowerRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}
