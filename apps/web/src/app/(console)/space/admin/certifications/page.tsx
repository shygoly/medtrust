'use client';

import { useEffect, useState } from 'react';
import { api, type CertificationApplication } from '@/api/client';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  submitted: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

export default function AdminCertificationsPage() {
  const [items, setItems] = useState<CertificationApplication[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getAdminCertifications({ status, limit: 100 });
      setItems(res.items);
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

  const review = async (id: string, approve: boolean) => {
    const note = approve ? '' : window.prompt('驳回原因:') || '';
    setError('');
    setNotice('');
    try {
      await api.reviewCertification(id, approve, note);
      setNotice(approve ? '已通过' : '已驳回');
      await load();
    } catch (err: any) {
      setError(err.message || '审核失败');
    }
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="text-xs text-gray-400">OPERATOR · 机构认证审核</div>
        <h1 className="text-2xl font-semibold mt-1">机构认证审核</h1>
        <p className="text-sm text-gray-500 mt-1">审核自注册用户的机构认证申请。</p>
      </div>

      <div className="flex gap-3 mb-4">
        <select className="px-3 py-2 border border-gray-300 rounded-md text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="submitted">待审核</option>
          <option value="approved">已通过</option>
          <option value="rejected">已驳回</option>
        </select>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm" onClick={load}>查询</button>
      </div>

      {error && <div className="mb-4 bg-red-50 text-red-500 p-3 rounded text-sm">{error}</div>}
      {notice && <div className="mb-4 bg-green-50 text-green-600 p-3 rounded text-sm">{notice}</div>}

      <div className="space-y-4">
        {items.map((a) => (
          <div key={a.id || a.userId} className="bg-white rounded-xl border p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{a.orgName || '未填写机构名称'}</div>
                <div className="text-xs text-gray-400 mt-1">
                  用户 #{a.userId} · {a.uscc || 'USCC 未填写'} · 提交于 {a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'}
                </div>
              </div>
              <span className={`px-2 py-1 text-xs rounded ${a.status === 'submitted' ? 'bg-amber-50 text-amber-600' : a.status === 'approved' ? 'bg-green-50 text-green-600' : a.status === 'rejected' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
                {STATUS_LABEL[a.status || 'draft']}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-gray-400">机构类型</span><div>{a.orgType || '—'}</div></div>
              <div><span className="text-gray-400">行业类型</span><div>{a.industry || '—'}</div></div>
              <div><span className="text-gray-400">注册地</span><div>{a.region || '—'}</div></div>
              <div><span className="text-gray-400">注册金额(万元)</span><div>{a.capitalWanYuan ?? '—'}</div></div>
              <div><span className="text-gray-400">CA 身份名称</span><div>{a.caIdentityName || '未生成'}</div></div>
              <div><span className="text-gray-400">CA 凭证指纹</span><div className="truncate">{a.caCertFingerprint || '未生成'}</div></div>
            </div>

            <div className="mt-3 text-sm">
              <span className="text-gray-400">经营范围</span>
              <p className="mt-0.5 text-gray-700">{a.businessScope || '—'}</p>
            </div>
            <div className="mt-3 text-sm">
              <span className="text-gray-400">证照文件</span>
              <p className="mt-0.5 text-xs text-gray-500">{(a.licenseImages || []).map((k) => k.split('/').pop()).join('、') || '未上传'}</p>
            </div>
            {a.reviewNote && <div className="mt-3 text-sm text-amber-600">审核意见:{a.reviewNote}</div>}

            {a.status === 'submitted' && (
              <div className="mt-4 flex gap-3">
                <button className="px-4 py-2 bg-green-600 text-white rounded-md text-sm" onClick={() => review(a.id!, true)}>通过</button>
                <button className="px-4 py-2 border border-red-300 text-red-500 rounded-md text-sm" onClick={() => review(a.id!, false)}>驳回</button>
              </div>
            )}
          </div>
        ))}
        {!loading && items.length === 0 && (
          <div className="bg-white rounded-xl border p-8 text-center text-gray-400 text-sm">暂无认证申请</div>
        )}
        {loading && <div className="bg-white rounded-xl border p-8 text-center text-gray-400 text-sm">加载中…</div>}
      </div>
    </div>
  );
}
