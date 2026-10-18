"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type NotificationItem } from "@/api/client";
import { Panel } from "./ui";
import { AsyncBoundary } from "./data";

/**
 * 机构待办收件箱（D-NOTIF-1）。
 *
 * 为什么放在工作台而不是新开一页：待办的价值是"一眼看到 + 一步处理"。
 * 新开路由要动导航清单（D-UI-2 / check-nav），而这里只需一个面板 + 工作台的"未读通知"瓷贴。
 *
 * 语义边界（照实呈现，不夸大）：收件人是**参与方**——机构内任一成员标记已读即视为机构已知悉；
 * 当前通道只有站内信，不发邮件。
 */
export function NotificationsPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api.listNotifications({ status: "unread", limit: 20 }),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };
  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: invalidate,
  });

  const items = data ?? [];

  return (
    <section id="notifications" className="scroll-mt-24">
      <div className="cs-label mb-3">INBOX · 待处理通知</div>
      <Panel>
        <AsyncBoundary
          loading={isLoading}
          error={error}
          variant="bare"
          loadingText="装载通知…"
          errorText="无法连接 /notifications。"
        >
          {items.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
              没有未读通知。合约申请、审批结果会出现在这里。
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="cs-label">{items.length} 条未读</span>
                <button
                  className="cs-navlink text-xs"
                  data-testid="notifications-mark-all"
                  disabled={markAll.isPending}
                  onClick={() => markAll.mutate()}
                >
                  全部标记已读
                </button>
              </div>
              <ul className="space-y-3">
                {items.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    busy={markRead.isPending}
                    onRead={() => markRead.mutate(item.id)}
                  />
                ))}
              </ul>
            </div>
          )}
        </AsyncBoundary>
      </Panel>
    </section>
  );
}

function NotificationRow({
  item,
  busy,
  onRead,
}: {
  item: NotificationItem;
  busy: boolean;
  onRead: () => void;
}) {
  // 合约类通知落到合约页（唯一的处理动作是"行内签发"）；别的类型先只显示，不编目标页。
  const href = item.resourceType === "contract" ? "/space/contracts" : undefined;
  return (
    <li
      className="flex flex-wrap items-start gap-3 border-t pt-3 first:border-t-0 first:pt-0"
      style={{ borderColor: "var(--cs-line)" }}
      data-testid="notification"
      data-notification-type={item.type}
    >
      <div className="flex-1 min-w-[240px]">
        <div className="text-sm font-medium">{item.title}</div>
        {item.body ? (
          <div className="text-xs mt-1" style={{ color: "var(--cs-dim)" }}>
            {item.body}
          </div>
        ) : null}
        <div className="cs-mono text-xs mt-1" style={{ color: "var(--cs-faint)" }}>
          {item.createdAt.slice(0, 19).replace("T", " ")}
          {item.resourceId ? ` · ${item.resourceId}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {href ? (
          <Link className="cs-navlink text-xs" href={href}>
            去处理
          </Link>
        ) : null}
        <button
          className="cs-navlink text-xs"
          disabled={busy}
          data-testid="notification-mark-read"
          onClick={onRead}
        >
          标记已读
        </button>
      </div>
    </li>
  );
}
