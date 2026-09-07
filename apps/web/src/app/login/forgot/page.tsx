'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/api/client';

type Tab = 'email' | 'sms';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    setError('');
    setLoading(true);
    try {
      if (tab === 'email') {
        await api.forgotPassword(email);
      } else {
        if (!/^1[3-9]\d{9}$/.test(phone)) {
          setError('请输入正确的手机号');
          return;
        }
        await api.sendSmsResetCode(phone);
      }
      setSent(true);
    } catch (err: any) {
      setError(err.message || '发送失败');
    } finally {
      setLoading(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'email') {
        await api.resetPassword(email, code, newPassword);
      } else {
        await api.resetPasswordBySms(phone, code, newPassword);
      }
      router.push('/login?reset=1');
    } catch (err: any) {
      setError(err.message || '重置失败');
    } finally {
      setLoading(false);
    }
  };

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'email', label: '邮箱找回' },
    { key: 'sms', label: '手机找回' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
        <div>
          <h2 className="text-2xl font-bold text-center">忘记密码</h2>
          <p className="mt-2 text-center text-gray-600">
            通过注册邮箱或手机号找回密码
          </p>
        </div>

        <div className="grid grid-cols-2 rounded-lg bg-gray-100 p-1 text-sm">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setSent(false);
                setError('');
              }}
              className={`py-2 rounded-md font-medium transition ${
                tab === t.key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <div className="bg-red-50 text-red-500 p-3 rounded text-sm">{error}</div>}

        <div>
          {tab === 'email' ? (
            <>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                邮箱
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="you@example.com"
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={sendCode}
                  className="shrink-0 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {sent ? '重新发送' : '发送验证码'}
                </button>
              </div>
            </>
          ) : (
            <>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                手机号
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="phone"
                  type="tel"
                  required
                  maxLength={11}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入手机号"
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={sendCode}
                  className="shrink-0 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {sent ? '重新发送' : '发送验证码'}
                </button>
              </div>
            </>
          )}
        </div>

        {sent && (
          <form className="space-y-4" onSubmit={reset}>
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                {tab === 'email' ? '邮箱验证码' : '短信验证码'}
              </label>
              <input
                id="code"
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="6 位数字"
                autoComplete="one-time-code"
              />
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                新密码
              </label>
              <input
                id="newPassword"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="至少8位,含大写/小写/数字/特殊字符中的三类"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? '提交中...' : '重置密码'}
            </button>
          </form>
        )}

        <div className="text-center">
          <Link href="/login" className="text-sm text-blue-600 hover:text-blue-500">
            返回登录
          </Link>
        </div>
      </div>
    </div>
  );
}
