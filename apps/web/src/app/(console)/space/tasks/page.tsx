"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Gavel } from "lucide-react";
import { PageHeader, Panel, TaskStatusBadge } from "@/components/console/ui";
import { RoleGate } from "@/components/console/role-gate";
import { api, RwsOrchestrationRecord } from "@/api/client";
import type { TaskStatus } from "@/lib/space-mock";

function mapStatus(s: RwsOrchestrationRecord["status"]): TaskStatus {
  if (s === "completed") return "completed" as const;
  if (s === "running" || s === "pending") return "running" as const;
  if (s === "partial") return "running" as const;
  return "blocked" as const;
}

export default function TasksPage() {
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["rws-tasks"],
    queryFn: () => api.listRwsTasks(),
    refetchInterval: 5000,
  });

  return (
    <div>
      <PageHeader
        kicker="RWS TASKS · 真实世界研究任务"
        title="RWS 任务"
        desc="药企发起，控制面校验合约后写入连接器队列；各院连接器出站拉取、prefetch 目录、本地执行。"
        action={
          <div className="flex items-center gap-2">
            <Link href="/space/atlas/compose" className="cs-btn cs-btn-ghost">
              <Gavel size={15} /> 去编排
            </Link>
            <RoleGate roles={["consumer"]}>
              <Link href="/space/tasks/new" className="cs-btn">
                <Plus size={15} /> 发起 RWS 任务
              </Link>
            </RoleGate>
          </div>
        }
      />
      <div className="p-8 space-y-4">
        {isLoading && <Panel className="px-6 py-5 cs-label">加载中…</Panel>}
        {!isLoading && !(tasks as RwsOrchestrationRecord[])?.length && (
          <Panel className="px-6 py-5 cs-label">暂无任务 — 药企账号可发起 RWS 任务</Panel>
        )}
        {((tasks as RwsOrchestrationRecord[]) ?? []).map((t) => (
          <Link key={t.taskId} href={`/space/tasks/${t.taskId}`}>
            <Panel className="px-6 py-5 hover:border-[var(--cs-cyan)] transition-colors" style={{ transition: "border-color 0.15s" }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-base font-medium">{t.title}</h3>
                  <div className="cs-mono text-xs mt-1" style={{ color: "var(--cs-faint)" }}>
                    {t.taskId} · {t.consumerId} · {t.createdAt}
                  </div>
                  <p className="text-sm mt-2 max-w-3xl" style={{ color: "var(--cs-dim)" }}>
                    {t.analysis.type}
                    {t.merged ? ` · 合并队列 n=${t.merged.cohortSize}` : ""}
                  </p>
                </div>
                <TaskStatusBadge status={mapStatus(t.status)} />
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <span className="cs-chip">目的 · {t.purpose}</span>
                <span className="cs-chip">{t.assignments.length} 家连接器</span>
                <span className="cs-chip" style={{ color: "var(--cs-dim)" }}>
                  {t.status}
                </span>
              </div>
            </Panel>
          </Link>
        ))}
      </div>
    </div>
  );
}
