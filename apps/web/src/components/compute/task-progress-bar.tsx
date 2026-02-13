'use client';

import type { TaskStatus } from '@/types/compute-task.types';
import { statusBgColors } from '@/types/task-status.types';

interface TaskProgressBarProps {
  progress: number;
  status: TaskStatus;
  showPercentage?: boolean;
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
}

const sizeClasses = {
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-3',
};

export function TaskProgressBar({
  progress,
  status,
  showPercentage = false,
  size = 'md',
  animated = true,
}: TaskProgressBarProps) {
  const clampedProgress = Math.min(Math.max(progress, 0), 100);
  const bgColor = statusBgColors[status] || 'bg-gray-500';

  return (
    <div className="w-full">
      <div className={`w-full bg-gray-200 rounded-full ${sizeClasses[size]} overflow-hidden`}>
        <div
          className={`${bgColor} ${sizeClasses[size]} rounded-full transition-all duration-500 ease-out ${
            animated && status === 'running' ? 'animate-pulse' : ''
          }`}
          style={{ width: `${clampedProgress}%` }}
          role="progressbar"
          aria-valuenow={clampedProgress}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      {showPercentage && (
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-500">进度</span>
          <span className="text-xs font-medium text-gray-700">{clampedProgress.toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}
