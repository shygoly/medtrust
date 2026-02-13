'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/api/client';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    tenants: 0,
    assets: 0,
    requests: 0,
  });

  useEffect(() => {
    // TODO: Fetch actual stats from API
    setStats({
      tenants: 5,
      assets: 12,
      requests: 8,
    });
  }, []);

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900">仪表板</h1>
      
      {/* 统计卡片 */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="text-3xl">🏢</div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">租户数量</dt>
                  <dd className="text-2xl font-semibold text-gray-900">{stats.tenants}</dd>
                </dl>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-5 py-3">
            <Link href="/dashboard/tenants" className="text-sm text-blue-600 hover:text-blue-500">
              查看详情 →
            </Link>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="text-3xl">📊</div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">数据资产</dt>
                  <dd className="text-2xl font-semibold text-gray-900">{stats.assets}</dd>
                </dl>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-5 py-3">
            <Link href="/dashboard/assets" className="text-sm text-blue-600 hover:text-blue-500">
              查看详情 →
            </Link>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="text-3xl">🔐</div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">访问申请</dt>
                  <dd className="text-2xl font-semibold text-gray-900">{stats.requests}</dd>
                </dl>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-5 py-3">
            <Link href="/dashboard/requests" className="text-sm text-blue-600 hover:text-blue-500">
              查看详情 →
            </Link>
          </div>
        </div>
      </div>

      {/* 快速操作 */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-900">快速操作</h2>
        <div className="mt-4 flex flex-wrap gap-4">
          <Link
            href="/dashboard/assets/new"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            + 上传数据资产
          </Link>
          <Link
            href="/dashboard/requests/new"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-blue-600 bg-blue-100 hover:bg-blue-200"
          >
            + 发起访问申请
          </Link>
        </div>
      </div>
    </div>
  );
}
