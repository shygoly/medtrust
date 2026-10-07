"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { roleLabel, useAuth } from "@/lib/auth";
import { canAccess, matchEntry } from "@/lib/nav";
import { PageHeader, Panel } from "./ui";

// 布局层角色门控（D-UI-2）：按当前路径查导航清单，角色不符时不渲染页面（其查询也不会发出）。
// 这是控制台唯一的整页角色门控；页面内只保留按角色切换列/按钮的条件渲染。
// 只管体验——安全边界仍是服务端 ParticipantRolesGuard。
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, ready } = useAuth();
  const entry = matchEntry(pathname);

  if (!entry?.roles) return <>{children}</>;
  if (!ready) return null;
  if (canAccess(entry, user?.role)) return <>{children}</>;

  const audience = entry.roles.map((r) => roleLabel[r] ?? r).join(" / ");
  const current = user?.role ? roleLabel[user.role] ?? user.role : "未分配角色";
  return (
    <div>
      <PageHeader kicker="NO ACCESS · 无权限" title={entry.label} />
      <div className="p-8">
        <Panel className="p-6 text-sm" style={{ color: "var(--cs-amber)" }}>
          本页面向「{audience}」。当前角色为「{current}」，无权访问。
          <Link href="/space" className="underline ml-2" style={{ color: "var(--cs-cyan)" }}>
            返回空间总览
          </Link>
        </Panel>
      </div>
    </div>
  );
}
