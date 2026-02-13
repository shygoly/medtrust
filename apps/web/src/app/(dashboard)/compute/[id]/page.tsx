'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useComputeTask } from '@/hooks/use-compute-task';
import { useTaskWebSocket } from '@/api/websocket';
import { useTaskLogs } from '@/hooks/use-task-logs';
import { TaskDetailCard } from '@/components/compute/task-detail-card';
import { TaskStatusBadge } from '@/components/compute/task-status-badge';
import { TaskProgressBar } from '@/components/compute/task-progress-bar';

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = params.id as string;
  const [showLogs, setShowLogs] = useState(false);

  const {
    task,
    loading,
    error,
    cancelling,
    fetchTask,
    cancelTask,
    retryTask,
  } = useComputeTask(taskId, { autoFetch: true, pollInterval: 5000 });

  const {
    status: wsStatus,
    progress: wsProgress,
    connected,
    logs: wsLogs,
  } = useTaskWebSocket(taskId);

  const {
    logs,
    loading: logsLoading,
    hasMore,
    loadMore,
    refresh: refreshLogs,
  } = useTaskLogs(taskId, { pageSize: 50 });

  if (loading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-md">
          <div className="flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {error || '任务不存在'}
          </div>
          <Link href="/dashboard/compute" className="mt-2 inline-block text-sm underline">
            返回任务列表
          </Link>
        </div>
      </div>
    );
  }

  const displayStatus = wsStatus || task.status;
  const displayProgress = wsProgress !== undefined ? wsProgress : (task.progress || 0);

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/dashboard/compute"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回任务列表
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">任务详情</h1>
            <p className="mt-1 text-sm text-gray-700">
              查看任务执行状态和详细信息
            </p>
          </div>
          <div className="flex items-center space-x-4">
            {/* WebSocket Connection Status */}
            <div className="flex items-center text-sm">
              <span className="mr-2 text-gray-500">实时连接:</span>
              {connected ? (
                <span className="flex items-center text-green-600">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></span>
                  已连接
                </span>
              ) : (
                <span className="flex items-center text-gray-400">
                  <span className="w-2 h-2 bg-gray-400 rounded-full mr-1"></span>
                  未连接
                </span>
              )}
            </div>
            {task.status === 'completed' && (
              <Link
                href={`/dashboard/compute/${task.id}/result`}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                查看结果
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Task Detail Card */}
      <TaskDetailCard
        task={task}
        wsStatus={displayStatus}
        wsProgress={displayProgress}
        onCancel={cancelTask}
        onRefresh={fetchTask}
        cancelling={cancelling}
      />

      {/* Real-time Progress (if running) */}
      {displayStatus === 'running' && (
        <div className="mt-6 bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">实时进度</h3>
          <TaskProgressBar progress={displayProgress} status="running" showPercentage size="lg" />
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded p-3">
              <div className="text-sm text-gray-500">当前状态</div>
              <TaskStatusBadge status="running" pulse />
            </div>
            <div className="bg-gray-50 rounded p-3">
              <div className="text-sm text-gray-500">完成进度</div>
              <div className="text-lg font-semibold">{displayProgress.toFixed(1)}%</div>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <div className="text-sm text-gray-500">WebSocket</div>
              <div className={`text-lg font-semibold ${connected ? 'text-green-600' : 'text-gray-400'}`}>
                {connected ? '已连接' : '未连接'}
              </div>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <div className="text-sm text-gray-500">实时日志</div>
              <div className="text-lg font-semibold">{wsLogs.length} 条</div>
            </div>
          </div>
        </div>
      )}

      {/* Logs Section */}
      <div className="mt-6">
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="flex items-center justify-between w-full bg-white shadow rounded-lg p-4 hover:bg-gray-50"
        >
          <div className="flex items-center">
            <svg className="w-5 h-5 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-lg font-medium text-gray-900">执行日志</span>
          </div>
          <svg
            className={`w-5 h-5 text-gray-400 transform transition-transform ${showLogs ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showLogs && (
          <div className="mt-2 bg-white shadow rounded-lg p-4">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm text-gray-500">
                显示 {logs.length} 条日志
                {wsLogs.length > 0 && ` (+${wsLogs.length} 条实时)`}
              </span>
              <button
                onClick={refreshLogs}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                刷新
              </button>
            </div>

            {/* WebSocket Logs */}
            {wsLogs.length > 0 && (
              <div className="mb-4 bg-blue-50 rounded p-3">
                <div className="text-xs text-blue-600 font-medium mb-2">实时消息</div>
                {wsLogs.slice(-5).map((log, i) => (
                  <div key={`ws-${i}`} className="text-sm text-gray-700 py-1">
                    <span className="text-blue-500">[实时]</span> {log}
                  </div>
                ))}
              </div>
            )}

            {/* API Logs */}
            <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-sm">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`py-1 px-2 rounded ${
                    log.level === 'error' ? 'bg-red-50 text-red-700' :
                    log.level === 'warn' ? 'bg-yellow-50 text-yellow-700' :
                    'text-gray-700'
                  }`}
                >
                  <span className="text-gray-400">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                  <span className={`ml-2 text-xs font-semibold ${
                    log.level === 'error' ? 'text-red-500' :
                    log.level === 'warn' ? 'text-yellow-500' :
                    'text-blue-500'
                  }`}>
                    {log.level.toUpperCase()}
                  </span>
                  <span className="ml-2">{log.message}</span>
                </div>
              ))}
            </div>

            {hasMore && (
              <div className="mt-4 text-center">
                <button
                  onClick={loadMore}
                  disabled={logsLoading}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {logsLoading ? '加载中...' : '加载更多'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
