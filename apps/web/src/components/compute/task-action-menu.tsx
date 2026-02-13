'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ComputeTask } from '@/types/compute-task.types';

interface TaskActionMenuProps {
  task: ComputeTask;
  onCancel?: () => Promise<void>;
  onRetry?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function TaskActionMenu({ task, onCancel, onRetry, onDelete }: TaskActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const canCancel = task.status === 'pending' || task.status === 'running';
  const canRetry = task.status === 'failed' || task.status === 'cancelled';
  const canDelete = task.status !== 'running';

  const handleCancel = async () => {
    if (!onCancel) return;
    setActionLoading(true);
    try {
      await onCancel();
      setShowCancelConfirm(false);
    } finally {
      setActionLoading(false);
      setIsOpen(false);
    }
  };

  const handleRetry = async () => {
    if (!onRetry) return;
    setActionLoading(true);
    try {
      await onRetry();
    } finally {
      setActionLoading(false);
      setIsOpen(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setActionLoading(true);
    try {
      await onDelete();
      setShowDeleteConfirm(false);
    } finally {
      setActionLoading(false);
      setIsOpen(false);
    }
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-20">
              <div className="py-1" role="menu">
                <Link
                  href={`/dashboard/compute/${task.id}`}
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  onClick={() => setIsOpen(false)}
                >
                  查看详情
                </Link>
                
                {task.status === 'completed' && (
                  <Link
                    href={`/dashboard/compute/${task.id}/result`}
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => setIsOpen(false)}
                  >
                    查看结果
                  </Link>
                )}

                {canCancel && onCancel && (
                  <button
                    onClick={() => {
                      setShowCancelConfirm(true);
                      setIsOpen(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                  >
                    取消任务
                  </button>
                )}

                {canRetry && onRetry && (
                  <button
                    onClick={handleRetry}
                    disabled={actionLoading}
                    className="block w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-gray-100 disabled:opacity-50"
                  >
                    {actionLoading ? '重试中...' : '重试任务'}
                  </button>
                )}

                {canDelete && onDelete && (
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(true);
                      setIsOpen(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                  >
                    删除任务
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Cancel Confirmation */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">确认取消任务？</h3>
            <p className="text-sm text-gray-500 mb-6">
              取消操作不可撤销。正在运行的任务将被停止。
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
                disabled={actionLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? '处理中...' : '确认取消'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">确认删除任务？</h3>
            <p className="text-sm text-gray-500 mb-6">
              删除后任务将无法恢复，相关数据也将被删除。
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
