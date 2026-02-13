'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTaskResult } from '@/hooks/use-task-result';
import { TaskResultViewer } from '@/components/compute/task-result-viewer';

export default function TaskResultPage() {
  const params = useParams();
  const taskId = params.id as string;

  const {
    result,
    loading,
    error,
    exporting,
    exportResult,
    downloadModel,
    fetchResult,
  } = useTaskResult(taskId, { autoFetch: true });

  if (loading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-96 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-md">
          <div className="flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
          <div className="mt-4 flex space-x-3">
            <button onClick={fetchResult} className="text-sm underline">
              重试
            </button>
            <Link href={`/dashboard/compute/${taskId}`} className="text-sm underline">
              返回任务详情
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 p-4 rounded-md">
          <p>暂无结果数据</p>
          <Link href={`/dashboard/compute/${taskId}`} className="mt-2 inline-block text-sm underline">
            返回任务详情
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center space-x-4">
          <Link
            href="/dashboard/compute"
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            任务列表
          </Link>
          <span className="text-gray-300">/</span>
          <Link
            href={`/dashboard/compute/${taskId}`}
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
          >
            任务详情
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm text-gray-900">结果</span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mt-2">任务执行结果</h1>
        <p className="mt-1 text-sm text-gray-700">
          查看训练结果、性能指标和模型下载
        </p>
      </div>

      {/* Result Viewer */}
      <TaskResultViewer
        result={result}
        onExport={exportResult}
        onDownloadModel={downloadModel}
        exporting={exporting}
      />
    </div>
  );
}
