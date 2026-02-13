'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TaskStatusBadge } from './task-status-badge';
import { TaskProgressBar } from './task-progress-bar';
import type { ComputeTask } from '@/types/compute-task.types';
import { statusBgColors } from '@/types/task-status.types';

interface TaskDetailCardProps {
  task: ComputeTask;
  wsStatus?: string;
  wsProgress?: number;
  onCancel?: () => Promise<void>;
  onRefresh?: () => void;
  cancelling?: boolean;
}

const methodLabels: Record<string, string> = {
  fl: '联邦学习',
  mpc: '多方安全计算',
  tee: '可信执行环境',
  sandbox: '沙箱计算',
};

export function TaskDetailCard({
  task,
  wsStatus,
  wsProgress,
  onCancel,
  onRefresh,
  cancelling,
}: TaskDetailCardProps) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const displayStatus = wsStatus || task.status;
  const displayProgress = wsProgress !== undefined ? wsProgress : (task.progress || 0);
  const isRunning = displayStatus === 'running';
  const canCancel = isRunning && !cancelling;

  const handleCancel = async () => {
    if (onCancel) {
      await onCancel();
      setShowCancelConfirm(false);
    }
  };

  return (
    <div className="bg-white shadow rounded-lg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{task.name}</h2>
          <p className="mt-1 text-sm text-gray-500">
            ID: {task.id} · 创建于 {new Date(task.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center space-x-3">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
              title="刷新"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          <TaskStatusBadge status={displayStatus as any} pulse={isRunning} size="lg" />
        </div>
      </div>

      {/* Progress */}
      {isRunning && (
        <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
          <TaskProgressBar progress={displayProgress} status={displayStatus as any} size="lg" showPercentage />
          <p className="mt-2 text-sm text-blue-700">
            任务正在执行中，进度会通过 WebSocket 实时更新
          </p>
        </div>
      )}

      {/* Content */}
      <div className="px-6 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 基本信息 */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
              基本信息
            </h3>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">计算方法</dt>
                <dd className="mt-1 text-sm text-gray-900">{methodLabels[task.method] || task.method}</dd>
              </div>
              {task.description && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">描述</dt>
                  <dd className="mt-1 text-sm text-gray-900">{task.description}</dd>
                </div>
              )}
              {task.requestId && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">关联申请</dt>
                  <dd className="mt-1 text-sm text-gray-900">{task.requestId}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* 时间信息 */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
              执行时间
            </h3>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">创建时间</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {new Date(task.createdAt).toLocaleString()}
                </dd>
              </div>
              {task.startedAt && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">开始时间</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {new Date(task.startedAt).toLocaleString()}
                  </dd>
                </div>
              )}
              {task.completedAt && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">完成时间</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {new Date(task.completedAt).toLocaleString()}
                  </dd>
                </div>
              )}
              {task.startedAt && task.completedAt && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">执行时长</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {Math.round((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000)} 秒
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* 错误信息 */}
        {task.errorMessage && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">执行错误</h3>
                <p className="mt-1 text-sm text-red-700">{task.errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* 结果摘要 */}
        {task.resultSummary && (
          <div className="mt-6 bg-green-50 border border-green-200 rounded-md p-4">
            <h3 className="text-sm font-medium text-green-800 mb-2">执行结果</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {task.resultSummary.accuracy !== undefined && (
                <div className="bg-white rounded p-3">
                  <div className="text-2xl font-bold text-green-600">
                    {(task.resultSummary.accuracy * 100).toFixed(2)}%
                  </div>
                  <div className="text-xs text-gray-500">准确率</div>
                </div>
              )}
              {task.resultSummary.loss !== undefined && (
                <div className="bg-white rounded p-3">
                  <div className="text-2xl font-bold text-blue-600">
                    {task.resultSummary.loss.toFixed(4)}
                  </div>
                  <div className="text-xs text-gray-500">损失值</div>
                </div>
              )}
              {task.resultSummary.roundsCompleted !== undefined && (
                <div className="bg-white rounded p-3">
                  <div className="text-2xl font-bold text-purple-600">
                    {task.resultSummary.roundsCompleted}
                  </div>
                  <div className="text-xs text-gray-500">完成轮次</div>
                </div>
              )}
              {task.resultSummary.clientParticipation !== undefined && (
                <div className="bg-white rounded p-3">
                  <div className="text-2xl font-bold text-orange-600">
                    {task.resultSummary.clientParticipation}
                  </div>
                  <div className="text-xs text-gray-500">参与客户端</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
        <div className="flex space-x-3">
          {task.status === 'completed' && (
            <Link
              href={`/dashboard/compute/${task.id}/result`}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              查看完整结果
            </Link>
          )}
          {canCancel && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={cancelling}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {cancelling ? '取消中...' : '取消任务'}
            </button>
          )}
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">确认取消任务？</h3>
            <p className="text-sm text-gray-500 mb-6">
              取消操作不可撤销。正在运行的任务将被停止，已产生的计算结果可能会被丢弃。
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {cancelling ? '处理中...' : '确认取消'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
