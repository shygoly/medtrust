"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Panel, Stat } from "@/components/console/ui";
import { api } from "@/api/client";
import {
  KriDefinition,
  KriObservation,
  QtlBreach,
  RISK_TIER_LABEL,
  SEVERITY_LABEL,
  severityColor,
  riskTierColor,
  observationLevel,
  buildMatrix,
  pct,
} from "@/lib/rbqm";

export default function RbqmPage() {
  const defsQ = useQuery({
    queryKey: ["rbqm-kris"],
    queryFn: () => api.getKriDefinitions() as Promise<KriDefinition[]>,
  });
  const obsQ = useQuery({
    queryKey: ["rbqm-obs"],
    queryFn: () => api.getKriObservations() as Promise<KriObservation[]>,
  });
  const breachQ = useQuery({
    queryKey: ["rbqm-breaches"],
    queryFn: () => api.getQtlBreaches() as Promise<QtlBreach[]>,
  });
  const queryClient = useQueryClient();
  const acknowledge = useMutation({
    mutationFn: (id: string) => api.acknowledgeQtlBreach(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rbqm-breaches"] }),
  });

  const defs = defsQ.data ?? [];
  const observations = obsQ.data ?? [];
  const breaches = breachQ.data ?? [];
  const defByCode = new Map(defs.map((d) => [d.code, d]));
  const rows = buildMatrix(observations);
  const openBreaches = breaches.filter((b) => b.status === "open");
  const criticalCount = openBreaches.filter((b) => b.severity === "critical").length;

  return (
    <div>
      <PageHeader
        kicker="RBQM · 中心化监查"
        desc="风险导向质量管理：KRI 关键风险指标 · QTL 质量容差限。所有观测均为站点级聚合，原始数据不出域。"
      />
      <div className="p-8 flex flex-col gap-8">
        {/* 概览 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="KRI 指标" value={defs.length} accent="cyan" />
          <Stat label="监查站点" value={rows.length} />
          <Stat label="开放越限" value={openBreaches.length} accent="amber" />
          <Stat label="严重越限" value={criticalCount} accent="red" />
        </div>

        {/* 站点 × KRI 热力矩阵 */}
        <section className="flex flex-col gap-3">
          <div className="cs-label">站点 × KRI 观测矩阵 · 聚合信号</div>
          <Panel className="p-0 overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="text-left px-4 py-3 cs-label" style={{ borderBottom: "1px solid var(--cs-line)" }}>
                    站点
                  </th>
                  {defs.map((d) => (
                    <th
                      key={d.code}
                      className="px-4 py-3 text-left cs-label"
                      style={{ borderBottom: "1px solid var(--cs-line)", whiteSpace: "nowrap" }}
                      title={d.description}
                    >
                      {d.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.siteId}>
                    <td className="px-4 py-3" style={{ borderBottom: "1px solid var(--cs-line)", whiteSpace: "nowrap" }}>
                      {row.siteName}
                    </td>
                    {defs.map((d) => {
                      const o = row.cells.get(d.code);
                      const level = o ? observationLevel(o, defByCode.get(d.code)) : null;
                      const bg = level ? severityColor(level) : "transparent";
                      return (
                        <td
                          key={d.code}
                          className="px-4 py-3"
                          style={{ borderBottom: "1px solid var(--cs-line)" }}
                        >
                          {!o ? (
                            <span style={{ color: "var(--cs-dim)" }}>—</span>
                          ) : o.suppressed ? (
                            <span
                              className="cs-chip"
                              title="分母小于小格抑制阈值（5），观测被抑制"
                              style={{ color: "var(--cs-dim)" }}
                            >
                              已抑制
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="cs-dot"
                                style={{
                                  background: bg === "transparent" ? "var(--cs-green)" : bg,
                                }}
                              />
                              <span className="cs-mono">{pct(o.value)}</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-sm" style={{ color: "var(--cs-dim)" }} colSpan={defs.length + 1}>
                      暂无站点观测。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Panel>
        </section>

        {/* QTL 越限清单 */}
        <section className="flex flex-col gap-3">
          <div className="cs-label">QTL 越限清单 · 质量容差限</div>
          <div className="flex flex-col gap-2">
            {openBreaches.length === 0 && (
              <Panel className="p-5 text-sm" style={{ color: "var(--cs-dim)" }}>
                当前无开放越限。
              </Panel>
            )}
            {breaches.map((b) => {
              const def = defByCode.get(b.kriCode);
              const local = b.attestationTxHash.startsWith("0xLOCAL");
              return (
                <Panel key={b.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="cs-chip"
                          style={{ color: severityColor(b.severity), borderColor: severityColor(b.severity) }}
                        >
                          {SEVERITY_LABEL[b.severity]}
                        </span>
                        <span className="font-medium">{def?.name ?? b.kriCode}</span>
                        <span className="cs-label">{b.siteId}</span>
                        {def && (
                          <span className="cs-chip" style={{ color: riskTierColor(def.riskTier) }}>
                            {RISK_TIER_LABEL[def.riskTier]}
                          </span>
                        )}
                      </div>
                      <div className="text-sm" style={{ color: "var(--cs-dim)" }}>
                        观测值 <span className="cs-mono">{pct(b.observedValue)}</span> 越过
                        {SEVERITY_LABEL[b.thresholdLevel]}阈值{" "}
                        <span className="cs-mono">{pct(b.thresholdValue)}</span>
                        {" · "}
                        {new Date(b.detectedAt).toLocaleString("zh-CN")}
                      </div>
                      <div className="text-xs cs-mono" style={{ color: "var(--cs-dim)" }}>
                        存证 {b.attestationTxHash || "—"}
                        {local && " （本地回执 · 链降级）"}
                        {b.attestationBlock ? ` · block ${b.attestationBlock}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span
                        className="cs-chip"
                        style={{ color: b.status === "open" ? "var(--cs-amber)" : "var(--cs-dim)" }}
                      >
                        {b.status === "open" ? "开放" : b.status === "acknowledged" ? "已确认" : "已解决"}
                      </span>
                      {b.status === "open" && (
                        <button
                          className="cs-btn cs-btn-ghost"
                          disabled={acknowledge.isPending}
                          onClick={() => acknowledge.mutate(b.id)}
                        >
                          确认
                        </button>
                      )}
                      {acknowledge.isError && acknowledge.variables === b.id && (
                        <span className="text-xs" style={{ color: "var(--cs-red)" }}>
                          确认失败，请重试
                        </span>
                      )}
                    </div>
                  </div>
                </Panel>
              );
            })}
          </div>
        </section>

        {/* KRI 定义 */}
        <section className="flex flex-col gap-3">
          <div className="cs-label">KRI 定义 · 分类分层与 QTL 阈值</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {defs.map((d) => (
              <Panel key={d.id} className="px-5 py-4 flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{d.name}</span>
                  <span className="cs-chip" style={{ color: riskTierColor(d.riskTier) }}>
                    {RISK_TIER_LABEL[d.riskTier]}
                  </span>
                  <span className="cs-label">{d.category}</span>
                </div>
                <div className="text-sm" style={{ color: "var(--cs-dim)" }}>{d.description}</div>
                <div className="flex items-center gap-3 text-xs cs-mono" style={{ color: "var(--cs-dim)" }}>
                  <span>{d.direction === "higher_worse" ? "越高越差" : "越低越差"}</span>
                  {(d.thresholds ?? []).map((t) => (
                    <span key={t.level} style={{ color: severityColor(t.level) }}>
                      {SEVERITY_LABEL[t.level]} {t.op === "gte" ? "≥" : "≤"} {pct(t.value)}
                    </span>
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
