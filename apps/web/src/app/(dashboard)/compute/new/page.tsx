'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TaskCreateForm } from '@/components/compute/task-create-form';

export default function CreateComputeTaskPage() {
  const router = useRouter();

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      {/* Header with back button */}
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
        <h1 className="text-2xl font-semibold text-gray-900 mt-2">新建计算任务</h1>
        <p className="mt-1 text-sm text-gray-700">
          创建隐私计算任务，配置算法参数并启动训练
        </p>
      </div>

      {/* Form */}
      <div className="max-w-4xl">
        <TaskCreateForm onCancel={() => router.push('/dashboard/compute')} />
      </div>
    </div>
  );
}
