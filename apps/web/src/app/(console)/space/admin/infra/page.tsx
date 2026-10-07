'use client';

import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { formatDateTime } from '@/lib/attestations';
import { statusTone } from '@/lib/status-tone';
import { DataGrid, type GridColumn } from '@/components/console/data';
import { Banner, Field, PageHeader, Panel, StatusChip } from '@/components/console/ui';

type Space = { id: string; name: string; description?: string; status: string; createdAt: string };
type Cert = { sm2Fingerprint: string; participantId: string; connectorId: string; validUntil: string; revoked: boolean; issuedAt: string };
type AppRow = { id: string; appId: string; name: string; scopes?: string[]; status: string; createdAt: string };

const spaceColumns: GridColumn<Space>[] = [
  { header: 'ID', className: 'col-span-4 min-w-0 pr-3', cell: (s) => <span className="cs-mono text-xs break-all">{s.id}</span> },
  { header: '名称', className: 'col-span-5 min-w-0 pr-3', cell: (s) => <span className="text-sm">{s.name}</span> },
  { header: '状态', className: 'col-span-3', cell: (s) => <StatusChip tone={statusTone(s.status)}>{s.status}</StatusChip> },
];

export default function AdminInfraPage() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [caInfo, setCaInfo] = useState<{ spaceId: string; caPublicKey: string; issuedCount: number; revokedCount: number } | null>(null);
  const [newApp, setNewApp] = useState({ name: '', scopes: '' });
  const [createdSecret, setCreatedSecret] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [s, c, a, ca] = await Promise.all([
        api.getSpaces(),
        api.getCertificates(),
        api.getOpenPlatformApps(),
        api.getCaInfo(),
      ]);
      setSpaces(s);
      setCerts(c);
      setApps(a);
      setCaInfo(ca);
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

  const createApp = async () => {
    setError('');
    setNotice('');
    try {
      const res = await api.createOpenPlatformApp({
        name: newApp.name,
        scopes: newApp.scopes ? newApp.scopes.split(',').map((s) => s.trim()) : undefined,
      });
      setCreatedSecret(`appId=${res.appId} appSecret=${res.appSecret}`);
      setNewApp({ name: '', scopes: '' });
      await load();
    } catch (err: any) {
      setError(err.message || '创建失败');
    }
  };

  // 吊销不可恢复（DESIGN §7：不可逆操作须确认并说明后果）。
  const revokeCert = async (fingerprint: string) => {
    if (!window.confirm('吊销后该证书立即失效且不可恢复，使用它的连接器将无法再通过身份认证。确认吊销？')) return;
    setError('');
    try {
      await api.revokeCertificate(fingerprint);
      setNotice('证书已吊销');
      await load();
    } catch (err: any) {
      setError(err.message || '吊销失败');
    }
  };

  const revokeApp = async (id: string) => {
    if (!window.confirm('吊销后该应用的 appId / appSecret 立即失效且不可恢复，依赖它的对接将中断。确认吊销？')) return;
    setError('');
    try {
      await api.revokeOpenPlatformApp(id);
      setNotice('应用已吊销');
      await load();
    } catch (err: any) {
      setError(err.message || '吊销失败');
    }
  };

  const revokeButton = (onClick: () => void) => (
    <button className="text-xs hover:underline" style={{ color: 'var(--cs-red)' }} onClick={onClick}>
      吊销
    </button>
  );

  const certColumns: GridColumn<Cert>[] = [
    { header: '指纹', className: 'col-span-4 min-w-0 pr-3', cell: (c) => <div className="cs-mono text-xs truncate" title={c.sm2Fingerprint}>{c.sm2Fingerprint}</div> },
    { header: '参与方', className: 'col-span-2 min-w-0 pr-3', cell: (c) => <span className="text-sm">{c.participantId}</span> },
    { header: '连接器', className: 'col-span-2 min-w-0 pr-3', cell: (c) => <span className="text-sm">{c.connectorId}</span> },
    { header: '有效期至', className: 'col-span-2', cell: (c) => <span className="cs-mono text-xs">{formatDateTime(c.validUntil).slice(0, 10)}</span> },
    { header: '状态', className: 'col-span-1', cell: (c) => <StatusChip tone={c.revoked ? 'blocked' : 'ok'}>{c.revoked ? '已吊销' : '有效'}</StatusChip> },
    { header: '操作', className: 'col-span-1 text-right', cell: (c) => (c.revoked ? null : revokeButton(() => revokeCert(c.sm2Fingerprint))) },
  ];

  const appColumns: GridColumn<AppRow>[] = [
    { header: 'AppID', className: 'col-span-3 min-w-0 pr-3', cell: (a) => <div className="cs-mono text-xs truncate" title={a.appId}>{a.appId}</div> },
    { header: '名称', className: 'col-span-3 min-w-0 pr-3', cell: (a) => <span className="text-sm">{a.name}</span> },
    { header: 'Scopes', className: 'col-span-3 min-w-0 pr-3', cell: (a) => <span className="cs-mono text-xs">{(a.scopes || []).join(', ') || '—'}</span> },
    { header: '状态', className: 'col-span-2', cell: (a) => <StatusChip tone={statusTone(a.status)}>{a.status}</StatusChip> },
    { header: '操作', className: 'col-span-1 text-right', cell: (a) => (a.status === 'active' ? revokeButton(() => revokeApp(a.id)) : null) },
  ];

  return (
    <div>
      <PageHeader kicker="ADMIN · 基础设施" desc="空间、CA 证书生命周期、开放平台应用(admin)。" />
      <div className="p-8 space-y-6">
        {error && <Banner>{error}</Banner>}
        {notice && <Banner tone="success">{notice}</Banner>}
        {createdSecret && <Banner tone="warn" className="cs-mono break-all">密钥仅此一次:{createdSecret}</Banner>}

        {/* CA 信息 */}
        {caInfo && (
          <section>
            <div className="cs-label mb-3">CA · 中心 CA</div>
            <Panel className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <Field label="空间" mono>{caInfo.spaceId}</Field>
                <Field label="签发数" mono>{caInfo.issuedCount}</Field>
                <Field label="吊销数" mono>{caInfo.revokedCount}</Field>
                <Field label="公钥" mono><span title={caInfo.caPublicKey}>{caInfo.caPublicKey.slice(0, 16)}…</span></Field>
              </div>
            </Panel>
          </section>
        )}

        {/* 空间管理(只读;创建/删除唯一入口为 operator 的 /spaces,INV-SPACE-01) */}
        <section>
          <div className="cs-label mb-2">SPACES · 空间({spaces.length})</div>
          <p className="text-xs mb-3 max-w-3xl" style={{ color: 'var(--cs-dim)' }}>
            MedTrust 一个部署实例对应一个可信数据空间(默认 sh-med);跨空间协作走联邦互认,不由本平台托管多空间。创建/删除由 operator 在 /spaces 操作。
          </p>
          <DataGrid columns={spaceColumns} rows={spaces} rowKey={(s) => s.id} loading={loading} loadingText="加载中…" emptyText="暂无空间。" />
        </section>

        {/* 证书生命周期 */}
        <section>
          <div className="cs-label mb-3">CERTIFICATES · 证书注册表({certs.length})</div>
          <DataGrid columns={certColumns} rows={certs} rowKey={(c) => c.sm2Fingerprint} loading={loading} loadingText="加载中…" emptyText="暂无证书。" />
        </section>

        {/* 开放平台应用 */}
        <section>
          <div className="cs-label mb-3">APPS · 开放平台应用({apps.length})</div>
          <div className="flex flex-wrap gap-3 mb-3">
            <input className="cs-input" style={{ width: 220 }} placeholder="应用名称" value={newApp.name} onChange={(e) => setNewApp({ ...newApp, name: e.target.value })} />
            <input className="cs-input" style={{ width: 260 }} placeholder="scopes(逗号分隔)" value={newApp.scopes} onChange={(e) => setNewApp({ ...newApp, scopes: e.target.value })} />
            <button className="cs-btn" onClick={createApp}>创建应用</button>
          </div>
          <DataGrid columns={appColumns} rows={apps} rowKey={(a) => a.id} loading={loading} loadingText="加载中…" emptyText="暂无应用。" />
        </section>
      </div>
    </div>
  );
}
