'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTaskSubmission } from '@/hooks/use-task-submission';
import { FLAlgorithmSelector } from './fl-algorithm-selector';
import { FLConfigForm } from './fl-config-form';
import type { CreateTaskData, ComputeMethod } from '@/types/compute-task.types';

interface TaskCreateFormProps {
  onCancel?: () => void;
}

const methodOptions = [
  { value: 'fl', label: '联邦学习 (Federated Learning)', description: '分布式机器学习，数据不出本地' },
  { value: 'mpc', label: '多方安全计算 (MPC)', description: '保护隐私的协同计算' },
  { value: 'tee', label: '可信执行环境 (TEE)', description: '硬件隔离的安全计算' },
  { value: 'sandbox', label: '沙箱计算', description: '隔离环境中的数据处理' },
];

export function TaskCreateForm({ onCancel }: TaskCreateFormProps) {
  const router = useRouter();
  const { submitting, errors, generalError, submitTask, clearErrors, setFieldError } = useTaskSubmission({
    redirectOnSuccess: true,
  });

  const [formData, setFormData] = useState<CreateTaskData>({
    taskName: '',
    method: 'fl',
    description: '',
    algorithmConfig: undefined,
    dataAssets: [],
  });

  const handleMethodChange = (method: ComputeMethod) => {
    setFormData(prev => ({
      ...prev,
      method,
      algorithmConfig: method === 'fl' ? {
        type: 'fl',
        algorithmType: 'FedAvg',
        modelType: 'CNN',
        datasetConfig: {},
        trainingParams: {
          rounds: 10,
          clients: 3,
          learningRate: 0.01,
        },
      } : undefined,
    }));
    clearErrors();
  };

  const handleFLConfigChange = (config: any) => {
    setFormData(prev => ({
      ...prev,
      algorithmConfig: {
        type: 'fl',
        ...config,
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitTask(formData);
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      router.back();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-lg shadow">
      {generalError && (
        <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-md text-sm">
          <div className="flex">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {generalError}
          </div>
        </div>
      )}

      {/* 任务名称 */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          任务名称 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.taskName}
          onChange={(e) => {
            setFormData(prev => ({ ...prev, taskName: e.target.value }));
            if (errors.taskName) setFieldError('taskName', undefined);
          }}
          className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
            errors.taskName ? 'border-red-300' : 'border-gray-300'
          }`}
          placeholder="例如：CKD 进展预测 · 多模态联邦微调"
        />
        {errors.taskName && (
          <p className="mt-1 text-sm text-red-600">{errors.taskName}</p>
        )}
      </div>

      {/* 计算方法 */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          计算方法 <span className="text-red-500">*</span>
        </label>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {methodOptions.map((option) => (
            <div
              key={option.value}
              onClick={() => handleMethodChange(option.value as ComputeMethod)}
              className={`relative flex cursor-pointer rounded-lg border p-4 hover:border-blue-400 ${
                formData.method === option.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300'
              }`}
            >
              <div className="flex flex-1">
                <div className="flex flex-col">
                  <span className="block text-sm font-medium text-gray-900">
                    {option.label}
                  </span>
                  <span className="mt-1 flex items-center text-xs text-gray-500">
                    {option.description}
                  </span>
                </div>
              </div>
              {formData.method === option.value && (
                <div className="flex h-5 items-center">
                  <div className="h-4 w-4 rounded-full bg-blue-500 flex items-center justify-center">
                    <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {errors.method && (
          <p className="mt-1 text-sm text-red-600">{errors.method}</p>
        )}
      </div>

      {/* 任务描述 */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          任务描述
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          rows={3}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="描述任务的目标和用途..."
        />
      </div>

      {/* FL 特定配置 */}
      {formData.method === 'fl' && (
        <div className="border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">联邦学习配置</h3>
          <FLAlgorithmSelector
            value={formData.algorithmConfig as any}
            onChange={handleFLConfigChange}
            error={errors.algorithmConfig}
          />
          <div className="mt-6">
            <FLConfigForm
              value={formData.algorithmConfig as any}
              onChange={handleFLConfigChange}
            />
          </div>
        </div>
      )}

      {/* 提交按钮 */}
      <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center"
        >
          {submitting && (
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          )}
          {submitting ? '提交中...' : '创建任务'}
        </button>
      </div>
    </form>
  );
}
