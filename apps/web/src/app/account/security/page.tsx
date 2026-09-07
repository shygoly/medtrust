'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/api/client';
import { clearSession } from '@/lib/auth';

export default function SecurityPage() {
  const router = useRouter();
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!api.getToken()) {
      router.replace('/login');
    }
  }, [router]);

  const setup = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const res = await api.setupMfa();
      setSecret(res.secret);
      setOtpauthUrl(res.otpauthUrl);
      setMessage('请在 Authenticator 中扫码或手动输入密钥,然后输入 6 位验证码启用。');
    } catch (err: any) {
      setError(err.message || '发起失败');
    } finally {
      setLoading(false);
    }
  };

  const enable = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await api.enableMfa(code);
      setMessage('MFA 已启用。下次登录时请输入客户端中的 6 位验证码。');
      setSecret('');
      setOtpauthUrl('');
      setCode('');
    } catch (err: any) {
      setError(err.message || '启用失败');
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await api.disableMfa(code);
      setMessage('MFA 已禁用。');
      setCode('');
    } catch (err: any) {
      setError(err.message || '禁用失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <Link href="/space" className="text-blue-600 font-medium">返回控制台</Link>
            <span className="text-gray-300">|</span>
            <span className="text-gray-700">用户中心</span>
          </div>
          <button
            className="text-sm text-gray-400 hover:text-gray-600"
            onClick={() => {
              api.logout().finally(() => {
                clearSession();
                router.replace('/login');
              });
            }}
          >
            退出登录
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-[200px_1fr] gap-8">
        <aside className="space-y-1 text-sm">
          <Link href="/account/identity" className="block px-3 py-2 rounded-md text-gray-600 hover:bg-gray-50">账号与身份</Link>
          <Link href="/account/favorites" className="block px-3 py-2 rounded-md text-gray-600 hover:bg-gray-50">我的收藏</Link>
          <Link href="/account/security" className="block px-3 py-2 rounded-md bg-blue-50 text-blue-600 font-medium">安全设置</Link>
        </aside>

        <main className="bg-white rounded-xl border p-8 space-y-6">
          <h1 className="text-xl font-semibold">安全设置</h1>

          {error && <div className="bg-red-50 text-red-500 p-3 rounded text-sm">{error}</div>}
          {message && <div className="bg-blue-50 text-blue-600 p-3 rounded text-sm">{message}</div>}

          <section className="border rounded-lg p-5 space-y-3">
            <h2 className="font-medium">多因素认证（MFA / TOTP）</h2>
            <p className="text-sm text-gray-500">
              绑定 Google Authenticator 或信通院客户端,登录时需额外输入 6 位动态验证码。私钥仅保存在你的认证器客户端。
            </p>

            {!secret ? (
              <button className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm" onClick={setup} disabled={loading}>
                发起 MFA 绑定
              </button>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-gray-50 rounded-md text-xs font-mono break-all">{otpauthUrl}</div>
                <div className="text-sm text-gray-600">手动密钥:<span className="font-mono">{secret}</span></div>
                <input
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm w-40"
                  placeholder="6 位验证码"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                <div className="flex gap-3">
                  <button className="px-4 py-2 bg-green-600 text-white rounded-md text-sm" onClick={enable} disabled={loading || code.length !== 6}>启用 MFA</button>
                  <button className="px-4 py-2 border border-gray-300 rounded-md text-sm" onClick={disable} disabled={loading || code.length !== 6}>禁用 MFA</button>
                </div>
              </div>
            )}

            {secret && (
              <p className="text-xs text-gray-400">已生成未启用状态。启用后旧会话不受影响;新登录将强制校验 TOTP。</p>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
