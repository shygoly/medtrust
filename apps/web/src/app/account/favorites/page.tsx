'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/api/client';
import { clearSession } from '@/lib/auth';

type FavoriteItem = {
  id: number;
  productId: string;
  createdAt: string;
  product: {
    id: string;
    urn: string;
    title: string;
    providerId: string;
    productType: string;
    status: string;
  } | null;
};

export default function FavoritesPage() {
  const router = useRouter();
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!api.getToken()) {
      router.replace('/login');
      return;
    }
    (async () => {
      try {
        const res = await api.getFavorites();
        setItems(res.items);
      } catch (err: any) {
        setError(err.message || '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const remove = async (productId: string) => {
    setError('');
    try {
      await api.removeFavorite(productId);
      setItems((prev) => prev.filter((i) => i.productId !== productId));
    } catch (err: any) {
      setError(err.message || '取消失败');
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
          <Link href="/account/favorites" className="block px-3 py-2 rounded-md bg-blue-50 text-blue-600 font-medium">我的收藏</Link>
          <Link href="/account/security" className="block px-3 py-2 rounded-md text-gray-600 hover:bg-gray-50">安全设置</Link>
        </aside>

        <main className="bg-white rounded-xl border p-8">
          <h1 className="text-xl font-semibold mb-6">我的收藏</h1>
          {error && <div className="mb-4 bg-red-50 text-red-500 p-3 rounded text-sm">{error}</div>}
          {loading && <div className="text-gray-400 text-sm">加载中…</div>}
          {!loading && items.length === 0 && (
            <div className="text-gray-400 text-sm">暂无收藏。前往 <Link href="/space/catalog" className="text-blue-600">数据产品目录</Link> 收藏感兴趣的产品。</div>
          )}
          <div className="space-y-3">
            {items.map((i) => (
              <div key={i.id} className="flex items-center justify-between border border-gray-100 rounded-lg p-4">
                <div>
                  <div className="font-medium text-sm">{i.product?.title ?? '产品已下架'}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {i.product?.urn ?? i.productId} · {i.product?.providerId ?? '—'} · {i.product?.productType ?? ''}
                  </div>
                </div>
                <button className="text-sm text-red-500 hover:underline" onClick={() => remove(i.productId)}>取消收藏</button>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
