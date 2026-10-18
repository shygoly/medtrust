"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bot, Database, FlaskConical, Layers, LogOut, Server, ShieldAlert, ShieldCheck } from "lucide-react";
import { useAuth, roleLabel } from "@/lib/auth";
import { matchEntry, menuFor, sectionOf, type NavIcon } from "@/lib/nav";
import { CommandPalette } from "./command-palette";
import { SpaceSwitcher } from "./space-switcher";
import { SPACE_COOKIE, readCookie } from "@/lib/space-context";
import { api } from "@/api/client";
import { useEffect, useState } from "react";

// 侧栏只列分区（nav.manifest.json 的 groups，D-UI-2）；分区内的页面由 SectionBar 以 tab 呈现。
const icons: Record<NavIcon, typeof Activity> = { Activity, Database, FlaskConical, Layers, Server, ShieldAlert };

export interface SpaceNavProps {
  /**
   * 左上角品牌名：由服务端按**当前空间的 theme**（空间品牌 > 实例 > 平台）解析后传入。
   * 早先这里是硬编码「医疗可信数据空间」，于是电力空间登录后左上角仍写着医疗（品牌与空间不一致）。
   */
  brand?: string;
}

export function SpaceNav({ brand }: SpaceNavProps = {}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  // P9.3：导航按**空间启用集**过滤。未加载（null）时不过滤——单领域既有部署行为零变更。
  const [enabledPacks, setEnabledPacks] = useState<readonly string[] | null>(null);
  useEffect(() => {
    const spaceId = readCookie(SPACE_COOKIE);
    if (!spaceId) return;
    let alive = true;
    api
      .getSpaces()
      .then((all) => {
        if (!alive) return;
        const mine = (all as Array<{ id: string; enabledPacks?: string[] | null }>).find(
          (s) => s.id === spaceId,
        );
        setEnabledPacks(mine?.enabledPacks ?? null);
      })
      .catch(() => { if (alive) setEnabledPacks(null); });
    return () => { alive = false; };
  }, []);
  // 没有可见页面的分区不出现；入口指向该分区内当前角色可见的第一个页面。
  const sections = menuFor(user?.role, enabledPacks ?? undefined);
  const activeSection = sectionOf(matchEntry(pathname))?.id;
  return (
    <aside
      className="w-60 shrink-0 h-dvh min-h-0 border-r flex flex-col"
      style={{ borderColor: "var(--cs-line)", background: "var(--cs-bg-2)" }}
    >
      <div className="px-5 py-5 border-b shrink-0" style={{ borderColor: "var(--cs-line)" }}>
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} style={{ color: "var(--cs-cyan)" }} />
          <span className="text-sm font-medium tracking-wide">{brand ?? "医疗可信数据空间"}</span>
        </div>
        <div className="cs-label mt-2">FEDERATED DATA SPACE · PROD</div>
      </div>

      <div className="pt-4 shrink-0">
        <SpaceSwitcher />
      </div>

      <div className="px-3 pt-4 shrink-0">
        <CommandPalette />
      </div>

      <div className="px-3 pt-3 shrink-0">
        <Link
          href="/space/assistant"
          className="cs-navlink"
          data-active={pathname.startsWith("/space/assistant")}
          data-testid="global-ai-entry"
        >
          <Bot size={15} />
          <span className="flex-1">询问 AI</span>
          <span className="cs-label" style={{ fontSize: "0.56rem" }}>ASSISTANT</span>
        </Link>
      </div>

      <nav className="flex-1 min-h-0 px-3 py-3 flex flex-col gap-1 overflow-y-auto">
        {sections.map(({ group, items }) => {
          const Icon = icons[group.icon];
          return (
            <div key={group.id} className={group.separated ? "mt-3 pt-3 border-t" : undefined} style={{ borderColor: "var(--cs-line)" }}>
              <Link href={items[0].route} className="cs-navlink" data-active={activeSection === group.id}>
                <Icon size={15} />
                <span className="flex-1">{group.label}</span>
                <span className="cs-label" style={{ fontSize: "0.56rem" }}>{group.en}</span>
              </Link>
            </div>
          );
        })}
      </nav>

      {user && (
        <div className="px-5 py-3 border-t shrink-0" style={{ borderColor: "var(--cs-line)" }}>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <Link href="/account/identity" title="个人中心" className="text-sm truncate hover:text-blue-600">{user.name}</Link>
              <div className="cs-chip mt-1">{user.role ? roleLabel[user.role] ?? user.role : "未分配角色"}</div>
            </div>
            <button onClick={logout} title="退出登录" className="cs-navlink" style={{ padding: 8 }}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      )}

      <div className="px-5 py-4 border-t shrink-0" style={{ borderColor: "var(--cs-line)" }}>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--cs-dim)" }}>
          <span className="cs-dot cs-dot-on" />
          控制面在线
        </div>
        <div className="cs-label mt-2">原始数据出域 · 0 行</div>
      </div>

      <Link
        href="/space/assistant"
        className="fixed bottom-5 right-5 z-30 rounded-full px-4 py-3 text-sm font-medium shadow-lg lg:hidden"
        style={{ background: "var(--cs-cyan)", color: "#041016" }}
        aria-label="打开 AI 助手"
      >
        询问 AI
      </Link>
    </aside>
  );
}
