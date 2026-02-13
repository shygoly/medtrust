import type { TaskStatus } from './compute-task.types';

// 状态配置 - 颜色
export const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-yellow-100 text-yellow-800',
};

// 状态配置 - 边框颜色（用于进度条）
export const statusBorderColors: Record<TaskStatus, string> = {
  pending: 'border-gray-500',
  running: 'border-blue-500',
  completed: 'border-green-500',
  failed: 'border-red-500',
  cancelled: 'border-yellow-500',
};

// 状态配置 - 背景色（用于进度条）
export const statusBgColors: Record<TaskStatus, string> = {
  pending: 'bg-gray-500',
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  cancelled: 'bg-yellow-500',
};

// 状态标签（中文）
export const statusLabels: Record<TaskStatus, string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

// 状态描述
export const statusDescriptions: Record<TaskStatus, string> = {
  pending: '任务正在等待执行',
  running: '任务正在执行中',
  completed: '任务已成功完成',
  failed: '任务执行失败',
  cancelled: '任务已取消',
};

// 状态流转规则
export const statusTransitions: Record<TaskStatus, TaskStatus[]> = {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

// 检查状态是否可以转换
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return statusTransitions[from]?.includes(to) ?? false;
}

// 获取可用的下一个状态
export function getAvailableTransitions(status: TaskStatus): TaskStatus[] {
  return statusTransitions[status] || [];
}
