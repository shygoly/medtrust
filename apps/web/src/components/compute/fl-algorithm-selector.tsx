'use client';

import { useState } from 'react';
import type { FLAlgorithmType, ModelType } from '@/types/compute-task.types';

interface FLAlgorithmSelectorProps {
  value?: {
    algorithmType?: FLAlgorithmType;
    modelType?: ModelType;
  };
  onChange: (config: { algorithmType: FLAlgorithmType; modelType: ModelType }) => void;
  error?: string;
}

const algorithmOptions: { value: FLAlgorithmType; label: string; description: string }[] = [
  {
    value: 'FedAvg',
    label: 'FedAvg',
    description: '经典的联邦平均算法，适合数据分布均匀的场景',
  },
  {
    value: 'FedProx',
    label: 'FedProx',
    description: '带近端项的联邦优化，适合数据异构场景',
  },
  {
    value: 'SCAFFOLD',
    label: 'SCAFFOLD',
    description: '使用控制变量的方差缩减算法，收敛更快',
  },
];

const modelOptions: { value: ModelType; label: string; description: string }[] = [
  {
    value: 'CNN',
    label: 'CNN',
    description: '卷积神经网络，适合图像数据',
  },
  {
    value: 'RNN',
    label: 'RNN',
    description: '循环神经网络，适合序列数据',
  },
  {
    value: 'Transformer',
    label: 'Transformer',
    description: 'Transformer 架构，适合复杂模式',
  },
  {
    value: 'Custom',
    label: '自定义模型',
    description: '使用自定义模型架构',
  },
];

export function FLAlgorithmSelector({ value, onChange, error }: FLAlgorithmSelectorProps) {
  const [activeTab, setActiveTab] = useState<'algorithm' | 'model'>('algorithm');

  const handleAlgorithmSelect = (algorithmType: FLAlgorithmType) => {
    onChange({
      algorithmType,
      modelType: value?.modelType || 'CNN',
    });
  };

  const handleModelSelect = (modelType: ModelType) => {
    onChange({
      algorithmType: value?.algorithmType || 'FedAvg',
      modelType,
    });
  };

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('algorithm')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'algorithm'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            算法选择
          </button>
          <button
            onClick={() => setActiveTab('model')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'model'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            模型选择
          </button>
        </nav>
      </div>

      {/* Algorithm Selection */}
      {activeTab === 'algorithm' && (
        <div className="grid grid-cols-1 gap-3">
          {algorithmOptions.map((option) => (
            <div
              key={option.value}
              onClick={() => handleAlgorithmSelect(option.value)}
              className={`relative flex cursor-pointer rounded-lg border p-4 hover:border-blue-400 transition-colors ${
                value?.algorithmType === option.value
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                  : 'border-gray-300'
              }`}
            >
              <div className="flex flex-1">
                <div className="flex flex-col">
                  <span className="block text-sm font-medium text-gray-900">
                    {option.label}
                  </span>
                  <span className="mt-1 text-xs text-gray-500">
                    {option.description}
                  </span>
                </div>
              </div>
              {value?.algorithmType === option.value && (
                <div className="flex h-5 items-center">
                  <div className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center">
                    <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Model Selection */}
      {activeTab === 'model' && (
        <div className="grid grid-cols-1 gap-3">
          {modelOptions.map((option) => (
            <div
              key={option.value}
              onClick={() => handleModelSelect(option.value)}
              className={`relative flex cursor-pointer rounded-lg border p-4 hover:border-blue-400 transition-colors ${
                value?.modelType === option.value
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                  : 'border-gray-300'
              }`}
            >
              <div className="flex flex-1">
                <div className="flex flex-col">
                  <span className="block text-sm font-medium text-gray-900">
                    {option.label}
                  </span>
                  <span className="mt-1 text-xs text-gray-500">
                    {option.description}
                  </span>
                </div>
              </div>
              {value?.modelType === option.value && (
                <div className="flex h-5 items-center">
                  <div className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center">
                    <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
