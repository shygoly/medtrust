'use client';

import { useState, useCallback, useEffect } from 'react';
import { computeTaskApi } from '@/api/compute-task.api';
import type { ComputeTask, TaskStatus } from '@/types/compute-task.types';

interface UseComputeTaskOptions {
  autoFetch?: boolean;
  pollInterval?: number;
}

export function useComputeTask(taskId: string | undefined, options: UseComputeTaskOptions = {}) {
  const { autoFetch = true, pollInterval } = options;

  const [task, setTask] = useState<ComputeTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const fetchTask = useCallback(async () => {
    if (!taskId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await computeTaskApi.getTask(taskId);
      setTask(data);
    } catch (err: any) {
      setError(err.message || '获取任务详情失败');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const cancelTask = useCallback(async () => {
    if (!taskId) return;

    try {
      setCancelling(true);
      await computeTaskApi.cancelTask(taskId);
      await fetchTask();
    } catch (err: any) {
      setError(err.message || '取消任务失败');
      throw err;
    } finally {
      setCancelling(false);
    }
  }, [taskId, fetchTask]);

  const retryTask = useCallback(async () => {
    if (!taskId) return;

    try {
      setRetrying(true);
      await computeTaskApi.retryTask(taskId);
      await fetchTask();
    } catch (err: any) {
      setError(err.message || '重试任务失败');
      throw err;
    } finally {
      setRetrying(false);
    }
  }, [taskId, fetchTask]);

  const updateTaskStatus = useCallback((status: TaskStatus, progress?: number) => {
    setTask(prev => {
      if (!prev) return null;
      return {
        ...prev,
        status,
        progress: progress ?? prev.progress,
      };
    });
  }, []);

  // Polling for running tasks
  useEffect(() => {
    if (!taskId || !autoFetch) return;

    fetchTask();

    if (pollInterval && task?.status === 'running') {
      const interval = setInterval(fetchTask, pollInterval);
      return () => clearInterval(interval);
    }
  }, [taskId, autoFetch, fetchTask, pollInterval, task?.status]);

  return {
    task,
    loading,
    error,
    cancelling,
    retrying,
    fetchTask,
    cancelTask,
    retryTask,
    updateTaskStatus,
  };
}
