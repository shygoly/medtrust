// Flower 服务器
export interface FlowerServer {
  id: string;
  name: string;
  host: string;
  port: number;
  status: 'online' | 'offline' | 'busy';
  version?: string;
  capabilities?: string[];
  createdAt: string;
  updatedAt?: string;
}

// Flower 服务器健康状态
export interface FlowerHealthStatus {
  serverId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  connectedClients: number;
  activeTasks: number;
  memoryUsage?: number;
  cpuUsage?: number;
  lastCheck: string;
}

// Flower 客户端
export interface FlowerClient {
  clientId: string;
  nodeId: string;
  status: 'connected' | 'disconnected' | 'training';
  lastSeen: string;
  metadata?: Record<string, any>;
}

// FL 任务数据
export interface FLTaskData {
  taskName: string;
  algorithm: string;
  modelType: string;
  datasetConfig: Record<string, any>;
  trainingParams: {
    rounds: number;
    clients: number;
    learningRate: number;
    batchSize?: number;
    epochs?: number;
  };
  serverId?: string;
}

// FL 任务响应
export interface FLTaskResponse {
  taskId: string;
  serverId: string;
  status: string;
  message: string;
}

// Flower 运行配置
export interface FlowerRunConfig {
  serverId: string;
  numRounds: number;
  minClients: number;
  strategy: 'FedAvg' | 'FedProx' | 'FedAdagrad' | 'FedAdam' | 'FedYogi';
  clientResources?: {
    numCpus?: number;
    numGpus?: number;
  };
}

// Flower 任务状态
export interface FlowerTaskStatus {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentRound: number;
  totalRounds: number;
  connectedClients: number;
  startTime?: string;
  endTime?: string;
}
