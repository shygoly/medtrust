"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Boxes, FlaskConical, ScrollText, ShieldCheck, ShieldAlert, AlertTriangle, LogOut, Coins, Layers, Gavel, Database, FileSignature, ClipboardList, Share2, Package, Users, Server, FileCode, Gauge } from "lucide-react";
import { useAuth, roleLabel } from "@/lib/auth";

// `roles` (optional) gates a group to participant roles; absent = visible to all.
const groups: Array<{
  group: string;
  roles?: string[];
  items: Array<{ href: string; label: string; en: string; icon: typeof Activity }>;
}> = [
  {
    group: "声明面 · DECLARE",
    items: [
      { href: "/space/atlas", label: "能力图谱", en: "ATLAS", icon: Layers },
      { href: "/space/atlas/compose", label: "合规预审", en: "PRE-REVIEW", icon: Gavel },
      { href: "/space/atlas/yaml", label: "密算编排", en: "YAML", icon: FileCode },
    ],
  },
  {
    group: "运行面 · RUNTIME",
    items: [
      { href: "/space", label: "空间总览", en: "OVERVIEW", icon: Activity },
      { href: "/space/connectors", label: "本院连接器", en: "CONNECTOR", icon: Boxes },
      { href: "/space/catalog", label: "数据产品", en: "CATALOG", icon: Database },
      { href: "/space/contracts", label: "数字合约", en: "CONTRACTS", icon: FileSignature },
      { href: "/space/tasks", label: "编排任务", en: "ORCHESTRATION", icon: FlaskConical },
      // mdop-kernel §9.6：MDOP 通道的作业（各院签名 → 凭证 → 执行 → 平台合并）
      { href: "/space/mdop/jobs", label: "MDOP 作业", en: "MDOP", icon: FlaskConical },
      { href: "/space/federated", label: "联邦密算", en: "FEDERATED", icon: Share2 },
      { href: "/space/attestations", label: "存证账本", en: "ATTESTATIONS", icon: ScrollText },
      { href: "/space/settlements", label: "结算", en: "SETTLEMENTS", icon: Coins },
    ],
  },
  {
    group: "使用方 · CONSUMER",
    roles: ["consumer"],
    items: [
      { href: "/space/deliverables", label: "模型交付", en: "DELIVERABLES", icon: Package },
    ],
  },
  {
    group: "合规 · COMPLIANCE",
    roles: ["compliance", "operator"],
    items: [
      { href: "/space/compliance", label: "合规总览", en: "OVERVIEW", icon: ShieldAlert },
      { href: "/space/rbqm", label: "RBQM 监查", en: "RBQM", icon: Gauge },
      { href: "/space/compliance/alerts", label: "合规告警", en: "ALERTS", icon: AlertTriangle },
      { href: "/space/audit", label: "审计日志", en: "AUDIT", icon: ClipboardList },
    ],
  },
  {
    group: "运营 · OPERATOR",
    roles: ["operator"],
    items: [
      { href: "/space/admin/users", label: "用户管理", en: "USERS", icon: Users },
      { href: "/space/admin/certifications", label: "机构认证审核", en: "CERT REVIEW", icon: FileSignature },
    ],
  },
  {
    group: "管理 · ADMIN",
    roles: ["admin"],
    items: [
      { href: "/space/admin/system", label: "系统状态", en: "SYSTEM", icon: Activity },
      { href: "/space/admin/infra", label: "基础设施", en: "INFRA", icon: Server },
      { href: "/space/admin/interop", label: "丝路数港互认", en: "INTEROP", icon: Share2 },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/space") return pathname === "/space";
  if (href === "/space/atlas") {
    return pathname === "/space/atlas" || (pathname.startsWith("/space/atlas/") && !pathname.startsWith("/space/atlas/compose") && !pathname.startsWith("/space/atlas/yaml"));
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export function SpaceNav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  // Coarse UI gating: hide role-restricted groups when the user's role isn't allowed.
  const visibleGroups = groups.filter((g) => !g.roles || (!!user?.role && g.roles.includes(user.role)));
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
        <div className="cs-label mt-2">FEDERATED DATA SPACE · PROD</div>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {visibleGroups.map((g) => (
          <div key={g.group} className="flex flex-col gap-1">
            <div className="cs-label px-3 pt-3 pb-1" style={{ fontSize: "0.56rem" }}>{g.group}</div>
            {g.items.map((l) => {
              const Icon = l.icon;
              return (
                <Link key={l.href} href={l.href} className="cs-navlink" data-active={isActive(pathname, l.href)}>
                  <Icon size={15} />
                  <span className="flex-1">{l.label}</span>
                  <span className="cs-label" style={{ fontSize: "0.56rem" }}>{l.en}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {user && (
        <div className="px-5 py-3 border-t" style={{ borderColor: "var(--cs-line)" }}>
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
