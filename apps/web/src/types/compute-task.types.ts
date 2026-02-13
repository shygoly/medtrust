// 计算任务状态
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// 计算方法类型
export type ComputeMethod = 'fl' | 'mpc' | 'tee' | 'sandbox';

// FL 算法类型
export type FLAlgorithmType = 'FedAvg' | 'FedProx' | 'SCAFFOLD';

// 模型类型
export type ModelType = 'CNN' | 'RNN' | 'Transformer' | 'Custom';

// 计算任务
export interface ComputeTask {
  id: string;
  name: string;
  description?: string;
  method: ComputeMethod;
  status: TaskStatus;
  tenantId: number;
  requestId?: string;
  algorithmParams?: AlgorithmConfig;
  dataAssets?: string[];
  resultSummary?: TaskResultSummary;
  errorMessage?: string;
  progress?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

// 算法配置基类
export interface AlgorithmConfig {
  type: string;
}

// FL 算法配置
export interface FLAlgorithmConfig extends AlgorithmConfig {
  type: 'fl';
  algorithmType: FLAlgorithmType;
  modelType: ModelType;
  datasetConfig: Record<string, any>;
  trainingParams: FLTrainingParams;
  aggregationConfig?: FLAggregationConfig;
}

// FL 训练参数
export interface FLTrainingParams {
  rounds: number;
  clients: number;
  learningRate: number;
  batchSize?: number;
  epochs?: number;
  localSteps?: number;
}

// FL 聚合配置
export interface FLAggregationConfig {
  strategy: string;
  minClients?: number;
  aggregationFrequency?: number;
}

// MPC 配置
export interface MPCConfig extends AlgorithmConfig {
  type: 'mpc';
  protocol: string;
  parties: number;
  computationType: string;
}

// TEE 配置
export interface TEEConfig extends AlgorithmConfig {
  type: 'tee';
  teeType: 'SGX' | 'SEV' | 'TrustZone';
  enclaveMemory?: number;
}

// 创建任务数据
export interface CreateTaskData {
  taskName: string;
  method: ComputeMethod;
  description?: string;
  algorithmConfig?: FLAlgorithmConfig | MPCConfig | TEEConfig;
  dataAssets?: string[];
}

// 任务结果摘要
export interface TaskResultSummary {
  accuracy?: number;
  loss?: number;
  trainingTime?: number;
  roundsCompleted?: number;
  totalRounds?: number;
  clientParticipation?: number;
}

// 完整任务结果
export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  summary: TaskResultSummary;
  metrics: TaskMetrics;
  modelDownloadUrl?: string;
  detailedResults?: Record<string, any>;
  completedAt: string;
}

// 任务指标
export interface TaskMetrics {
  lossOverRounds: MetricPoint[];
  accuracyOverRounds: MetricPoint[];
  clientParticipation: ClientParticipation[];
}

// 指标数据点
export interface MetricPoint {
  round: number;
  value: number;
  timestamp?: string;
}

// 客户端参与数据
export interface ClientParticipation {
  clientId: string;
  roundsParticipated: number;
  totalRounds: number;
  dataSamples?: number;
}

// 任务日志
export interface TaskLog {
  id: string;
  taskId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

// 任务过滤器
export interface TaskFilters {
  status?: TaskStatus[];
  method?: ComputeMethod[];
  dateRange?: {
    start: string;
    end: string;
  };
  search?: string;
}

// 排序配置
export interface SortConfig {
  field: string;
  direction: 'asc' | 'desc';
}

// 分页配置
export interface PaginationConfig {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// 分页结果
export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationConfig;
}

// 查询参数
export interface QueryParams {
  page?: number;
  pageSize?: number;
  sort?: SortConfig;
  filters?: TaskFilters;
}

// WebSocket 消息类型
export interface WebSocketMessage {
  type: 'status_update' | 'progress_update' | 'log' | 'error' | 'connected';
  taskId?: string;
  data?: any;
  timestamp: string;
}

// WebSocket 状态更新
export interface TaskStatusUpdate {
  taskId: string;
  status: TaskStatus;
  progress?: number;
  message?: string;
  timestamp: string;
}
