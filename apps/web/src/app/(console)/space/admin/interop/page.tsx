'use client';

import { useEffect, useState } from 'react';
import { api } from '@/api/client';

type Subject = {
  subjectId: string;
  nodeId: string;
  orgName?: string;
  uscc?: string;
  region?: string;
  legalPerson?: string;
  status: string;
};

export default function AdminInteropPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getSilkRoadSubjects();
      setSubjects(res);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn: () => Promise<{ [k: string]: unknown }>, ok: string) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await fn();
      setNotice(`${ok}:${JSON.stringify(res)}`);
      await load();
    } catch (err: any) {
      setError(err.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="text-xs text-gray-400">ADMIN/OPERATOR · 丝路数港互认</div>
        <h1 className="text-2xl font-semibold mt-1">丝路数港互认</h1>
        <p className="text-sm text-gray-500 mt-1">
          区域节点对接(身份互认 / 目录同步 / 日志上报)。生产需配置 SILKROAD_NODE_ENDPOINT,未配置则 fail-closed;开发环境使用 mock 主体。
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <button className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm disabled:opacity-50" disabled={busy} onClick={() => act(() => api.syncSilkRoadSubjects(), '主体同步')}>同步注册主体</button>
        <button className="px-4 py-2 bg-teal-600 text-white rounded-md text-sm disabled:opacity-50" disabled={busy} onClick={() => act(() => api.pushSilkRoadCatalog(), '目录推送')}>推送数据产品目录</button>
        <button className="px-4 py-2 bg-violet-600 text-white rounded-md text-sm disabled:opacity-50" disabled={busy} onClick={() => act(() => api.reportSilkRoadAudit(), '日志上报')}>上报审计摘要</button>
      </div>

      {error && <div className="mb-4 bg-red-50 text-red-500 p-3 rounded text-sm">{error}</div>}
      {notice && <div className="mb-4 bg-green-50 text-green-600 p-3 rounded text-sm">{notice}</div>}

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-3 border-b text-sm font-medium">已同步主体({subjects.length})</div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">加载中…</div>
        ) : subjects.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">暂无同步主体,点击「同步注册主体」。</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">主体ID</th>
                <th className="text-left px-4 py-2 font-medium">机构名称</th>
                <th className="text-left px-4 py-2 font-medium">统一社会信用代码</th>
                <th className="text-left px-4 py-2 font-medium">注册地</th>
                <th className="text-left px-4 py-2 font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {subjects.map((s) => (
                <tr key={s.subjectId}>
                  <td className="px-4 py-2 text-gray-400">{s.subjectId}</td>
                  <td className="px-4 py-2">{s.orgName || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{s.uscc || '—'}</td>
                  <td className="px-4 py-2">{s.region || '—'}</td>
                  <td className="px-4 py-2">{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
