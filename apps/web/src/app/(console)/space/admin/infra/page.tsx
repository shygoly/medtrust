'use client';

import { useEffect, useState } from 'react';
import { api } from '@/api/client';

type Space = { id: string; name: string; description?: string; status: string; createdAt: string };
type Cert = { sm2Fingerprint: string; participantId: string; connectorId: string; validUntil: string; revoked: boolean; issuedAt: string };
type AppRow = { id: string; appId: string; name: string; scopes?: string[]; status: string; createdAt: string };

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

  const revokeCert = async (fingerprint: string) => {
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
    setError('');
    try {
      await api.revokeOpenPlatformApp(id);
      setNotice('应用已吊销');
      await load();
    } catch (err: any) {
      setError(err.message || '吊销失败');
    }
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="text-xs text-gray-400">ADMIN · 基础设施</div>
        <h1 className="text-2xl font-semibold mt-1">基础设施管理</h1>
        <p className="text-sm text-gray-500 mt-1">空间、CA 证书生命周期、开放平台应用(admin)。</p>
      </div>

      {error && <div className="mb-4 bg-red-50 text-red-500 p-3 rounded text-sm">{error}</div>}
      {notice && <div className="mb-4 bg-green-50 text-green-600 p-3 rounded text-sm">{notice}</div>}
      {createdSecret && <div className="mb-4 bg-amber-50 text-amber-700 p-3 rounded text-sm font-mono">密钥仅此一次:{createdSecret}</div>}
      {loading && <div className="text-gray-400 text-sm">加载中…</div>}

      {/* CA 信息 */}
      {caInfo && (
        <section className="bg-white rounded-xl border p-5 mb-4">
          <h2 className="font-medium mb-3">中心 CA</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-400">空间</span><div className="font-mono">{caInfo.spaceId}</div></div>
            <div><span className="text-gray-400">签发数</span><div className="font-mono">{caInfo.issuedCount}</div></div>
            <div><span className="text-gray-400">吊销数</span><div className="font-mono">{caInfo.revokedCount}</div></div>
            <div><span className="text-gray-400">公钥</span><div className="font-mono text-xs truncate" title={caInfo.caPublicKey}>{caInfo.caPublicKey.slice(0, 16)}…</div></div>
          </div>
        </section>
      )}

      {/* 空间管理(只读;创建/删除唯一入口为 operator 的 /spaces,INV-SPACE-01) */}
      <section className="bg-white rounded-xl border p-5 mb-4">
        <h2 className="font-medium mb-1">空间({spaces.length})</h2>
        <p className="text-xs text-gray-400 mb-3">
          MedTrust 一个部署实例对应一个可信数据空间(默认 sh-med);跨空间协作走联邦互认,不由本平台托管多空间。创建/删除由 operator 在 /spaces 操作。
        </p>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr><th className="text-left px-3 py-2 font-medium">ID</th><th className="text-left px-3 py-2 font-medium">名称</th><th className="text-left px-3 py-2 font-medium">状态</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {spaces.map((s) => (
              <tr key={s.id}><td className="px-3 py-2 font-mono text-xs">{s.id}</td><td className="px-3 py-2">{s.name}</td><td className="px-3 py-2">{s.status}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 证书生命周期 */}
      <section className="bg-white rounded-xl border p-5 mb-4">
        <h2 className="font-medium mb-3">证书注册表({certs.length})</h2>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr><th className="text-left px-3 py-2 font-medium">指纹</th><th className="text-left px-3 py-2 font-medium">参与方</th><th className="text-left px-3 py-2 font-medium">连接器</th><th className="text-left px-3 py-2 font-medium">有效期至</th><th className="text-left px-3 py-2 font-medium">状态</th><th className="text-left px-3 py-2 font-medium">操作</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {certs.map((c) => (
              <tr key={c.sm2Fingerprint}>
                <td className="px-3 py-2 font-mono text-xs">{c.sm2Fingerprint}</td>
                <td className="px-3 py-2">{c.participantId}</td>
                <td className="px-3 py-2">{c.connectorId}</td>
                <td className="px-3 py-2">{new Date(c.validUntil).toLocaleDateString()}</td>
                <td className="px-3 py-2">{c.revoked ? '已吊销' : '有效'}</td>
                <td className="px-3 py-2">{!c.revoked && <button className="text-sm text-red-500 hover:underline" onClick={() => revokeCert(c.sm2Fingerprint)}>吊销</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 开放平台应用 */}
      <section className="bg-white rounded-xl border p-5">
        <h2 className="font-medium mb-3">开放平台应用({apps.length})</h2>
        <div className="flex gap-2 mb-3">
          <input className="px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="应用名称" value={newApp.name} onChange={(e) => setNewApp({ ...newApp, name: e.target.value })} />
          <input className="px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="scopes(逗号分隔)" value={newApp.scopes} onChange={(e) => setNewApp({ ...newApp, scopes: e.target.value })} />
          <button className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm" onClick={createApp}>创建应用</button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr><th className="text-left px-3 py-2 font-medium">AppID</th><th className="text-left px-3 py-2 font-medium">名称</th><th className="text-left px-3 py-2 font-medium">Scopes</th><th className="text-left px-3 py-2 font-medium">状态</th><th className="text-left px-3 py-2 font-medium">操作</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {apps.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2 font-mono text-xs">{a.appId}</td>
                <td className="px-3 py-2">{a.name}</td>
                <td className="px-3 py-2 text-xs">{(a.scopes || []).join(', ') || '—'}</td>
                <td className="px-3 py-2">{a.status}</td>
                <td className="px-3 py-2">{a.status === 'active' && <button className="text-sm text-red-500 hover:underline" onClick={() => revokeApp(a.id)}>吊销</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
