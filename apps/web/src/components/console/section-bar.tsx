"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { breadcrumbs, matchEntry, menuAncestor, menuFor, sectionOf } from "@/lib/nav";
import { AskAIButton } from "./ask-ai-button";

// 内容区顶部的面包屑 + 分区局部 tab，全部由导航清单生成（D-UI-2）。
// 页面不需要自己写回程：详情/表单页沿 parent 链逐级可回；tab 标出所属菜单页。
export function SectionBar() {
  const pathname = usePathname();
  const { user, ready } = useAuth();
  const entry = matchEntry(pathname);
  const section = sectionOf(entry);
  if (!ready || !entry || !section) return null;

  const crumbs = breadcrumbs(pathname, user?.role);
  const tabs = menuFor(user?.role).find((g) => g.group.id === section.id)?.items ?? [];
  const activeTab = menuAncestor(entry)?.route;
  const pathParts = pathname.split("/").filter(Boolean);
  const objectId = pathParts.at(-1);
  const askAi =
    /^\/space\/catalog/.test(pathname)
      ? { intent: "study-design" as const, objectType: "data-product" }
      : /^\/space\/contracts/.test(pathname)
        ? { intent: "access-contract" as const, objectType: "contract" }
        : /^\/space\/(tasks|mdop\/jobs|federated)\//.test(pathname)
          ? { intent: "result-interpretation" as const, objectType: "task" }
          : /^\/space\/(connectors|admin\/system|admin\/infra)/.test(pathname)
            ? { intent: "platform-ops" as const, objectType: "platform" }
            : /^\/space\/(audit|compliance)/.test(pathname)
              ? { intent: "compliance-evidence" as const, objectType: "compliance" }
              : null;

  return (
    <div className="border-b" style={{ borderColor: "var(--cs-line)" }}>
      <nav aria-label="面包屑" className="px-8 pt-4 pb-3 flex flex-wrap items-center gap-1.5 text-xs">
        {crumbs.map((c, i) => (
          <span key={`${i}:${c.label}`} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={12} style={{ color: "var(--cs-faint)" }} />}
            {c.href ? (
              <Link href={c.href} className="cs-crumb">{c.label}</Link>
            ) : (
              <span aria-current="page" style={{ color: "var(--cs-dim)" }}>{c.label}</span>
            )}
            {c.detail && <span className="cs-mono" style={{ color: "var(--cs-dim)" }}>{c.detail}</span>}
          </span>
        ))}
        {askAi ? (
          <span className="ml-auto">
            <AskAIButton
              intent={askAi.intent}
              objectType={askAi.objectType}
              {...(objectId && !["catalog", "contracts", "connectors", "compliance", "audit", "system", "infra"].includes(objectId)
                ? { objectId }
                : {})}
            />
          </span>
        ) : null}
      </nav>
      {tabs.length > 1 && (
        <nav aria-label={`${section.label}分区`} className="px-8 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <Link key={t.route} href={t.route} className="cs-tab" data-active={t.route === activeTab}>
              {t.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
