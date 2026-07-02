'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/api/client';
import { saveSession } from '@/lib/auth';

const DEMO_ACCOUNTS = [
  { label: '华山医院 · 提供方', email: 'admin@huashan-hospital.com' },
  { label: '研究院 · 使用方', email: 'research@meddata-inst.edu.cn' },
  { label: '卫健委 · 监管方', email: 'data-governance@health.gov.cn' },
  { label: '合规审查官 · 合规方', email: 'compliance@medtrust.org' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const doLogin = async (em: string, pw: string) => {
    setError('');
    setLoading(true);
    try {
      const response = await api.login({ email: em, password: pw });
      saveSession(response.access_token, response.user);
      router.push('/space');
    } catch (err: any) {
      setError(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await doLogin(email, password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <h2 className="text-3xl font-bold text-center">MedTrust</h2>
          <p className="mt-2 text-center text-gray-600">医疗可信数据空间</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 text-red-500 p-3 rounded text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              邮箱
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              密码
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="********"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <div className="border-t pt-4">
          <p className="text-xs text-gray-500 mb-2">快速选择演示账号(密码 demo123456):</p>
          <div className="flex flex-wrap gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                disabled={loading}
                onClick={() => doLogin(a.email, 'demo123456')}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-center">
          <Link href="/register" className="text-sm text-blue-600 hover:text-blue-500">
            还没有账号？立即注册
          </Link>
        </div>
      </div>
    </div>
  );
}
