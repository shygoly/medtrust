"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { PageHeader, Panel } from "@/components/console/ui";
import { DataGrid, type GridColumn } from "@/components/console/data";
import { api } from "@/api/client";
import {
  federatedConnectorsLabel,
  federatedStateColor,
  federatedStateLabel,
  type SecretFlowMergedResult,
  type SecretFlowTaskSummary,
} from "@/lib/federated-tasks";

type Row = SecretFlowTaskSummary & { loraDeltaHash?: string; partyCount?: number };

function StateBadge({ state }: { state: string }) {
  const color = federatedStateColor(state);
  return (
    <span className="cs-chip" style={{ color, borderColor: color }}>
      {federatedStateLabel(state)}
    </span>
  );
}

const columns: GridColumn<Row>[] = [
  {
    header: "任务 ID",
    className: "col-span-3",
    cell: (r) => (
      <Link href={`/space/federated/${encodeURIComponent(r.taskId)}`} className="cs-mono text-sm hover:underline">
        {r.taskId}
      </Link>
    ),
  },
  {
    header: "状态",
    className: "col-span-2",
    cell: (r) => <StateBadge state={r.state} />,
  },
  {
    header: "参与 connector",
    className: "col-span-2",
    cell: (r) => (
      <span className="text-sm" style={{ color: "var(--cs-dim)" }}>
        {r.partyCount ? `${r.partyCount} 方` : "—"}
      </span>
    ),
  },
  {
    header: "合并 LoRA 哈希",
    className: "col-span-3",
    cell: (r) =>
      r.loraDeltaHash ? (
        <span className="cs-mono text-xs truncate" style={{ color: "var(--cs-cyan)" }}>
          {r.loraDeltaHash}
        </span>
      ) : (
        <span className="text-xs" style={{ color: "var(--cs-faint)" }}>
          {r.state === "COMPLETED" ? "加载中…" : "—"}
        </span>
      ),
  },
  {
    header: "Epoch / Loss",
    className: "col-span-1 text-right",
    cell: (r) => (
      <span className="cs-mono text-xs tabular-nums" style={{ color: "var(--cs-faint)" }}>
        {r.currentEpoch ?? "—"}
        {typeof r.lastLoss === "number" ? ` · ${r.lastLoss.toFixed(0)}` : ""}
      </span>
    ),
  },
  {
    header: "",
    className: "col-span-1 text-right",
    cell: (r) => (
      <Link
        href={`/space/federated/${encodeURIComponent(r.taskId)}`}
        className="cs-btn cs-btn-ghost text-xs inline-flex items-center gap-1"
      >
        详情 <ArrowUpRight size={12} />
      </Link>
    ),
  },
];

export default function FederatedTasksPage() {
  const {
    data: tasks,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["secretflow-tasks"],
    queryFn: () => api.listSecretFlowTasks() as Promise<SecretFlowTaskSummary[]>,
    refetchInterval: 15_000,
  });

  const completed = (tasks ?? []).filter((t) => t.state === "COMPLETED");
  const resultQueries = useQueries({
    queries: completed.map((t) => ({
      queryKey: ["secretflow-result", t.taskId],
      queryFn: () => api.getSecretFlowResult(t.taskId) as Promise<SecretFlowMergedResult>,
      staleTime: 60_000,
    })),
  });

  const resultById = Object.fromEntries(
    completed.map((t, i) => [t.taskId, resultQueries[i]?.data as SecretFlowMergedResult | undefined]),
  );

  const rows: Row[] = (tasks ?? []).map((t) => {
    const res = resultById[t.taskId];
    return {
      ...t,
      loraDeltaHash: res?.loraDeltaHash,
      partyCount: res?.metrics?.partyCount,
    };
  });

  return (
    <div>
      <PageHeader
        kicker="FEDERATED · 联邦密算任务"
        title="联邦密算与合并结果"
        desc="各院 connector 在本地训练后,控制面聚合 LoRA 哈希与贡献分账;此处展示持久化的合并输出,不含任何原始患者数据。"
        action={
          <button type="button" className="cs-btn cs-btn-ghost" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> 刷新
          </button>
        }
      />
      <div className="p-8 space-y-4">
        <Panel className="p-5 text-sm" style={{ color: "var(--cs-dim)" }}>
          原始 FHIR 数据留在各 connector 的 <span className="cs-mono text-xs">/data/synthea/ingested</span>{" "}
          路径下;合并产物仅为 <span className="cs-mono text-xs">loraDeltaHash</span>、训练指标与分账摘要。
          提供方亦可在{" "}
          <Link href="/space/catalog" className="underline" style={{ color: "var(--cs-cyan)" }}>
            数据产品目录
          </Link>{" "}
          发起「连接器训练」。
        </Panel>
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(r) => r.taskId}
          loading={isLoading}
          error={error}
          loadingText="装载联邦任务…"
          errorText="无法连接 /secretflow/tasks。"
          emptyText="暂无联邦密算任务。"
        />
      </div>
    </div>
  );
}
