'use client';

import { useState, useCallback, useEffect } from 'react';
import { computeTaskApi } from '@/api/compute-task.api';
import type {
  ComputeTask,
  TaskFilters,
  SortConfig,
  PaginationConfig,
  QueryParams,
} from '@/types/compute-task.types';

interface UseComputeTasksOptions {
  autoFetch?: boolean;
  initialPage?: number;
  initialPageSize?: number;
}

export function useComputeTasks(options: UseComputeTasksOptions = {}) {
  const { autoFetch = true, initialPage = 1, initialPageSize = 10 } = options;

  const [tasks, setTasks] = useState<ComputeTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TaskFilters>({});
  const [sort, setSort] = useState<SortConfig | undefined>();
  const [pagination, setPagination] = useState<PaginationConfig>({
    page: initialPage,
    pageSize: initialPageSize,
    total: 0,
    totalPages: 0,
  });

  const fetchTasks = useCallback(async (params?: QueryParams) => {
    try {
      setLoading(true);
      setError(null);

      const queryParams: QueryParams = {
        page: params?.page ?? pagination.page,
        pageSize: params?.pageSize ?? pagination.pageSize,
        sort: params?.sort ?? sort,
        filters: params?.filters ?? filters,
      };

      const result = await computeTaskApi.getTasks(queryParams);
      
      setTasks(result.items);
      setPagination(result.pagination);
    } catch (err: any) {
      setError(err.message || '获取任务列表失败');
    } finally {
      setLoading(false);
    }
  }, [filters, sort, pagination.page, pagination.pageSize]);

  const refresh = useCallback(() => {
    return fetchTasks();
  }, [fetchTasks]);

  const goToPage = useCallback((page: number) => {
    if (page >= 1 && page <= pagination.totalPages) {
      fetchTasks({ page });
    }
  }, [fetchTasks, pagination.totalPages]);

  const changePageSize = useCallback((pageSize: number) => {
    fetchTasks({ page: 1, pageSize });
  }, [fetchTasks]);

  const updateFilters = useCallback((newFilters: TaskFilters) => {
    setFilters(newFilters);
    fetchTasks({ page: 1, filters: newFilters });
  }, [fetchTasks]);

  const updateSort = useCallback((newSort: SortConfig) => {
    setSort(newSort);
    fetchTasks({ sort: newSort });
  }, [fetchTasks]);

  const clearFilters = useCallback(() => {
    setFilters({});
    fetchTasks({ page: 1, filters: {} });
  }, [fetchTasks]);

  useEffect(() => {
    if (autoFetch) {
      fetchTasks();
    }
  }, [autoFetch, fetchTasks]);

  return {
    tasks,
    loading,
    error,
    pagination,
    filters,
    sort,
    fetchTasks,
    refresh,
    goToPage,
    changePageSize,
    updateFilters,
    updateSort,
    clearFilters,
  };
}
