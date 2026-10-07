"use client";

import Link from "next/link";
import { useWorkbench } from "@/hooks/use-workbench";
import { Stat } from "./ui";

// 首页顶部的角色化待办区：每项 = 计数 + 直达处理页面的链接（lib/workbench）。
// 没有待办来源的角色（admin）不渲染。
export function WorkbenchPanel() {
  const items = useWorkbench();
  if (!items.length) return null;
  return (
    <section>
      <div className="cs-label mb-3">TODO · 待你处理</div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {items.map((item) => (
          <Link key={item.key} href={item.href} className="block cs-reveal" title={item.hint}>
            <Stat
              label={item.label}
              value={item.count ?? "—"}
              unit={item.hint}
              accent={item.count ? item.tone : undefined}
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
