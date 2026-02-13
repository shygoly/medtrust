import { api } from './client';
import type {
  FlowerServer,
  FlowerHealthStatus,
  FlowerClient,
  FLTaskData,
  FLTaskResponse,
  FlowerRunConfig,
  FlowerTaskStatus,
} from '@/types/flower.types';

// Flower API 客户端
export const flowerApi = {
  // 获取服务器列表
  getServers: async (): Promise<FlowerServer[]> => {
    return (api as any).request('/flower/servers');
  },

  // 获取服务器健康状态
  getHealth: async (serverId: string): Promise<FlowerHealthStatus> => {
    return (api as any).request(`/flower/health?serverId=${serverId}`);
  },

  // 获取服务器连接的客户端
  getClients: async (serverId: string): Promise<FlowerClient[]> => {
    return (api as any).request(`/flower/servers/${serverId}/clients`);
  },

  // 提交 FL 任务
  submitFLTask: async (data: FLTaskData): Promise<FLTaskResponse> => {
    return (api as any).request('/flower/submit', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // 获取 FL 任务状态
  getTaskStatus: async (runId: string): Promise<FlowerTaskStatus> => {
    return (api as any).request(`/flower/tasks/${runId}/status`);
  },

  // 启动 Flower 运行
  startRun: async (config: FlowerRunConfig): Promise<{ runId: string }> => {
    return (api as any).request('/flower/runs', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  // 停止 Flower 运行
  stopRun: async (runId: string): Promise<void> => {
    return (api as any).request(`/flower/runs/${runId}/stop`, {
      method: 'POST',
    });
  },
};
