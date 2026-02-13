'use client';

import { useState } from 'react';
import type { TaskFilters, TaskStatus, ComputeMethod } from '@/types/compute-task.types';

interface TaskFilterPanelProps {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  onClear: () => void;
}

const statusOptions: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'pending', label: '待执行', color: 'bg-gray-100 text-gray-800' },
  { value: 'running', label: '执行中', color: 'bg-blue-100 text-blue-800' },
  { value: 'completed', label: '已完成', color: 'bg-green-100 text-green-800' },
  { value: 'failed', label: '失败', color: 'bg-red-100 text-red-800' },
  { value: 'cancelled', label: '已取消', color: 'bg-yellow-100 text-yellow-800' },
];

const methodOptions: { value: ComputeMethod; label: string }[] = [
  { value: 'fl', label: '联邦学习' },
  { value: 'mpc', label: '多方安全计算' },
  { value: 'tee', label: '可信执行环境' },
  { value: 'sandbox', label: '沙箱计算' },
];

export function TaskFilterPanel({ filters, onChange, onClear }: TaskFilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchInput, setSearchInput] = useState(filters.search || '');

  const hasActiveFilters = 
    (filters.status?.length ?? 0) > 0 || 
    (filters.method?.length ?? 0) > 0 ||
    filters.dateRange ||
    filters.search;

  const toggleStatus = (status: TaskStatus) => {
    const currentStatuses = filters.status || [];
    const newStatuses = currentStatuses.includes(status)
      ? currentStatuses.filter(s => s !== status)
      : [...currentStatuses, status];
    onChange({ ...filters, status: newStatuses.length > 0 ? newStatuses : undefined });
  };

  const toggleMethod = (method: ComputeMethod) => {
    const currentMethods = filters.method || [];
    const newMethods = currentMethods.includes(method)
      ? currentMethods.filter(m => m !== method)
      : [...currentMethods, method];
    onChange({ ...filters, method: newMethods.length > 0 ? newMethods : undefined });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onChange({ ...filters, search: searchInput || undefined });
  };

  const handleClear = () => {
    setSearchInput('');
    onClear();
  };

  return (
    <div className="bg-white rounded-lg shadow mb-6">
      {/* Search Bar */}
      <div className="p-4 border-b border-gray-200">
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索任务名称..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <svg className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            搜索
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClear}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              清除筛选
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 flex items-center"
          >
            高级筛选
            <svg className={`ml-1 w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </form>
      </div>

      {/* Expanded Filters */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
            <div className="flex flex-wrap gap-2">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => toggleStatus(option.value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    filters.status?.includes(option.value)
                      ? option.color
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Method Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">计算方法</label>
            <div className="flex flex-wrap gap-2">
              {methodOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => toggleMethod(option.value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    filters.method?.includes(option.value)
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date Range Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">创建时间</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={filters.dateRange?.start || ''}
                onChange={(e) => onChange({
                  ...filters,
                  dateRange: e.target.value
                    ? { start: e.target.value, end: filters.dateRange?.end || e.target.value }
                    : undefined
                })}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <span className="flex items-center text-gray-500">至</span>
              <input
                type="date"
                value={filters.dateRange?.end || ''}
                onChange={(e) => onChange({
                  ...filters,
                  dateRange: e.target.value
                    ? { start: filters.dateRange?.start || e.target.value, end: e.target.value }
                    : undefined
                })}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Active Filter Tags */}
      {hasActiveFilters && !isExpanded && (
        <div className="px-4 py-2 bg-gray-50 flex flex-wrap gap-2 items-center">
          <span className="text-sm text-gray-500">已选筛选:</span>
          {filters.status?.map((status) => (
            <span key={status} className="inline-flex items-center px-2 py-1 rounded text-xs bg-blue-100 text-blue-800">
              {statusOptions.find(s => s.value === status)?.label}
              <button
                onClick={() => toggleStatus(status)}
                className="ml-1 hover:text-blue-600"
              >
                ×
              </button>
            </span>
          ))}
          {filters.method?.map((method) => (
            <span key={method} className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
              {methodOptions.find(m => m.value === method)?.label}
              <button
                onClick={() => toggleMethod(method)}
                className="ml-1 hover:text-green-600"
              >
                ×
              </button>
            </span>
          ))}
          {filters.search && (
            <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-purple-100 text-purple-800">
              搜索: {filters.search}
              <button
                onClick={() => { setSearchInput(''); onChange({ ...filters, search: undefined }); }}
                className="ml-1 hover:text-purple-600"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
