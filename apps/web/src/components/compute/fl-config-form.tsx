'use client';

import { useState } from 'react';
import type { FLTrainingParams, FLAlgorithmConfig } from '@/types/compute-task.types';

interface FLConfigFormProps {
  value?: Partial<FLAlgorithmConfig>;
  onChange: (config: Partial<FLAlgorithmConfig>) => void;
}

export function FLConfigForm({ value, onChange }: FLConfigFormProps) {
  const trainingParams = value?.trainingParams || {
    rounds: 10,
    clients: 3,
    learningRate: 0.01,
    batchSize: 32,
    epochs: 5,
  };

  const handleParamChange = (field: keyof FLTrainingParams, val: number) => {
    onChange({
      ...value,
      trainingParams: {
        ...trainingParams,
        [field]: val,
      },
    });
  };

  const handleDatasetConfigChange = (jsonStr: string) => {
    try {
      const config = JSON.parse(jsonStr);
      onChange({
        ...value,
        datasetConfig: config,
      });
    } catch {
      // Invalid JSON, ignore
    }
  };

  return (
    <div className="space-y-6">
      {/* Training Parameters */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-900 mb-4">训练参数</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              训练轮数
            </label>
            <input
              type="number"
              min={1}
              max={1000}
              value={trainingParams.rounds}
              onChange={(e) => handleParamChange('rounds', parseInt(e.target.value) || 1)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">联邦学习的通信轮数</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              客户端数量
            </label>
            <input
              type="number"
              min={2}
              max={100}
              value={trainingParams.clients}
              onChange={(e) => handleParamChange('clients', parseInt(e.target.value) || 2)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">参与训练的客户端数量</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              学习率
            </label>
            <input
              type="number"
              step={0.001}
              min={0.0001}
              max={1}
              value={trainingParams.learningRate}
              onChange={(e) => handleParamChange('learningRate', parseFloat(e.target.value) || 0.01)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">模型参数更新步长</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Batch Size
            </label>
            <input
              type="number"
              min={1}
              max={1024}
              value={trainingParams.batchSize || 32}
              onChange={(e) => handleParamChange('batchSize', parseInt(e.target.value) || 32)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">本地训练批次大小</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              本地 Epochs
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={trainingParams.epochs || 5}
              onChange={(e) => handleParamChange('epochs', parseInt(e.target.value) || 5)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">每轮本地训练轮数</p>
          </div>
        </div>
      </div>

      {/* Dataset Configuration */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-900 mb-4">数据集配置 (JSON)</h4>
        <textarea
          rows={6}
          defaultValue={JSON.stringify(value?.datasetConfig || {}, null, 2)}
          onChange={(e) => handleDatasetConfigChange(e.target.value)}
          placeholder={`{\n  "datasetName": "medical_data",\n  "targetColumn": "diagnosis",\n  "featureColumns": ["age", "gender", "symptoms"]\n}`}
          className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm font-mono text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        />
        <p className="mt-2 text-xs text-gray-500">
          配置数据集参数，使用 JSON 格式。包括数据集名称、目标列、特征列等。
        </p>
      </div>

      {/* Aggregation Config */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-900 mb-4">聚合配置</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              聚合策略
            </label>
            <select
              value={value?.aggregationConfig?.strategy || 'FedAvg'}
              onChange={(e) => onChange({
                ...value,
                aggregationConfig: {
                  ...value?.aggregationConfig,
                  strategy: e.target.value || 'FedAvg',
                },
              })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="FedAvg">FedAvg - 简单平均</option>
              <option value="WeightedAvg">WeightedAvg - 加权平均</option>
              <option value="Median">Median - 中位数</option>
              <option value="TrimmedMean">TrimmedMean - 截断均值</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              最小客户端数
            </label>
            <input
              type="number"
              min={1}
              max={trainingParams.clients}
              value={value?.aggregationConfig?.minClients || Math.ceil(trainingParams.clients / 2)}
              onChange={(e) => onChange({
                ...value,
                aggregationConfig: {
                  strategy: value?.aggregationConfig?.strategy || 'FedAvg',
                  minClients: parseInt(e.target.value) || 1,
                },
              })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">聚合所需的最小客户端数量</p>
          </div>
        </div>
      </div>
    </div>
  );
}
