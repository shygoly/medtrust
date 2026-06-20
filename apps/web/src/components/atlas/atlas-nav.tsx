"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useAuth, roleLabel } from "@/lib/auth";
import { cn } from "@/lib/utils";

const links = [
  { href: "/atlas", label: "七层总览", en: "ATLAS" },
  { href: "/atlas/compose", label: "任务编排", en: "COMPOSE" },
];

export function AtlasNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  return (
    <header className="border-b" style={{ borderColor: "var(--at-line)" }}>
      <div className="mx-auto max-w-[1180px] px-6 h-16 flex items-center justify-between gap-6">
        <Link href="/atlas" className="flex items-baseline gap-3">
          <span className="at-display text-2xl font-semibold tracking-tight">能力图谱</span>
          <span className="at-label" style={{ fontSize: "0.56rem" }}>SEVEN-LAYER CODEX</span>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((l) => {
            const active = l.href === "/atlas" ? pathname === "/atlas" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "px-3 py-1.5 rounded-sm text-sm transition-colors",
                  active ? "text-[var(--at-ink)]" : "text-[var(--at-ink-2)] hover:text-[var(--at-ink)]",
                )}
                style={active ? { boxShadow: "inset 0 -2px 0 var(--at-seal)" } : undefined}
              >
                {l.label}
              </Link>
            );
          })}
          <Badge variant="outline" className="ml-2 at-mono font-normal">
            {user?.role ? roleLabel[user.role] ?? user.role : "未登录"}
          </Badge>
        </nav>
      </div>
    </header>
  );
}
