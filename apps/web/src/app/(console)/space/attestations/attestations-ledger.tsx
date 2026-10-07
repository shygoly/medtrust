"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataGrid, type GridColumn } from "@/components/console/data";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { type AttestationRow, toAttestationRows } from "@/lib/attestations";

const columns: GridColumn<AttestationRow>[] = [
  {
    header: "类别",
    className: "col-span-2",
    cell: (r) => <span className="cs-chip">{r.kindLabel}</span>,
  },
  {
    header: "归属对象",
    className: "col-span-3 min-w-0",
    cell: (r) => (
      <>
        <div className="text-sm truncate">{r.subjectLabel}</div>
        {r.subjectHref ? (
          <Link
            href={r.subjectHref}
            className="cs-mono text-[0.68rem] truncate block"
            style={{ color: "var(--cs-cyan)" }}
            title={r.subjectId}
          >
            {r.subjectId}
          </Link>
        ) : (
          <div className="cs-mono text-[0.68rem] truncate" style={{ color: "var(--cs-faint)" }}>
            {r.subjectId}
          </div>
        )}
      </>
    ),
  },
  {
    header: "哈希 / 链上交易",
    className: "col-span-3 min-w-0",
    cell: (r) => (
      <div className="cs-mono text-[0.68rem]" style={{ color: "var(--cs-dim)" }}>
        <div className="truncate" title={r.hash}>
          hash · {r.hashShort}
        </div>
        <div className="truncate" title={r.txHash} style={{ color: "var(--cs-faint)" }}>
          tx · {r.txShort}
        </div>
      </div>
    ),
  },
  {
    header: "区块",
    className: "col-span-2 text-right",
    cell: (r) => <span className="cs-mono text-xs tabular-nums whitespace-nowrap">{r.block}</span>,
  },
  {
    header: "上链时间",
    className: "col-span-2 text-right",
    cell: (r) => (
      <span className="cs-mono text-[0.72rem] tabular-nums" style={{ color: "var(--cs-dim)" }}>
        {r.time}
      </span>
    ),
  },
];

export function AttestationsLedger() {
  const { role } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["attestation-ledger"],
    queryFn: () => api.listAttestations(),
  });
  const rows = useMemo(() => (data ? toAttestationRows(data) : undefined), [data]);
  const scoped = role === "provider" || role === "consumer";

  return (
    <DataGrid
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      loading={isLoading}
      error={error ?? undefined}
      loadingText="正在读取链上存证…"
      errorText={`无法读取存证账本：${error instanceof Error ? error.message : "加载失败"}`}
      emptyText={
        scoped
          ? "暂无链上存证记录。此处只显示你参与的任务、作业与合约的存证。"
          : "暂无链上存证记录。"
      }
    />
  );
}
