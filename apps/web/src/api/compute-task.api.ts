import { api } from './client';
import type {
  ComputeTask,
  CreateTaskData,
  TaskResult,
  TaskFilters,
  SortConfig,
  PaginatedResult,
  QueryParams,
  TaskLog,
} from '@/types/compute-task.types';

// 计算任务 API 客户端
export const computeTaskApi = {
  // 获取任务列表
  getTasks: async (params?: QueryParams): Promise<PaginatedResult<ComputeTask>> => {
    const queryParams = new URLSearchParams();
    
    if (params?.page) {
      queryParams.append('page', params.page.toString());
    }
    if (params?.pageSize) {
      queryParams.append('pageSize', params.pageSize.toString());
    }
    if (params?.sort) {
      queryParams.append('sortField', params.sort.field);
      queryParams.append('sortDirection', params.sort.direction);
    }
    if (params?.filters) {
      if (params.filters.status?.length) {
        queryParams.append('status', params.filters.status.join(','));
      }
      if (params.filters.method?.length) {
        queryParams.append('method', params.filters.method.join(','));
      }
      if (params.filters.dateRange) {
        queryParams.append('startDate', params.filters.dateRange.start);
        queryParams.append('endDate', params.filters.dateRange.end);
      }
      if (params.filters.search) {
        queryParams.append('search', params.filters.search);
      }
    }
    
    const query = queryParams.toString();
    // For now, return all tasks and do client-side pagination
    const tasks = await api.getComputeTasks();
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 10;
    const total = tasks.length;
    const totalPages = Math.ceil(total / pageSize);
    
    return {
      items: tasks.slice((page - 1) * pageSize, page * pageSize),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  },

  // 获取单个任务
  getTask: async (id: string): Promise<ComputeTask> => {
    return api.getComputeTask(id);
  },

  // 创建任务
  createTask: async (data: CreateTaskData): Promise<ComputeTask> => {
    return api.createComputeTask(data);
  },

  // 取消任务
  cancelTask: async (id: string): Promise<void> => {
    return api.cancelComputeTask(id);
  },

  // 获取任务结果
  getResult: async (id: string): Promise<TaskResult> => {
    return api.getComputeTaskResult(id);
  },

  // 获取任务日志
  getLogs: async (id: string, params?: { limit?: number; offset?: number }): Promise<TaskLog[]> => {
    const logs = await api.getComputeTaskLogs(id, params);
    return logs.map((log: any, index: number) => ({
      id: log.id || `log-${index}`,
      taskId: id,
      level: log.level || 'info',
      message: log.message || log,
      timestamp: log.timestamp || new Date().toISOString(),
      metadata: log.metadata,
    }));
  },

  // 重试失败的任务
  retryTask: async (id: string): Promise<ComputeTask> => {
    return api.retryComputeTask(id);
  },

  // 删除任务
  deleteTask: async (id: string): Promise<void> => {
    return api.deleteComputeTask(id);
  },
};
