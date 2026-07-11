"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Gavel, Share2 } from "lucide-react";
import { PageHeader, Panel, TaskStatusBadge } from "@/components/console/ui";
import { RoleGate } from "@/components/console/role-gate";
import { api, FlPredictionOrchestrationRecord, RwsOrchestrationRecord } from "@/api/client";
import { federatedStateLabel, type SecretFlowTaskSummary } from "@/lib/federated-tasks";
import {
  mapOrchestrationStatus,
  orchestrationDetailHref,
  UnifiedOrchestrationListItem,
  workloadMeta,
} from "@/lib/orchestration-workloads";

async function safeList<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function secretFlowSummary(t: SecretFlowTaskSummary): string {
  if (t.state === "COMPLETED") return "LoRA 联邦微调已完成";
  const parts: string[] = [];
  if (t.currentEpoch != null) parts.push(`epoch ${t.currentEpoch}`);
  if (t.lastLoss != null) parts.push(`loss ${t.lastLoss.toFixed(0)}`);
  if (parts.length) return parts.join(" · ");
  return federatedStateLabel(t.state);
}

function toUnifiedList(
  rws: RwsOrchestrationRecord[],
  fl: FlPredictionOrchestrationRecord[],
  sf: SecretFlowTaskSummary[],
): UnifiedOrchestrationListItem[] {
  const rwsItems: UnifiedOrchestrationListItem[] = rws.map((t) => ({
    kind: "rws",
    taskId: t.taskId,
    title: t.title,
    purpose: t.purpose,
    status: t.status,
    consumerId: t.consumerId,
    createdAt: t.createdAt,
    providerCount: t.assignments.length,
    summary: t.merged
      ? `合并队列 n=${t.merged.cohortSize}`
      : `${t.analysis.type}`,
  }));

  const flItems: UnifiedOrchestrationListItem[] = fl.map((t) => ({
    kind: "fl_prediction",
    taskId: t.taskId,
    title: t.title,
    purpose: t.purpose,
    status: t.status,
    consumerId: t.consumerId,
    createdAt: t.createdAt,
    providerCount: t.assignments.length,
    summary: t.resultSummary?.auc
      ? `AUC ${t.resultSummary.auc} · ${t.flPredictionSpec.modelType}`
      : `${t.flPredictionSpec.modelType} → ${t.flPredictionSpec.targetColumn}`,
  }));

  const sfItems: UnifiedOrchestrationListItem[] = sf.map((t) => ({
    kind: "secretflow",
    taskId: t.taskId,
    title: t.purpose ? `SecretFlow · ${t.purpose}` : `SecretFlow · ${t.taskId}`,
    purpose: t.purpose ?? "联邦密算",
    status: t.state,
    consumerId: t.consumerId ?? "—",
    createdAt: t.createdAt ?? t.taskId,
    providerCount: t.providerCount ?? 0,
    summary: secretFlowSummary(t),
    detailHref: `/space/federated/${encodeURIComponent(t.taskId)}`,
  }));

  return [...rwsItems, ...flItems, ...sfItems].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export default function TasksPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["orchestration-tasks"],
    queryFn: async () => {
      const [rws, fl, sf] = await Promise.all([
        safeList(() => api.listRwsTasks(), [] as RwsOrchestrationRecord[]),
        safeList(() => api.listFlPredictionTasks(), [] as FlPredictionOrchestrationRecord[]),
        safeList(() => api.listSecretFlowTasks() as Promise<SecretFlowTaskSummary[]>, []),
      ]);
      return toUnifiedList(rws, fl, sf);
    },
    refetchInterval: 5000,
  });

  const tasks = useMemo(() => data ?? [], [data]);

  return (
    <div>
      <PageHeader
        kicker="ORCHESTRATION · 出站联邦任务"
        title="编排任务"
        desc="RWS 队列统计、L4 表格联邦预测与 SecretFlow 多模态 LoRA 任务统一总览；RWS/L4 在本页发起，SecretFlow 详情跳转联邦密算。"
        action={
          <div className="flex items-center gap-2">
            <Link href="/space/atlas/compose" className="cs-btn cs-btn-ghost">
              <Gavel size={15} /> 去编排
            </Link>
            <RoleGate roles={["consumer"]}>
              <Link href="/space/tasks/new" className="cs-btn">
                <Plus size={15} /> 发起任务
              </Link>
            </RoleGate>
          </div>
        }
      />
      <div className="p-8 space-y-4">
        <Panel className="px-6 py-4 text-sm" style={{ color: "var(--cs-dim)" }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>
              <strong style={{ color: "var(--cs-text)" }}>RWS / L4 FL</strong>：合约准入 → 连接器出站拉取，可在本页发起与跟踪。
            </span>
            <span>
              <strong style={{ color: "var(--cs-text)" }}>SecretFlow（SF）</strong>：多模态 LoRA 联邦微调，列表中带 SF 标签，详情见{" "}
              <Link href="/space/federated" className="inline-flex items-center gap-1 underline" style={{ color: "var(--cs-cyan)" }}>
                <Share2 size={13} /> 联邦密算
              </Link>
              ；可从{" "}
              <Link href="/space/catalog" className="underline" style={{ color: "var(--cs-cyan)" }}>
                数据产品目录
              </Link>{" "}
              发起训练。
            </span>
          </div>
        </Panel>

        {isLoading && <Panel className="px-6 py-5 cs-label">加载中…</Panel>}
        {!isLoading && !tasks.length && (
          <Panel className="px-6 py-5 cs-label">
            暂无任务 — 可发起 RWS、L4 联邦预测；SecretFlow 见联邦密算或数据产品目录
          </Panel>
        )}
        {tasks.map((t) => {
          const meta = workloadMeta(t.kind);
          const href = orchestrationDetailHref(t);
          return (
            <Link key={`${t.kind}-${t.taskId}`} href={href}>
              <Panel className="px-6 py-5 hover:border-[var(--cs-cyan)] transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="cs-chip text-[0.65rem]">{meta.shortLabel}</span>
                      <h3 className="text-base font-medium truncate">{t.title}</h3>
                    </div>
                    <div className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>
                      {t.taskId} · {t.consumerId} · {t.createdAt}
                    </div>
                    <p className="text-sm mt-2 max-w-3xl" style={{ color: "var(--cs-dim)" }}>
                      {t.summary}
                    </p>
                  </div>
                  <TaskStatusBadge status={mapOrchestrationStatus(t.status)} />
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <span className="cs-chip">目的 · {t.purpose}</span>
                  {t.providerCount > 0 && (
                    <span className="cs-chip">{t.providerCount} 家连接器</span>
                  )}
                  <span className="cs-chip" style={{ color: "var(--cs-dim)" }}>
                    {t.kind === "secretflow" ? federatedStateLabel(t.status) : t.status}
                  </span>
                </div>
              </Panel>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
