'use client';

import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { statusTone } from '@/lib/status-tone';
import { DataGrid, type GridColumn } from '@/components/console/data';
import { Banner, PageHeader, StatusChip } from '@/components/console/ui';

type Subject = {
  subjectId: string;
  nodeId: string;
  orgName?: string;
  uscc?: string;
  region?: string;
  legalPerson?: string;
  status: string;
};

const columns: GridColumn<Subject>[] = [
  { header: '主体 ID', className: 'col-span-3 min-w-0 pr-3', cell: (s) => <div className="cs-mono text-xs truncate" title={s.subjectId} style={{ color: 'var(--cs-dim)' }}>{s.subjectId}</div> },
  { header: '机构名称', className: 'col-span-3 min-w-0 pr-3', cell: (s) => <span className="text-sm">{s.orgName || '—'}</span> },
  { header: '统一社会信用代码', className: 'col-span-3 min-w-0 pr-3', cell: (s) => <span className="cs-mono text-xs">{s.uscc || '—'}</span> },
  { header: '注册地', className: 'col-span-2', cell: (s) => <span className="text-sm">{s.region || '—'}</span> },
  { header: '状态', className: 'col-span-1', cell: (s) => <StatusChip tone={statusTone(s.status)}>{s.status}</StatusChip> },
];

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
    <div>
      <PageHeader kicker="ADMIN/OPERATOR · 丝路数港互认" desc="区域节点对接(身份互认 / 目录同步 / 日志上报)。生产需配置 SILKROAD_NODE_ENDPOINT,未配置则 fail-closed;开发环境使用 mock 主体。" />
      <div className="p-8 space-y-4">
        <div className="flex flex-wrap gap-3">
          <button className="cs-btn disabled:opacity-50" disabled={busy} onClick={() => act(() => api.syncSilkRoadSubjects(), '主体同步')}>同步注册主体</button>
          <button className="cs-btn cs-btn-ghost disabled:opacity-50" disabled={busy} onClick={() => act(() => api.pushSilkRoadCatalog(), '目录推送')}>推送数据产品目录</button>
          <button className="cs-btn cs-btn-ghost disabled:opacity-50" disabled={busy} onClick={() => act(() => api.reportSilkRoadAudit(), '日志上报')}>上报审计摘要</button>
        </div>

        {error && <Banner>{error}</Banner>}
        {notice && <Banner tone="success" className="break-all">{notice}</Banner>}

        <div>
          <div className="cs-label mb-3">SUBJECTS · 已同步主体({subjects.length})</div>
          <DataGrid
            columns={columns}
            rows={subjects}
            rowKey={(s) => s.subjectId}
            loading={loading}
            loadingText="加载中…"
            emptyText="暂无同步主体,点击「同步注册主体」。"
          />
        </div>
      </div>
    </div>
  );
}
