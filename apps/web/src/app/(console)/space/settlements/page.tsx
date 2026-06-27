"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/console/ui";
import { DataGrid, type GridColumn } from "@/components/console/data";
import { api } from "@/api/client";
import { useAuth, roleLabel } from "@/lib/auth";

const providerColumns: GridColumn<any>[] = [
  {
    header: "任务",
    className: "col-span-4",
    cell: (r) => <span className="cs-mono text-sm">{r.taskId}</span>,
  },
  {
    header: "我的贡献",
    className: "col-span-3",
    cell: (r) => <span className="cs-mono tabular-nums">{r.earning?.contribution} 条</span>,
  },
  {
    header: "我的收益",
    className: "col-span-3 text-right",
    cell: (r) => (
      <span className="cs-mono tabular-nums" style={{ color: "var(--cs-green)" }}>
        {r.earning?.amount} {r.currency}
      </span>
    ),
  },
  {
    header: "时间",
    className: "col-span-2 text-right",
    cell: (r) => (
      <span className="text-[0.72rem]" style={{ color: "var(--cs-faint)" }}>
        {r.at}
      </span>
    ),
  },
];

const consumerColumns: GridColumn<any>[] = [
  {
    header: "任务",
    className: "col-span-3",
    cell: (r) => (
      <div className="cs-mono text-sm">
        {r.taskId}
        <div className="cs-mono text-[0.66rem]" style={{ color: "var(--cs-faint)" }}>
          {r.taskRef}
        </div>
      </div>
    ),
  },
  {
    header: "使用方",
    className: "col-span-2",
    cell: (r) => <span className="text-sm">{r.consumer}</span>,
  },
  {
    header: "应付总额",
    className: "col-span-2 text-right",
    cell: (r) => (
      <span className="cs-mono tabular-nums" style={{ color: "var(--cs-cyan)" }}>
        {r.total} {r.currency}
      </span>
    ),
  },
  {
    header: "提供方分账(按贡献)",
    className: "col-span-4",
    cell: (r) => (
      <span className="text-[0.72rem]" style={{ color: "var(--cs-dim)" }}>
        {(r.lines ?? []).map((l: any) => `${l.org} ${l.contribution}条→${l.amount}`).join(" · ")}
      </span>
    ),
  },
  {
    header: "时间",
    className: "col-span-1 text-right",
    cell: (r) => (
      <span className="text-[0.66rem]" style={{ color: "var(--cs-faint)" }}>
        {r.at?.slice(5)}
      </span>
    ),
  },
];

export default function SettlementsPage() {
  const { role, ready } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .getSettlements()
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => setErr(e?.message || "加载失败"));
  }, []);

  const desc =
    role === "provider"
      ? "你的数据产品在各任务中的收益(按贡献占比分账)。仅显示你自己的收益明细。"
      : role === "consumer"
        ? "你发起的任务产生的费用与各院分账。"
        : "全局结算台账。各任务使用方应付、提供方按贡献分账,摘要上链可追溯。";

  return (
    <div>
      <PageHeader
        kicker={`SETTLEMENTS · 结算${ready && role ? " · " + (roleLabel[role] ?? role) : ""}`}
        title="价值结算"
        desc={desc}
      />
      <div className="p-8">
        <DataGrid
          columns={role === "provider" ? providerColumns : consumerColumns}
          rows={rows}
          rowKey={(r: any) => r.id}
          error={err || undefined}
          errorText={err}
          emptyText="暂无结算记录"
        />
      </div>
    </div>
  );
}
