"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader, Panel } from "@/components/console/ui";
import { api } from "@/api/client";
import { useAuditLogs } from "@/hooks/use-audit-logs";
import { AlertsView } from "./alerts-view";

export default function AuditPage() {
  const [action, setAction] = useState("");
  // 告警是同一份审计日志的另一个视图，写入地址以便从总览直达。
  const view = useSearchParams().get("view") === "alerts" ? "alerts" : "logs";
  const { data, isLoading, error } = useAuditLogs(action);
  const logs = data ?? [];

  const downloadReport = async () => {
    const report = await api.exportAudit({ limit: 200 });
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medtrust-audit-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadEvidencePackage = async () => {
    const blob = await api.downloadAuditEvidencePackage({ limit: 200 });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medtrust-evidence-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        kicker="AUDIT · 审计日志"
        desc="控制面完整操作日志与从中识别的合规告警;不可篡改的哈希存证见存证账本。"
        action={
          <div className="flex items-center gap-2">
            <button className="cs-btn cs-btn-ghost" onClick={downloadReport}>导出报告(JSON)</button>
            <button className="cs-btn cs-btn-ghost" onClick={downloadEvidencePackage}>导出证据包(ZIP)</button>
            <Link href="/space/attestations" className="cs-btn cs-btn-ghost">存证账本 →</Link>
          </div>
        }
      />
      <div className="p-8 space-y-4">
        <div className="flex gap-2">
          <Link href="/space/audit" className="cs-chip" data-active={view === "logs"}>全部日志</Link>
          <Link href="/space/audit?view=alerts" className="cs-chip" data-active={view === "alerts"}>合规告警</Link>
        </div>
        {view === "alerts" ? (
          <AlertsView />
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
