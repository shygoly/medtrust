'use client';

import { useEffect, useState } from 'react';
import { api, type AdminUser } from '@/api/client';
import { roleLabel, useAuth } from '@/lib/auth';
import { ASSIGNABLE_ROLES, ROLES } from '@/lib/nav';
import { statusTone } from '@/lib/status-tone';
import { DataGrid, type GridColumn } from '@/components/console/data';
import { Banner, PageHeader, StatusChip } from '@/components/console/ui';

const STATUSES = ['active', 'disabled', 'pending'] as const;
const STATUS_LABEL: Record<string, string> = { active: '正常', disabled: '已禁用', pending: '待分配' };

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getAdminUsers({ search, status, role, limit: 100 });
      setItems(res.items);
      setTotal(res.total);
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

  const update = async (id: number, patch: Record<string, unknown>, okMsg: string) => {
    setError('');
    setNotice('');
    try {
      await api.updateUser(id, patch);
      setNotice(okMsg);
      await load();
    } catch (err: any) {
      setError(err.message || '更新失败');
    }
  };

  const resetPassword = async (u: AdminUser) => {
    const pwd = window.prompt(`为 ${u.email} 设置新密码(至少 8 位,含大小写/数字/特殊字符中三类):`);
    if (!pwd) return;
    setError('');
    setNotice('');
    try {
      await api.adminResetPassword(u.id, pwd);
      setNotice('密码已重置,该用户所有旧会话已失效');
    } catch (err: any) {
      setError(err.message || '重置失败');
    }
  };

  // 平台管理员账号只能在服务器侧管理（D-ID-3）；任何人不能改自己的角色。接口同样会拒绝。
  const serverManaged = (u: AdminUser) => u.participantRole === 'admin';

  const columns: GridColumn<AdminUser>[] = [
    {
      header: 'ID',
      className: 'col-span-1',
      cell: (u) => <span className="cs-mono text-xs" style={{ color: 'var(--cs-faint)' }}>{u.id}</span>,
    },
    {
      header: '用户',
      className: 'col-span-3 min-w-0 pr-3',
      cell: (u) => (
        <>
          <div className="text-sm truncate">{u.name || '—'}</div>
          <div className="cs-mono text-[0.68rem] truncate" style={{ color: 'var(--cs-faint)' }}>{u.email}</div>
        </>
      ),
    },
    {
      header: '参与方',
      className: 'col-span-2 pr-3',
      cell: (u) =>
        serverManaged(u) ? (
          <span className="cs-mono text-xs">{u.participantId || '—'}</span>
        ) : (
          <input
            className="cs-input cs-mono text-xs"
            aria-label="参与方"
            defaultValue={u.participantId || ''}
            onBlur={(e) => {
              if (e.target.value !== (u.participantId || '')) {
                update(u.id, { participantId: e.target.value || undefined }, '参与方已更新');
              }
            }}
          />
        ),
    },
    {
      header: '角色',
      className: 'col-span-2 pr-3',
      cell: (u) =>
        serverManaged(u) || me?.id === u.id ? (
          <div className="text-sm">
            {u.participantRole ? roleLabel[u.participantRole] ?? u.participantRole : '未分配'}
            <div className="text-[0.68rem]" style={{ color: 'var(--cs-faint)' }}>
              {serverManaged(u) ? '服务器侧管理' : '不能修改自己的角色'}
            </div>
          </div>
        ) : (
          <select
            className="cs-input text-xs"
            aria-label="角色"
            value={u.participantRole || ''}
            onChange={(e) => update(u.id, { participantRole: e.target.value }, '角色已更新')}
          >
            <option value="">未分配</option>
            {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
          </select>
        ),
    },
    {
      header: '状态',
      className: 'col-span-2 pr-3',
      cell: (u) =>
        serverManaged(u) ? (
          <StatusChip tone={statusTone(u.status || 'active')}>{STATUS_LABEL[u.status || 'active']}</StatusChip>
        ) : (
          <select
            className="cs-input text-xs"
            aria-label="状态"
            value={u.status || 'active'}
            onChange={(e) => update(u.id, { status: e.target.value }, e.target.value === 'disabled' ? '账号已禁用,旧会话已撤销' : '状态已更新')}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        ),
    },
    {
      header: '操作',
      className: 'col-span-2 text-right',
      cell: (u) =>
        serverManaged(u) ? (
          <span style={{ color: 'var(--cs-faint)' }}>—</span>
        ) : (
          <button className="text-xs hover:underline" style={{ color: 'var(--cs-cyan)' }} onClick={() => resetPassword(u)}>
            重置密码
          </button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader kicker="OPERATOR · 用户管理" desc={`为自注册用户分配参与方与角色、启用/禁用账号、重置密码；申请材料在「机构认证审核」。共 ${total} 个用户。`} />
      <div className="p-8 space-y-4">
        <div className="flex flex-wrap gap-3">
          <input
            className="cs-input"
            style={{ width: 260 }}
            placeholder="搜索邮箱/姓名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
          <select className="cs-input" style={{ width: 180 }} aria-label="按角色筛选" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">全部角色</option>
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
          </select>
          <select className="cs-input" style={{ width: 150 }} aria-label="按状态筛选" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <button className="cs-btn" onClick={load}>查询</button>
        </div>

        {error && <Banner>{error}</Banner>}
        {notice && <Banner tone="success">{notice}</Banner>}

        <DataGrid
          columns={columns}
          rows={items}
          rowKey={(u) => u.id}
          loading={loading}
          loadingText="加载中…"
          emptyText="暂无用户"
        />
      </div>
    </div>
  );
}
