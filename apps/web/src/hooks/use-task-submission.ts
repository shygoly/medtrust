'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { computeTaskApi } from '@/api/compute-task.api';
import { flowerApi } from '@/api/flower.api';
import type { CreateTaskData, ComputeTask, ComputeMethod } from '@/types/compute-task.types';

interface UseTaskSubmissionOptions {
  onSuccess?: (task: ComputeTask) => void;
  onError?: (error: Error) => void;
  redirectOnSuccess?: boolean;
}

interface FormValidationErrors {
  taskName?: string;
  method?: string;
  description?: string;
  algorithmConfig?: string;
}

export function useTaskSubmission(options: UseTaskSubmissionOptions = {}) {
  const { onSuccess, onError, redirectOnSuccess = true } = options;
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormValidationErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const validateForm = useCallback((data: CreateTaskData): boolean => {
    const newErrors: FormValidationErrors = {};

    if (!data.taskName?.trim()) {
      newErrors.taskName = '请输入任务名称';
    } else if (data.taskName.length < 2) {
      newErrors.taskName = '任务名称至少需要2个字符';
    }

    if (!data.method) {
      newErrors.method = '请选择计算方法';
    }

    if (data.algorithmConfig && data.method === 'fl') {
      const flConfig = data.algorithmConfig as any;
      if (!flConfig.algorithmType) {
        newErrors.algorithmConfig = '请选择算法类型';
      }
      if (!flConfig.modelType) {
        newErrors.algorithmConfig = '请选择模型类型';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, []);

  const submitTask = useCallback(async (data: CreateTaskData): Promise<ComputeTask | null> => {
    if (!validateForm(data)) {
      return null;
    }

    try {
      setSubmitting(true);
      setGeneralError(null);

      let task: ComputeTask;

      // For FL tasks, also submit to Flower
      if (data.method === 'fl' && data.algorithmConfig) {
        const flConfig = data.algorithmConfig as any;
        const flTaskData = {
          taskName: data.taskName,
          algorithm: flConfig.algorithmType,
          modelType: flConfig.modelType,
          datasetConfig: flConfig.datasetConfig || {},
          trainingParams: flConfig.trainingParams || {
            rounds: 10,
            clients: 3,
            learningRate: 0.01,
          },
        };

        // Submit to both APIs
        const [apiTask, flResponse] = await Promise.all([
          computeTaskApi.createTask(data),
          flowerApi.submitFLTask(flTaskData),
        ]);

        task = apiTask;
      } else {
        task = await computeTaskApi.createTask(data);
      }

      onSuccess?.(task);

      if (redirectOnSuccess) {
        router.push(`/dashboard/compute/${task.id}`);
      }

      return task;
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(err.message || '提交任务失败');
      setGeneralError(error.message);
      onError?.(error);
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [validateForm, onSuccess, onError, redirectOnSuccess, router]);

  const clearErrors = useCallback(() => {
    setErrors({});
    setGeneralError(null);
  }, []);

  const setFieldError = useCallback((field: keyof FormValidationErrors, message: string | undefined) => {
    setErrors(prev => ({ ...prev, [field]: message }));
  }, []);

  return {
    submitting,
    errors,
    generalError,
    submitTask,
    validateForm,
    clearErrors,
    setFieldError,
  };
}
