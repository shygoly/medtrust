"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel } from "@/components/console/ui";
import { api } from "@/api/client";

const statusColor: Record<string, string> = {
  active: "var(--cs-green)",
  approved: "var(--cs-green)",
  draft: "var(--cs-faint)",
  expired: "var(--cs-amber)",
  revoked: "var(--cs-red)",
};

export default function ContractsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => api.getAccessRequests(),
  });

  return (
    <div>
      <PageHeader
        kicker="CONTRACTS · 数字合约"
        title="数字合约 / 接入审核"
        desc="联邦范式下授权 = 签发数字合约(目的 / 留存 / 输出限定);由连接器 PEP + L2 verdict 双闸门强制执行。"
      />
      <div className="p-8 space-y-3">
        {isLoading && <div className="cs-label">装载合约…</div>}
        {error && (
          <Panel className="p-5 text-sm" style={{ color: "var(--cs-red)" }}>无法连接 /contracts。</Panel>
        )}
        {(data as any[] | undefined)?.map((c: any) => (
          <Panel key={c.id} className="px-6 py-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{c.purpose ?? "(未声明目的)"}</div>
              <div className="cs-mono text-xs mt-1 truncate" style={{ color: "var(--cs-faint)" }}>
                {(c.consumerId ?? c.consumer ?? "?")} → {(c.providerId ?? c.provider ?? "?")}
                {c.retention ? ` · ${c.retention}` : ""}
                {c.output ? ` · ${c.output}` : ""}
              </div>
            </div>
            <span
              className="cs-chip"
              style={{
                borderColor: statusColor[c.status] ?? "var(--cs-line)",
                color: statusColor[c.status] ?? "var(--cs-dim)",
              }}
            >
              {c.status ?? "—"}
            </span>
          </Panel>
        ))}
        {data && (data as any[]).length === 0 && (
          <Panel className="p-8 text-center text-sm" style={{ color: "var(--cs-faint)" }}>暂无数字合约。</Panel>
        )}
      </div>
    </div>
  );
}
