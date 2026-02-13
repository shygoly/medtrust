'use client';

import Link from 'next/link';
import { useComputeTasks } from '@/hooks/use-compute-tasks';
import { TaskListTable } from '@/components/compute/task-list-table';
import { TaskFilterPanel } from '@/components/compute/task-filter-panel';

export default function ComputeTasksPage() {
  const {
    tasks,
    loading,
    error,
    pagination,
    filters,
    updateFilters,
    clearFilters,
    goToPage,
    changePageSize,
    updateSort,
    refresh,
  } = useComputeTasks({ autoFetch: true });

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">计算任务</h1>
          <p className="mt-2 text-sm text-gray-700">
            管理隐私计算任务，包括联邦学习、多方安全计算等
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <Link
            href="/dashboard/compute/new"
            className="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新建任务
          </Link>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mt-6 bg-red-50 border border-red-200 text-red-600 p-4 rounded-md">
          <div className="flex">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {error}
            <button onClick={refresh} className="ml-4 text-sm underline">重试</button>
          </div>
        </div>
      )}

      {/* Filter Panel */}
      <div className="mt-6">
        <TaskFilterPanel
          filters={filters}
          onChange={updateFilters}
          onClear={clearFilters}
        />
      </div>

      {/* Task Table */}
      <div className="mt-6">
        <TaskListTable
          tasks={tasks}
          loading={loading}
          onSort={(field) => updateSort({ field, direction: 'desc' })}
        />
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-gray-700">
            显示第 {(pagination.page - 1) * pagination.pageSize + 1} 到{' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} 条，
            共 {pagination.total} 条
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              上一页
            </button>
            <span className="text-sm text-gray-600">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              下一页
            </button>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">每页</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => changePageSize(parseInt(e.target.value))}
              className="px-2 py-1 border border-gray-300 rounded-md text-sm"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <span className="text-sm text-gray-600">条</span>
          </div>
        </div>
      )}
    </div>
  );
}
