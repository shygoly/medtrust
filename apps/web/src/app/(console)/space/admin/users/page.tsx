'use client';

import { useEffect, useState } from 'react';
import { api, type AdminUser } from '@/api/client';

const ROLES = ['provider', 'consumer', 'operator', 'compliance'] as const;
const STATUSES = ['active', 'disabled', 'pending'] as const;
const roleLabel: Record<string, string> = {
  provider: '数据提供方',
  consumer: '数据使用方',
  operator: '运营/监管方',
  compliance: '合规方',
};

export default function AdminUsersPage() {
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

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="text-xs text-gray-400">OPERATOR · 用户管理</div>
        <h1 className="text-2xl font-semibold mt-1">用户管理</h1>
        <p className="text-sm text-gray-500 mt-1">
          为自注册用户分配参与方与角色、启用/禁用账号、重置密码。共 {total} 个用户。
        </p>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          className="px-3 py-2 border border-gray-300 rounded-md text-sm w-64"
          placeholder="搜索邮箱/姓名"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <select className="px-3 py-2 border border-gray-300 rounded-md text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">全部角色</option>
          {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
        </select>
        <select className="px-3 py-2 border border-gray-300 rounded-md text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm" onClick={load}>查询</button>
      </div>

      {error && <div className="mb-4 bg-red-50 text-red-500 p-3 rounded text-sm">{error}</div>}
      {notice && <div className="mb-4 bg-green-50 text-green-600 p-3 rounded text-sm">{notice}</div>}

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-4 py-3 font-medium">ID</th>
              <th className="text-left px-4 py-3 font-medium">用户</th>
              <th className="text-left px-4 py-3 font-medium">参与方</th>
              <th className="text-left px-4 py-3 font-medium">角色</th>
              <th className="text-left px-4 py-3 font-medium">状态</th>
              <th className="text-left px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-400">{u.id}</td>
                <td className="px-4 py-3">
                  <div>{u.name || '—'}</div>
                  <div className="text-xs text-gray-400">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <input
                    className="px-2 py-1 border border-gray-200 rounded text-xs w-28"
                    defaultValue={u.participantId || ''}
                    onBlur={(e) => {
                      if (e.target.value !== (u.participantId || '')) {
                        update(u.id, { participantId: e.target.value || undefined }, '参与方已更新');
                      }
                    }}
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    className="px-2 py-1 border border-gray-200 rounded text-xs"
                    value={u.participantRole || ''}
                    onChange={(e) => update(u.id, { participantRole: e.target.value }, '角色已更新')}
                  >
                    <option value="">未分配</option>
                    {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    className="px-2 py-1 border border-gray-200 rounded text-xs"
                    value={u.status || 'active'}
                    onChange={(e) => update(u.id, { status: e.target.value }, e.target.value === 'disabled' ? '账号已禁用,旧会话已撤销' : '状态已更新')}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <button className="text-xs text-blue-600 hover:underline" onClick={() => resetPassword(u)}>重置密码</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">暂无用户</div>
        )}
        {loading && <div className="p-8 text-center text-gray-400 text-sm">加载中…</div>}
      </div>
    </div>
  );
}
