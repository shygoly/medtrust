'use client';

import { useState, useCallback } from 'react';
import { computeTaskApi } from '@/api/compute-task.api';
import type { TaskLog } from '@/types/compute-task.types';

interface UseTaskLogsOptions {
  pageSize?: number;
}

export function useTaskLogs(taskId: string | undefined, options: UseTaskLogsOptions = {}) {
  const { pageSize = 50 } = options;

  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const fetchLogs = useCallback(async (reset: boolean = false) => {
    if (!taskId) return;

    try {
      setLoading(true);
      setError(null);

      const currentOffset = reset ? 0 : offset;
      const data = await computeTaskApi.getLogs(taskId, {
        limit: pageSize,
        offset: currentOffset,
      });

      if (reset) {
        setLogs(data);
      } else {
        setLogs(prev => [...prev, ...data]);
      }

      setHasMore(data.length === pageSize);
      setOffset(currentOffset + data.length);
    } catch (err: any) {
      setError(err.message || '获取日志失败');
    } finally {
      setLoading(false);
    }
  }, [taskId, offset, pageSize]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchLogs(false);
    }
  }, [fetchLogs, loading, hasMore]);

  const refresh = useCallback(() => {
    setOffset(0);
    setHasMore(true);
    fetchLogs(true);
  }, [fetchLogs]);

  return {
    logs,
    loading,
    error,
    hasMore,
    fetchLogs: () => fetchLogs(true),
    loadMore,
    refresh,
  };
}
