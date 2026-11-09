'use client';

import Link from 'next/link';
import { Bell, CheckCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NotificationItem } from '@/api/client';
import { useAuth } from '@/lib/auth';
import { useNotificationStream } from '@/hooks/use-notification-stream';

/** 通知的深链：没有明确目标的类型不编造页面。 */
export function notificationHref(item: NotificationItem): string | undefined {
  if (!item.resourceId) return undefined;
  const id = encodeURIComponent(item.resourceId);
  switch (item.resourceType) {
    case 'contract':
      return `/space/contracts?focus=${id}`;
    case 'mdop-job':
      return `/space/mdop/jobs/${id}`;
    case 'task':
      return `/space/tasks/${id}`;
    case 'connector':
      return '/space/connectors';
    case 'membership':
      return '/space/admin/users';
    default:
      return undefined;
  }
}

export function NotificationBell() {
  const { user, ready } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useNotificationStream(ready && Boolean(user?.participantId));

  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.getUnreadNotificationCount(),
    enabled: ready && Boolean(user?.participantId),
    refetchInterval: 60_000,
  });

  const list = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => api.listNotifications({ limit: 20 }),
    enabled: open && Boolean(user?.participantId),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!ready || !user?.participantId) return null;

  const count = unread.data?.unread ?? 0;
  const items = list.data ?? [];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="cs-navlink relative"
        style={{ padding: 8 }}
        aria-label={`通知${count > 0 ? `（${count} 条未读）` : ''}`}
        aria-expanded={open}
        data-testid="notification-bell"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={16} />
        {count > 0 ? (
          <span
            className="absolute -right-1 -top-1 rounded-full px-1.5 text-[0.6rem] font-semibold leading-4"
            style={{ background: 'var(--cs-red)', color: '#fff' }}
            data-testid="notification-unread"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-lg border shadow-xl"
          style={{ borderColor: 'var(--cs-line)', background: 'var(--cs-bg-3)' }}
          role="dialog"
          aria-label="通知"
          data-testid="notification-panel"
        >
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--cs-line)' }}>
            <div>
              <div className="text-sm font-medium">通知</div>
              <div className="cs-label mt-1">{count} 条未读</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="cs-navlink text-xs"
                disabled={markAll.isPending || count === 0}
                data-testid="notification-mark-all"
                onClick={() => markAll.mutate()}
              >
                <CheckCheck size={13} /> 全部已读
              </button>
              <button type="button" className="cs-navlink text-xs" onClick={() => setOpen(false)} aria-label="关闭通知">
                <X size={13} />
              </button>
            </div>
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {list.isLoading ? (
              <p className="px-4 py-6 text-sm" style={{ color: 'var(--cs-dim)' }}>装载通知…</p>
            ) : list.error ? (
              <p className="px-4 py-6 text-sm" style={{ color: 'var(--cs-red)' }}>无法连接 /notifications。</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-sm" style={{ color: 'var(--cs-dim)' }}>没有通知。合约、作业终态与连接器异常会出现在这里。</p>
            ) : (
              <ul>
                {items.map((item) => {
                  const href = notificationHref(item);
                  const body = (
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        {item.status === 'unread' ? (
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--cs-cyan)' }} />
                        ) : null}
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{item.title}</div>
                          {item.body ? (
                            <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--cs-dim)' }}>{item.body}</p>
                          ) : null}
                          <div className="cs-mono mt-1 text-[0.65rem]" style={{ color: 'var(--cs-faint)' }}>
                            {item.createdAt.slice(0, 19).replace('T', ' ')}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                  return (
                    <li key={item.id} className="border-t first:border-t-0" style={{ borderColor: 'var(--cs-line)' }}>
                      <div className="flex items-start gap-2 px-4 py-3">
                        {href ? (
                          <Link
                            href={href}
                            className="flex-1 min-w-0"
                            data-testid="notification-link"
                            onClick={() => {
                              if (item.status === 'unread') markRead.mutate(item.id);
                              setOpen(false);
                            }}
                          >
                            {body}
                          </Link>
                        ) : (
                          <div className="flex-1 min-w-0">{body}</div>
                        )}
                        {item.status === 'unread' ? (
                          <button
                            type="button"
                            className="cs-navlink shrink-0 text-[0.65rem]"
                            disabled={markRead.isPending}
                            data-testid="notification-mark-read"
                            onClick={() => markRead.mutate(item.id)}
                          >
                            标记已读
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
