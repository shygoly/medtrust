'use client';

import Link from 'next/link';
import type { ComputeTask } from '@/types/compute-task.types';
import { statusColors, statusLabels } from '@/types/task-status.types';

interface TaskListTableProps {
  tasks: ComputeTask[];
  loading?: boolean;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: string) => void;
}

const methodLabels: Record<string, string> = {
  fl: '联邦学习',
  mpc: '多方安全计算',
  tee: '可信执行环境',
  sandbox: '沙箱计算',
};

export function TaskListTable({
  tasks,
  loading,
  sortField,
  sortDirection,
  onSort,
}: TaskListTableProps) {
  const getSortIndicator = (field: string) => {
    if (sortField !== field) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const SortableHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <th
      scope="col"
      className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100 select-none"
      onClick={() => onSort?.(field)}
    >
      <div className="flex items-center space-x-1">
        <span>{children}</span>
        {onSort && <span className="text-xs text-gray-400">{getSortIndicator(field)}</span>}
      </div>
    </th>
  );

  if (loading) {
    return (
      <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
        <div className="animate-pulse">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white p-4 border-b border-gray-200">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
      <table className="min-w-full divide-y divide-gray-300">
        <thead className="bg-gray-50">
          <tr>
            <SortableHeader field="name">任务名称</SortableHeader>
            <SortableHeader field="method">计算方法</SortableHeader>
            <SortableHeader field="status">状态</SortableHeader>
            <SortableHeader field="createdAt">创建时间</SortableHeader>
            <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {tasks.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-12 text-center text-gray-500">
                <div className="flex flex-col items-center justify-center">
                  <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="text-gray-500">暂无计算任务</p>
                  <p className="text-sm text-gray-400 mt-1">点击上方按钮创建新任务</p>
                </div>
              </td>
            </tr>
          ) : (
            tasks.map((task) => (
              <tr key={task.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                  <div className="flex flex-col">
                    <span>{task.name}</span>
                    {task.description && (
                      <span className="text-xs text-gray-400 truncate max-w-xs">{task.description}</span>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                    {methodLabels[task.method] || task.method}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm">
                  <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${statusColors[task.status]}`}>
                    {statusLabels[task.status]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                  {new Date(task.createdAt).toLocaleString()}
                </td>
                <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                  <div className="flex items-center justify-end space-x-3">
                    <Link
                      href={`/dashboard/compute/${task.id}`}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      查看
                    </Link>
                    {task.status === 'completed' && (
                      <Link
                        href={`/dashboard/compute/${task.id}/result`}
                        className="text-green-600 hover:text-green-900"
                      >
                        结果
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
