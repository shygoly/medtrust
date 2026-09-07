'use client';

import { useEffect, useState } from 'react';
import { api } from '@/api/client';

type SystemStatus = {
  node: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  env: Record<string, string | null>;
  generatedAt: string;
};

export default function AdminSystemPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getSystemStatus();
        setStatus(res);
      } catch (err: any) {
        setError(err.message || '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="text-xs text-gray-400">ADMIN · 平台管理</div>
        <h1 className="text-2xl font-semibold mt-1">系统状态</h1>
        <p className="text-sm text-gray-500 mt-1">平台管理员专属;系统级信息(不含密钥)。</p>
      </div>

      {error && <div className="mb-4 bg-red-50 text-red-500 p-3 rounded text-sm">{error}</div>}
      {loading && <div className="text-gray-400 text-sm">加载中…</div>}

      {status && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><div className="text-xs text-gray-400">Node</div><div className="font-mono text-sm">{status.node}</div></div>
            <div><div className="text-xs text-gray-400">平台</div><div className="font-mono text-sm">{status.platform}/{status.arch}</div></div>
            <div><div className="text-xs text-gray-400">运行时长</div><div className="font-mono text-sm">{Math.round(status.uptimeSeconds / 60)} 分钟</div></div>
            <div><div className="text-xs text-gray-400">生成时间</div><div className="font-mono text-sm">{new Date(status.generatedAt).toLocaleString()}</div></div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-2">环境摘要</div>
            <table className="w-full text-sm border border-gray-100">
              <tbody>
                {Object.entries(status.env).map(([k, v]) => (
                  <tr key={k} className="border-b border-gray-50">
                    <td className="px-3 py-2 text-gray-500">{k}</td>
                    <td className="px-3 py-2 font-mono">{v ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
