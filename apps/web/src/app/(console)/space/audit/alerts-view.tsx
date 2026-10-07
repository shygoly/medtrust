"use client";

import { useState } from "react";
import { Panel } from "@/components/console/ui";
import { useAuditLogs } from "@/hooks/use-audit-logs";
import { extractAlerts, type Severity } from "@/lib/compliance";

type Filter = "all" | Severity;

// 审计日志页的告警视图（/space/audit?view=alerts）：从同一份审计日志里识别高危与异常操作。
export function AlertsView() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isLoading, error } = useAuditLogs();

  const alerts = extractAlerts(data ?? []);
  const shown = filter === "all" ? alerts : alerts.filter((a) => a.kind.severity === filter);
  const highN = alerts.filter((a) => a.kind.severity === "high").length;
  const medN = alerts.length - highN;

  const tabs: Array<{ key: Filter; label: string }> = [
    { key: "all", label: `全部 ${alerts.length}` },
    { key: "high", label: `高危 ${highN}` },
    { key: "medium", label: `关注 ${medN}` },
  ];

  return (
    <>
    <div className="flex gap-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => setFilter(t.key)}
          className="cs-btn cs-btn-ghost"
          data-active={filter === t.key}
          style={filter === t.key ? { borderColor: "var(--cs-cyan)", color: "var(--cs-cyan)" } : undefined}
        >
          {t.label}
        </button>
      ))}
    </div>

    {isLoading && <div className="cs-label">装载审计事件…</div>}
    {error && <Panel className="p-5 text-sm" style={{ color: "var(--cs-red)" }}>无法连接 /audit。</Panel>}

    <Panel className="overflow-hidden p-0">
      <div
        className="grid px-5 py-2.5 cs-label"
        style={{ gridTemplateColumns: "80px 160px 1fr 150px 160px", borderBottom: "1px solid var(--cs-line)" }}
      >
        <div>级别</div><div>动作</div><div>类型 · 资源</div><div>用户</div><div>时间</div>
      </div>
      {shown.map((a, i) => (
        <div
          key={a.id ?? i}
          className="cs-row grid items-center px-5 py-3"
          style={{ gridTemplateColumns: "80px 160px 1fr 150px 160px" }}
        >
          <span
            className="cs-chip"
            style={{
              color: a.kind.severity === "high" ? "var(--cs-red)" : "var(--cs-amber)",
              borderColor: a.kind.severity === "high" ? "var(--cs-red)" : "var(--cs-amber)",
            }}
          >
            {a.kind.severity === "high" ? "高危" : "关注"}
          </span>
          <div className="cs-mono text-xs">{a.action}</div>
          <div className="text-sm truncate">{a.kind.label} · {a.resourceType ?? a.resource ?? "—"}{a.resourceId ? ` #${a.resourceId}` : ""}</div>
          <div className="cs-mono text-xs" style={{ color: "var(--cs-dim)" }}>{a.user?.name ?? a.user?.email ?? "—"}</div>
          <div className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>
            {a.timestamp ? new Date(a.timestamp).toLocaleString() : "—"}
          </div>
        </div>
      ))}
      {!isLoading && shown.length === 0 && (
        <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--cs-faint)" }}>
          无匹配告警。
        </div>
      )}
    </Panel>
    </>
  );
}
