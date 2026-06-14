"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Boxes, FlaskConical, ScrollText, ShieldCheck, LogOut } from "lucide-react";
import { useAuth, roleLabel } from "@/lib/auth";

const links = [
  { href: "/space", label: "空间总览", en: "OVERVIEW", icon: Activity },
  { href: "/space/connectors", label: "连接器", en: "CONNECTORS", icon: Boxes },
  { href: "/space/tasks", label: "RWS 任务", en: "RWS TASKS", icon: FlaskConical },
  { href: "/space/attestations", label: "存证账本", en: "ATTESTATIONS", icon: ScrollText },
];

export function SpaceNav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  return (
    <aside
      className="w-60 shrink-0 border-r flex flex-col"
      style={{ borderColor: "var(--cs-line)", background: "var(--cs-bg-2)" }}
    >
      <div className="px-5 py-5 border-b" style={{ borderColor: "var(--cs-line)" }}>
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} style={{ color: "var(--cs-cyan)" }} />
          <span className="text-sm font-medium tracking-wide">医疗可信数据空间</span>
        </div>
        <div className="cs-label mt-2">FEDERATED DATA SPACE · v0</div>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {links.map((l) => {
          const active = l.href === "/space" ? pathname === "/space" : pathname.startsWith(l.href);
          const Icon = l.icon;
          return (
            <Link key={l.href} href={l.href} className="cs-navlink" data-active={active}>
              <Icon size={15} />
              <span className="flex-1">{l.label}</span>
              <span className="cs-label" style={{ fontSize: "0.58rem" }}>{l.en}</span>
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="px-5 py-3 border-t" style={{ borderColor: "var(--cs-line)" }}>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-sm truncate">{user.name}</div>
              <div className="cs-chip mt-1">{user.role ? roleLabel[user.role] ?? user.role : "未分配角色"}</div>
            </div>
            <button onClick={logout} title="退出登录" className="cs-navlink" style={{ padding: 8 }}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      )}

      <div className="px-5 py-4 border-t" style={{ borderColor: "var(--cs-line)" }}>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--cs-dim)" }}>
          <span className="cs-dot cs-dot-on" />
          控制面在线
        </div>
        <div className="cs-label mt-2">原始数据出域 · 0 行</div>
      </div>
    </aside>
  );
}
