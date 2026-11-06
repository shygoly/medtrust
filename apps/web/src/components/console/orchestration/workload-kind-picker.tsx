"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Panel } from "@/components/console/ui";
import { ORCHESTRATION_CREATE_OPTIONS } from "@/lib/orchestration-workloads";

export function WorkloadKindPicker({ currentPath }: { currentPath?: string }) {
  // 从合约卡片「用此合约发起任务」进来时带着 contractId：原样带到具体表单，
  // 用户少做一次「再选一次合约」。没有该参数时行为不变。
  const contractId = useSearchParams().get("contractId");
  const withContract = (href: string) => {
    // 只有真正读 contractId 的两个表单带过去；其它入口（如注册研究）忽略该参数。
    const base = href.split("?")[0];
    const supportsContract =
      base === "/space/tasks/new/rws" || base === "/space/tasks/new/fl-prediction";
    if (!contractId || !supportsContract) return href;
    return `${href}${href.includes("?") ? "&" : "?"}contractId=${encodeURIComponent(contractId)}`;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {ORCHESTRATION_CREATE_OPTIONS.map((w) => {
        const path = w.newPath.split("?")[0];
        const active = currentPath === path || currentPath === w.newPath;
        return (
          <Link key={w.newPath} href={withContract(w.newPath)}>
            <Panel
              className={`p-5 h-full transition-colors hover:border-[var(--cs-cyan)] ${
                active ? "border-[var(--cs-cyan)]" : ""
              }`}
            >
              <div className="cs-label mb-1">{w.kicker}</div>
              <h3 className="text-base font-medium">{w.label}</h3>
              <p className="text-sm mt-2" style={{ color: "var(--cs-dim)" }}>
                {w.description}
              </p>
            </Panel>
          </Link>
        );
      })}
    </div>
  );
}
