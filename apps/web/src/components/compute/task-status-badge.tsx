'use client';

import type { TaskStatus } from '@/types/compute-task.types';
import { statusColors, statusLabels, statusDescriptions } from '@/types/task-status.types';

interface TaskStatusBadgeProps {
  status: TaskStatus;
  showDescription?: boolean;
  pulse?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-sm',
  lg: 'px-3 py-1 text-base',
};

export function TaskStatusBadge({
  status,
  showDescription = false,
  pulse = false,
  size = 'md',
}: TaskStatusBadgeProps) {
  const baseClasses = `inline-flex items-center rounded-full font-medium ${sizeClasses[size]} ${statusColors[status]}`;
  
  return (
    <div className="flex flex-col">
      <span className={baseClasses}>
        {pulse && status === 'running' && (
          <span className="mr-1.5 flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
        )}
        {statusLabels[status]}
      </span>
      {showDescription && (
        <span className="mt-1 text-xs text-gray-500">
          {statusDescriptions[status]}
        </span>
      )}
    </div>
  );
}
