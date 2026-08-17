'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/api/client';
import { saveSession } from '@/lib/auth';

export default function SsoLoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const ticket = new URLSearchParams(window.location.search).get('ticket');
    if (!ticket) {
      setError('缺少登录票据，请从西安节点工作台重新进入应用。');
      return;
    }
    api
      .exchangeSsoTicket(ticket)
      .then((res) => {
        saveSession(res.access_token, res.user);
        router.replace('/space');
      })
      .catch((err) => {
        setError(err.message || '免登失败');
      });
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow text-center">
        <h2 className="text-2xl font-bold">MedTrust 免登</h2>
        {error ? (
          <>
            <p className="mt-4 text-red-500 text-sm">{error}</p>
            <Link href="/login" className="mt-4 inline-block text-blue-600 text-sm">
              返回本地登录
            </Link>
          </>
        ) : (
          <p className="mt-4 text-gray-600 text-sm">正在验证登录票据…</p>
        )}
      </div>
    </div>
  );
}
