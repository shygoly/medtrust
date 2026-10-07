'use client';

import { useEffect, useState } from 'react';
import { api, type CertificationApplication } from '@/api/client';
import { formatDateTime } from '@/lib/attestations';
import { statusTone } from '@/lib/status-tone';
import { ResourceList } from '@/components/console/data';
import { Banner, Field, PageHeader, StatusChip } from '@/components/console/ui';

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
    <div>
      <PageHeader kicker="OPERATOR · 机构认证审核" desc="审核自注册用户的机构认证申请。通过后到「用户管理」为其分配参与方与角色，对方才能进入控制台。" />
      <div className="p-8 space-y-4">
        <div className="flex flex-wrap gap-3">
          <select className="cs-input" style={{ width: 180 }} aria-label="按状态筛选" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button className="cs-btn" onClick={load}>查询</button>
        </div>

        {error && <Banner>{error}</Banner>}
        {notice && <Banner tone="success">{notice}</Banner>}

        <ResourceList
          items={items}
          rowKey={(a, i) => a.id || a.userId || i}
          loading={loading}
          className="space-y-4"
          rowClassName="p-5"
          loadingText="加载中…"
          emptyText="暂无认证申请"
          renderItem={(a) => (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.orgName || '未填写机构名称'}</div>
                  <div className="cs-mono text-[0.68rem] mt-1" style={{ color: 'var(--cs-faint)' }}>
                    用户 #{a.userId} · {a.uscc || 'USCC 未填写'} · 提交于 {formatDateTime(a.createdAt)}
                  </div>
                </div>
                <StatusChip tone={statusTone(a.status || 'draft')}>{STATUS_LABEL[a.status || 'draft']}</StatusChip>
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                <Field label="机构类型">{a.orgType || '—'}</Field>
                <Field label="行业类型">{a.industry || '—'}</Field>
                <Field label="注册地">{a.region || '—'}</Field>
                <Field label="注册金额(万元)">{a.capitalWanYuan ?? '—'}</Field>
                <Field label="CA 身份名称">{a.caIdentityName || '未生成'}</Field>
                <Field label="CA 凭证指纹" mono>{a.caCertFingerprint || '未生成'}</Field>
              </div>

              <div className="mt-4 space-y-4">
                <Field label="经营范围">{a.businessScope || '—'}</Field>
                <Field label="证照文件">
                  <span style={{ color: 'var(--cs-dim)' }}>
                    {(a.licenseImages || []).map((k) => k.split('/').pop()).join('、') || '未上传'}
                  </span>
                </Field>
              </div>
              {a.reviewNote && (
                <div className="mt-4 text-sm" style={{ color: 'var(--cs-amber)' }}>审核意见:{a.reviewNote}</div>
              )}

              {a.status === 'submitted' && (
                <div className="mt-4 flex gap-3">
                  <button className="cs-btn" onClick={() => review(a.id!, true)}>通过</button>
                  <button
                    className="cs-btn cs-btn-ghost"
                    style={{ color: 'var(--cs-red)' }}
                    onClick={() => review(a.id!, false)}
                  >
                    驳回
                  </button>
                </div>
              )}
            </>
          )}
        />
      </div>
    </div>
  );
}
