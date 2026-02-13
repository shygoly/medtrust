'use client';

import { useState } from 'react';
import type { TaskResult, ExportFormat, MetricPoint, ClientParticipation } from '@/types/task-result.types';

interface TaskResultViewerProps {
  result: TaskResult;
  onExport?: (format: ExportFormat) => void;
  onDownloadModel?: () => void;
  exporting?: boolean;
}

export function TaskResultViewer({
  result,
  onExport,
  onDownloadModel,
  exporting,
}: TaskResultViewerProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'charts' | 'details'>('summary');

  const handleExport = (format: ExportFormat) => {
    onExport?.(format);
  };

  // Calculate trend (mock - in real app would compare with previous results)
  const getTrend = (value: number, threshold: number): 'positive' | 'negative' | 'neutral' => {
    if (value >= threshold) return 'positive';
    if (value >= threshold * 0.8) return 'neutral';
    return 'negative';
  };

  const accuracyTrend = result.summary.accuracy ? getTrend(result.summary.accuracy, 0.9) : 'neutral';
  const lossTrend = result.summary.loss ? getTrend(1 - result.summary.loss, 0.9) : 'neutral';

  return (
    <div className="bg-white shadow rounded-lg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">任务结果</h2>
            <p className="mt-1 text-sm text-gray-500">
              任务 ID: {result.taskId} · 完成于 {new Date(result.completedAt).toLocaleString()}
            </p>
          </div>
          <div className="flex space-x-2">
            {onDownloadModel && result.modelDownloadUrl && (
              <button
                onClick={onDownloadModel}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载模型
              </button>
            )}
            {onExport && (
              <div className="relative group">
                <button className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  导出结果
                  <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className="absolute right-0 mt-2 w-32 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                  <div className="py-1">
                    <button
                      onClick={() => handleExport('json')}
                      disabled={exporting}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    >
                      导出为 JSON
                    </button>
                    <button
                      onClick={() => handleExport('csv')}
                      disabled={exporting}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    >
                      导出为 CSV
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex">
          <button
            onClick={() => setActiveTab('summary')}
            className={`py-4 px-6 border-b-2 font-medium text-sm ${
              activeTab === 'summary'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            摘要
          </button>
          <button
            onClick={() => setActiveTab('charts')}
            className={`py-4 px-6 border-b-2 font-medium text-sm ${
              activeTab === 'charts'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            图表
          </button>
          <button
            onClick={() => setActiveTab('details')}
            className={`py-4 px-6 border-b-2 font-medium text-sm ${
              activeTab === 'details'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            详细数据
          </button>
        </nav>
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Summary Tab */}
        {activeTab === 'summary' && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {result.summary.accuracy !== undefined && (
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-green-600 font-medium">准确率</p>
                      <p className="text-3xl font-bold text-green-800 mt-1">
                        {(result.summary.accuracy * 100).toFixed(2)}%
                      </p>
                    </div>
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      accuracyTrend === 'positive' ? 'bg-green-200' : 
                      accuracyTrend === 'neutral' ? 'bg-yellow-200' : 'bg-red-200'
                    }`}>
                      {accuracyTrend === 'positive' ? (
                        <svg className="w-6 h-6 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                        </svg>
                      ) : accuracyTrend === 'neutral' ? (
                        <svg className="w-6 h-6 text-yellow-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
                        </svg>
                      ) : (
                        <svg className="w-6 h-6 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {result.summary.loss !== undefined && (
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-blue-600 font-medium">损失值</p>
                      <p className="text-3xl font-bold text-blue-800 mt-1">
                        {result.summary.loss.toFixed(4)}
                      </p>
                    </div>
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      lossTrend === 'positive' ? 'bg-green-200' : 
                      lossTrend === 'neutral' ? 'bg-yellow-200' : 'bg-red-200'
                    }`}>
                      {lossTrend === 'positive' ? (
                        <svg className="w-6 h-6 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      ) : lossTrend === 'neutral' ? (
                        <svg className="w-6 h-6 text-yellow-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
                        </svg>
                      ) : (
                        <svg className="w-6 h-6 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {result.summary.trainingTime !== undefined && (
                <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-4 border border-purple-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-purple-600 font-medium">训练时长</p>
                      <p className="text-3xl font-bold text-purple-800 mt-1">
                        {Math.round(result.summary.trainingTime / 60)}m
                      </p>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-purple-200 flex items-center justify-center">
                      <svg className="w-6 h-6 text-purple-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                </div>
              )}

              {result.summary.roundsCompleted !== undefined && (
                <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-lg p-4 border border-orange-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-orange-600 font-medium">完成轮次</p>
                      <p className="text-3xl font-bold text-orange-800 mt-1">
                        {result.summary.roundsCompleted}
                        {result.summary.totalRounds && `/${result.summary.totalRounds}`}
                      </p>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-orange-200 flex items-center justify-center">
                      <svg className="w-6 h-6 text-orange-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Summary Text */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-900 mb-2">执行摘要</h3>
              <p className="text-sm text-gray-600">
                任务已成功完成。训练过程中，模型在 {result.summary.roundsCompleted} 轮联邦学习中逐步收敛，
                最终达到了 {(result.summary.accuracy! * 100).toFixed(2)}% 的准确率和 {result.summary.loss!.toFixed(4)} 的损失值。
                共有 {result.summary.clientParticipation} 个客户端参与了本次训练。
              </p>
            </div>
          </div>
        )}

        {/* Charts Tab */}
        {activeTab === 'charts' && (
          <div className="space-y-6">
            {/* Loss Chart */}
            {result.metrics.lossOverRounds.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-900 mb-4">损失值变化</h3>
                <div className="h-64 relative">
                  {/* Simple SVG Line Chart */}
                  <svg viewBox="0 0 400 200" className="w-full h-full">
                    {/* Grid lines */}
                    {[0, 1, 2, 3, 4].map((i) => (
                      <line
                        key={i}
                        x1="0"
                        y1={i * 50}
                        x2="400"
                        y2={i * 50}
                        stroke="#e5e7eb"
                        strokeWidth="1"
                      />
                    ))}
                    {/* Loss line */}
                    <polyline
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2"
                      points={result.metrics.lossOverRounds.map((p: MetricPoint, i: number) => {
                        const x = (i / (result.metrics.lossOverRounds.length - 1)) * 380 + 10;
                        const maxLoss = Math.max(...result.metrics.lossOverRounds.map((p: MetricPoint) => p.value));
                        const y = 190 - (p.value / maxLoss) * 180;
                        return `${x},${y}`;
                      }).join(' ')}
                    />
                    {/* Data points */}
                    {result.metrics.lossOverRounds.map((p: MetricPoint, i: number) => {
                      const x = (i / (result.metrics.lossOverRounds.length - 1)) * 380 + 10;
                      const maxLoss = Math.max(...result.metrics.lossOverRounds.map((p: MetricPoint) => p.value));
                      const y = 190 - (p.value / maxLoss) * 180;
                      return (
                        <circle
                          key={i}
                          cx={x}
                          cy={y}
                          r="4"
                          fill="#3b82f6"
                        />
                      );
                    })}
                  </svg>
                </div>
              </div>
            )}

            {/* Accuracy Chart */}
            {result.metrics.accuracyOverRounds.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-900 mb-4">准确率变化</h3>
                <div className="h-64 relative">
                  <svg viewBox="0 0 400 200" className="w-full h-full">
                    {/* Grid lines */}
                    {[0, 1, 2, 3, 4].map((i) => (
                      <line
                        key={i}
                        x1="0"
                        y1={i * 50}
                        x2="400"
                        y2={i * 50}
                        stroke="#e5e7eb"
                        strokeWidth="1"
                      />
                    ))}
                    {/* Accuracy line */}
                    <polyline
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2"
                      points={result.metrics.accuracyOverRounds.map((p: MetricPoint, i: number) => {
                        const x = (i / (result.metrics.accuracyOverRounds.length - 1)) * 380 + 10;
                        const y = 190 - (p.value * 180);
                        return `${x},${y}`;
                      }).join(' ')}
                    />
                    {/* Data points */}
                    {result.metrics.accuracyOverRounds.map((p: MetricPoint, i: number) => {
                      const x = (i / (result.metrics.accuracyOverRounds.length - 1)) * 380 + 10;
                      const y = 190 - (p.value * 180);
                      return (
                        <circle
                          key={i}
                          cx={x}
                          cy={y}
                          r="4"
                          fill="#10b981"
                        />
                      );
                    })}
                  </svg>
                </div>
              </div>
            )}

            {/* Client Participation */}
            {result.metrics.clientParticipation.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-900 mb-4">客户端参与情况</h3>
                <div className="space-y-2">
                  {result.metrics.clientParticipation.map((client: ClientParticipation) => (
                    <div key={client.clientId} className="flex items-center">
                      <span className="w-24 text-sm text-gray-600 truncate">{client.clientId}</span>
                      <div className="flex-1 mx-3 bg-gray-200 rounded-full h-4 overflow-hidden">
                        <div
                          className="bg-purple-500 h-full rounded-full"
                          style={{ width: `${(client.roundsParticipated / client.totalRounds) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-700">
                        {client.roundsParticipated}/{client.totalRounds}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Details Tab */}
        {activeTab === 'details' && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-900 mb-2">完整结果数据</h3>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
