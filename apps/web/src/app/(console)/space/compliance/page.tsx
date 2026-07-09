"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { PageHeader, Panel, Stat } from "@/components/console/ui";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { normalizeAuditList, extractAlerts } from "@/lib/compliance";

const ALLOWED = ["compliance", "operator"];

export default function ComplianceOverviewPage() {
  const { user, ready } = useAuth();

  const contracts = useQuery({ queryKey: ["c-contracts"], queryFn: () => api.getAccessRequests() });
  const catalog = useQuery({ queryKey: ["c-catalog"], queryFn: () => api.getDataAssets() });
  const settlements = useQuery({ queryKey: ["c-settlements"], queryFn: () => api.getSettlements() });
  const audit = useQuery({ queryKey: ["c-audit"], queryFn: () => api.getAuditLogs({ limit: 200 }) });

  if (!ready) return null;
  if (!user?.role || !ALLOWED.includes(user.role)) {
    return (
      <div>
        <PageHeader kicker="COMPLIANCE · 合规" title="合规总览" />
        <div className="p-8">
          <Panel className="p-6 text-sm" style={{ color: "var(--cs-amber)" }}>
            仅「合规方 / 监管方」角色可访问本视图。当前角色无权限。
          </Panel>
        </div>
      </div>
    );
  }

  const logs = normalizeAuditList(audit.data);
  const alerts = extractAlerts(logs);
  const highCount = alerts.filter((a) => a.kind.severity === "high").length;

  const n = (q: { data?: unknown[] }) => (Array.isArray(q.data) ? q.data.length : 0);

  return (
    <div>
      <PageHeader
        kicker="COMPLIANCE · 合规总览"
        title="合规总览"
        desc="面向合规/监管角色:汇总数字合约、数据产品、结算与控制面审计,自动识别高危事件。"
        action={<Link href="/space/compliance/alerts" className="cs-btn cs-btn-ghost">合规告警 →</Link>}
      />

      <div className="p-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <Stat label="数字合约" value={n(contracts)} unit="份" accent="cyan" />
          <Stat label="数据产品" value={n(catalog)} unit="个" />
          <Stat label="结算记录" value={n(settlements)} unit="笔" />
          <Stat label="审计事件" value={logs.length} unit="条 · 近 200" />
          <Stat label="高危告警" value={highCount} unit="项" accent={highCount > 0 ? "red" : "green"} />
        </div>

        <Panel className="overflow-hidden p-0">
          <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--cs-line)" }}>
            <div className="cs-label">RECENT ALERTS · 最近合规告警</div>
            <Link href="/space/compliance/alerts" className="text-xs" style={{ color: "var(--cs-cyan)" }}>
              全部 <ArrowUpRight size={12} className="inline" />
            </Link>
          </div>
          {audit.isLoading && <div className="px-6 py-6 cs-label">装载审计事件…</div>}
          {audit.error && (
            <div className="px-6 py-6 text-sm" style={{ color: "var(--cs-red)" }}>无法连接 /audit。</div>
          )}
          {!audit.isLoading && alerts.length === 0 && (
            <div className="px-6 py-8 text-center text-sm" style={{ color: "var(--cs-faint)" }}>
              近期无高危/异常事件。
            </div>
          )}
          {alerts.slice(0, 8).map((a, i) => (
            <div key={a.id ?? i} className="cs-row grid items-center px-6 py-3" style={{ gridTemplateColumns: "90px 150px 1fr 160px" }}>
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
              <div className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>
                {a.timestamp ? new Date(a.timestamp).toLocaleString() : "—"}
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
