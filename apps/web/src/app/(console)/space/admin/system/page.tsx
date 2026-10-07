'use client';

import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { formatDateTime } from '@/lib/attestations';
import { AsyncBoundary, DataGrid, type GridColumn } from '@/components/console/data';
import { Field, PageHeader, Panel } from '@/components/console/ui';

type SystemStatus = {
  node: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  env: Record<string, string | null>;
  generatedAt: string;
};

type EnvRow = { key: string; value: string | null };

const envColumns: GridColumn<EnvRow>[] = [
  { header: '键', className: 'col-span-5 min-w-0 pr-3', cell: (r) => <span className="cs-mono text-xs break-all" style={{ color: 'var(--cs-dim)' }}>{r.key}</span> },
  { header: '值', className: 'col-span-7 min-w-0', cell: (r) => <span className="cs-mono text-xs break-all">{r.value ?? '—'}</span> },
];

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
    <div>
      <PageHeader kicker="ADMIN · 平台管理" desc="平台管理员专属;系统级信息(不含密钥)。" />
      <div className="p-8 space-y-6">
        <AsyncBoundary loading={loading} error={error || undefined} errorText={error} empty={!status} loadingText="加载中…">
          {status && (
            <>
              <Panel className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <Field label="Node" mono>{status.node}</Field>
                  <Field label="平台" mono>{status.platform}/{status.arch}</Field>
                  <Field label="运行时长" mono>{Math.round(status.uptimeSeconds / 60)} 分钟</Field>
                  <Field label="生成时间" mono>{formatDateTime(status.generatedAt)}</Field>
                </div>
              </Panel>
              <div>
                <div className="cs-label mb-3">ENV · 环境摘要</div>
                <DataGrid
                  columns={envColumns}
                  rows={Object.entries(status.env).map(([key, value]) => ({ key, value }))}
                  rowKey={(r) => r.key}
                  emptyText="无环境摘要。"
                />
              </div>
            </>
          )}
        </AsyncBoundary>
      </div>
    </div>
  );
}
