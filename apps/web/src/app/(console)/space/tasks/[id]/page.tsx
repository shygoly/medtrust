"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { PageHeader, Panel, TaskStatusBadge } from "@/components/console/ui";
import { api } from "@/api/client";
import type { TaskStatus } from "@/lib/space-mock";

function mapStatus(s: string): TaskStatus {
  if (s === "completed") return "completed" as const;
  if (s === "failed") return "blocked" as const;
  return "running" as const;
}

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = String(params.id);

  const { data: task, isLoading } = useQuery({
    queryKey: ["rws-task", taskId],
    queryFn: () => api.getRwsTask(taskId),
    refetchInterval: 3000,
  });

  if (isLoading) {
    return <div className="p-8 cs-label">加载中…</div>;
  }

  if (!task) {
    return <div className="p-8 cs-label">任务不存在</div>;
  }

  return (
    <div>
      <PageHeader
        kicker={`RWS TASK · ${task.taskId.slice(0, 8)}`}
        title={task.title}
        desc={`${task.consumerId} 发起 · ${task.createdAt}`}
        action={<TaskStatusBadge status={mapStatus(task.status)} />}
      />
      <div className="p-8">
        <Link href="/space/tasks" className="inline-flex items-center gap-1.5 text-sm mb-6" style={{ color: "var(--cs-dim)" }}>
          <ArrowLeft size={14} /> 返回任务列表
        </Link>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            <Panel className="p-6">
              <div className="cs-label mb-4">任务定义</div>
              <dl className="space-y-3 text-sm">
                <Row k="研究目的" v={task.purpose} />
                <Row k="分析类型" v={task.analysis.type} />
                {task.analysis.drug && <Row k="用药过滤" v={task.analysis.drug} />}
              </dl>
            </Panel>

            <Panel ticks className="p-6">
              <div className="cs-label mb-4">连接器分派 · 执行进度</div>
              <div className="space-y-4">
                {task.assignments.map((a) => (
                  <div key={a.assignmentId} className="text-sm border-b pb-4" style={{ borderColor: "var(--cs-line-soft)" }}>
                    <div className="flex justify-between mb-2">
                      <span>{a.providerId}</span>
                      <span className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>{a.status}</span>
                    </div>
                    {(a.progress?.length ?? 0) > 0 ? (
                      <ol className="space-y-1 cs-mono text-[0.68rem]" style={{ color: "var(--cs-dim)" }}>
                        {a.progress!.map((p, i) => (
                          <li key={`${p.at}-${i}`} className="flex gap-2">
                            <span style={{ color: "var(--cs-faint)" }}>{p.at.slice(11, 19)}</span>
                            <span style={{ color: p.stage === "failed" ? "var(--cs-red)" : p.stage === "complete" ? "var(--cs-green)" : "var(--cs-cyan)" }}>
                              {p.stage}
                            </span>
                            {p.detail && <span>{p.detail}</span>}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="text-xs" style={{ color: "var(--cs-faint)" }}>
                        {a.status === "pending" ? "等待连接器拉取…" : "暂无进度事件"}
                      </div>
                    )}
                    {a.aggregate && (
                      <div className="cs-mono text-xs mt-2" style={{ color: "var(--cs-dim)" }}>
                        队列 n={a.aggregate.cohortSize}
                        {a.aggregate.buckets.slice(0, 3).map((b) => ` · ${b.key}:${b.count}`).join("")}
                      </div>
                    )}
                    {a.error && (
                      <div className="text-xs mt-1" style={{ color: "var(--cs-red)" }}>{a.error}</div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[0.68rem] mt-4" style={{ color: "var(--cs-faint)" }}>
                终端亦可观测：连接器日志 <code>ConnectorWorkerService</code>、控制面 <code>RwsOrchestratorService</code>
              </p>
            </Panel>

            <Panel className="p-6">
              <div className="cs-label mb-4">合并聚合</div>
              {task.merged ? (
                <div>
                  <div className="flex items-center gap-2 text-sm mb-3" style={{ color: "var(--cs-green)" }}>
                    <ShieldCheck size={16} /> 已合并 · 队列 n={task.merged.cohortSize}
                  </div>
                  <div className="space-y-1 text-sm">
                    {task.merged.buckets.slice(0, 8).map((b) => (
                      <div key={b.key} className="flex justify-between">
                        <span>{b.key}</span>
                        <span className="cs-mono">{b.count} ({(b.rate * 100).toFixed(1)}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm" style={{ color: "var(--cs-faint)" }}>
                  等待各院连接器出站拉取并回传聚合…
                </div>
              )}
            </Panel>
          </div>

          <Panel className="p-6">
            <div className="cs-label mb-4">合约引用</div>
            <dl className="space-y-2 text-sm">
              {task.contractIds.map((id) => (
                <Row key={id} k="合约" v={id} mono />
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="cs-label shrink-0 w-20 pt-0.5">{k}</dt>
      <dd className={`flex-1 ${mono ? "cs-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}
