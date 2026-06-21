"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel } from "@/components/console/ui";
import { api } from "@/api/client";

export default function AuditPage() {
  const [action, setAction] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit", action],
    queryFn: () => api.getAuditLogs(action ? { action, limit: 100 } : { limit: 100 }),
  });
  // 后端 /audit 返回 TypeORM getManyAndCount 元组 [logs, total];兼容旧 {logs,total} 形态。
  const raw = data as any;
  const logs: any[] = Array.isArray(raw) ? (raw[0] ?? []) : (raw?.logs ?? []);

  return (
    <div>
      <PageHeader
        kicker="AUDIT · 审计日志"
        title="审计日志"
        desc="控制面完整操作日志;不可篡改的哈希存证见存证账本。"
        action={
          <Link href="/space/attestations" className="cs-btn cs-btn-ghost">存证账本 →</Link>
        }
      />
      <div className="p-8 space-y-4">
        <input
          className="cs-input"
          style={{ maxWidth: 260 }}
          placeholder="按 action 过滤…"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        {isLoading && <div className="cs-label">装载日志…</div>}
        {error && (
          <Panel className="p-5 text-sm" style={{ color: "var(--cs-red)" }}>无法连接 /audit。</Panel>
        )}
        <Panel className="overflow-hidden p-0">
          <div
            className="grid px-5 py-2.5 cs-label"
            style={{ gridTemplateColumns: "190px 170px 1fr 150px", borderBottom: "1px solid var(--cs-line)" }}
          >
            <div>时间</div><div>动作</div><div>资源</div><div>用户</div>
          </div>
          {logs.map((l, i) => (
            <div
              key={l.id ?? i}
              className="cs-row grid items-center px-5 py-3"
              style={{ gridTemplateColumns: "190px 170px 1fr 150px" }}
            >
              <div className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>
                {l.timestamp ? new Date(l.timestamp).toLocaleString() : "—"}
              </div>
              <div className="cs-mono text-xs">{l.action}</div>
              <div className="text-sm truncate">{l.resourceType ?? l.resource ?? "—"}{l.resourceId ? ` #${l.resourceId}` : ""}</div>
              <div className="cs-mono text-xs" style={{ color: "var(--cs-dim)" }}>
                {l.user?.name ?? l.user?.email ?? "—"}
              </div>
            </div>
          ))}
          {logs.length === 0 && !isLoading && (
            <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--cs-faint)" }}>暂无日志。</div>
          )}
        </Panel>
      </div>
    </div>
  );
}
