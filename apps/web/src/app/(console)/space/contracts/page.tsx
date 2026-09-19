"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/console/ui";
import { ResourceList } from "@/components/console/data";
import { RequestContractButton } from "@/components/console/request-contract-button";
import { IssueContractButton } from "@/components/console/issue-contract-button";
import { ContractRowActions } from "@/components/console/contract-row-actions";
import { RoleGate } from "@/components/console/role-gate";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";

const statusColor: Record<string, string> = {
  active: "var(--cs-green)",
  approved: "var(--cs-green)",
  draft: "var(--cs-amber)",
  expired: "var(--cs-amber)",
  revoked: "var(--cs-red)",
};

const statusLabel: Record<string, string> = {
  active: "已生效",
  draft: "待审批",
  expired: "已过期",
  revoked: "已驳回/撤销",
};

export default function ContractsPage() {
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => api.listContracts(),
  });

  const { data: flTasks } = useQuery({
    queryKey: ["fl-prediction-tasks"],
    queryFn: () => api.listFlPredictionTasks(),
  });

  const inferByContract = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of flTasks ?? []) {
      if (t.status !== "completed" && t.status !== "partial") continue;
      const hasBundle = Boolean((t.merged as { weightBundle?: unknown } | undefined)?.weightBundle);
      if (!hasBundle) continue;
      for (const cid of t.contractIds ?? []) {
        if (!map.has(cid)) map.set(cid, t.taskId);
      }
    }
    return map;
  }, [flTasks]);

  return (
    <div>
      <PageHeader
        kicker="CONTRACTS · 数字合约"
        title="数字合约 / 接入审核"
        desc="药企提交申请（draft）→ 医院在列表行内签发（active）。仅合约提供方医院可见「签发」按钮。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <RoleGate roles={["consumer"]}>
              <RequestContractButton />
            </RoleGate>
            <RoleGate roles={["provider"]}>
              <IssueContractButton />
            </RoleGate>
          </div>
        }
      />
      <ResourceList
        items={data as any[] | undefined}
        loading={isLoading}
        error={error}
        loadingText="装载合约…"
        errorText="无法连接 /contracts。"
        emptyText="暂无数字合约。"
        rowClassName="px-6 py-4 flex flex-wrap items-center gap-3"
        rowKey={(c: any) => c.id}
        renderItem={(c: any) => {
          const status = c.effectiveStatus ?? c.status ?? "—";
          const canRevoke =
            user?.role === "provider" &&
            c.providerId === user?.participantId &&
            status === "active";
          return (
            <>
              <div className="flex-1 min-w-[220px]">
                <div className="text-sm font-medium truncate">{c.purpose ?? "(未声明目的)"}</div>
                <div className="cs-mono text-xs mt-1 truncate" style={{ color: "var(--cs-faint)" }}>
                  {(c.consumerId ?? "?")} → {(c.providerId ?? "?")}
                  {c.dataProductId ? ` · ${c.dataProductId}` : ""}
                  {c.retention ? ` · ${c.retention}` : ""}
                  {c.output ? ` · ${c.output}` : ""}
                  {c.outputPolicy?.minCell != null
                    ? ` · minCell=${c.outputPolicy.minCell}`
                    : ""}
                  {(Object.keys(c.pinnedModules ?? {}) as string[])
                    .map((k: string) => ` · 固定模块 ${k}=${String(c.pinnedModules[k]).slice(0, 16)}…`)
                    .join("")}
                </div>
              </div>
              <ContractRowActions contract={{ ...c, canRevoke }} />
              {inferByContract.get(c.id) && (c.effectiveStatus ?? c.status) === "active" && (
                <Link
                  href={`/space/infer/${encodeURIComponent(inferByContract.get(c.id)!)}?contractId=${encodeURIComponent(c.id)}`}
                  className="cs-navlink text-xs shrink-0"
                  style={{ borderColor: "var(--cs-cyan)", color: "var(--cs-cyan)" }}
                >
                  推理入口
                </Link>
              )}
              <span
                className="cs-chip shrink-0"
                style={{
                  borderColor: statusColor[status] ?? "var(--cs-line)",
                  color: statusColor[status] ?? "var(--cs-dim)",
                }}
              >
                {statusLabel[status] ?? status}
              </span>
            </>
          );
        }}
      />
    </div>
  );
}
