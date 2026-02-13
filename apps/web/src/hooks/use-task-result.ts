'use client';

import { useState, useCallback, useEffect } from 'react';
import { computeTaskApi } from '@/api/compute-task.api';
import type { TaskResult, ExportOptions, ExportFormat } from '@/types/task-result.types';
import { exportResults } from '@/types/task-result.types';

interface UseTaskResultOptions {
  autoFetch?: boolean;
}

export function useTaskResult(taskId: string | undefined, options: UseTaskResultOptions = {}) {
  const { autoFetch = true } = options;

  const [result, setResult] = useState<TaskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchResult = useCallback(async () => {
    if (!taskId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await computeTaskApi.getResult(taskId);
      setResult(data);
    } catch (err: any) {
      setError(err.message || '获取任务结果失败');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const exportResult = useCallback(async (format: ExportFormat, filename?: string) => {
    if (!result) return;

    try {
      setExporting(true);
      
      const options: ExportOptions = {
        format,
        includeMetrics: true,
        includeModel: true,
        includeLogs: false,
      };

      const blob = exportResults(result, options);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || `task-${taskId}-result.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '导出结果失败');
      throw err;
    } finally {
      setExporting(false);
    }
  }, [result, taskId]);

  const downloadModel = useCallback(() => {
    if (!result?.modelDownloadUrl) return;

    const link = document.createElement('a');
    link.href = result.modelDownloadUrl;
    link.download = `model-${taskId}.pkl`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [result?.modelDownloadUrl, taskId]);

  useEffect(() => {
    if (autoFetch && taskId) {
      fetchResult();
    }
  }, [autoFetch, taskId, fetchResult]);

  return {
    result,
    loading,
    error,
    exporting,
    fetchResult,
    exportResult,
    downloadModel,
  };
}
