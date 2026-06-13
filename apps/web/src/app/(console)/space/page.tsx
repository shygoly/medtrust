import Link from "next/link";
import { ArrowUpRight, ShieldOff } from "lucide-react";
import { PageHeader, Panel, Stat, TaskStatusBadge } from "@/components/console/ui";
import { Topology } from "@/components/console/topology";
import { connectors, tasks, attestations, spaceStats } from "@/lib/space-mock";

export default function OverviewPage() {
  return (
    <div>
      <PageHeader
        kicker="OVERVIEW · 空间总览"
        title="医疗可信数据空间"
        desc="数据留在各参与方本地,可用不可见;只有经输出闸门的聚合结果会流向中心,全程上链存证。"
      />

      <div className="p-8 space-y-6">
        {/* stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="cs-reveal" style={{ animationDelay: "0ms" }}>
            <Stat label="参与方" value={spaceStats.participants} unit="个连接器" />
          </div>
          <div className="cs-reveal" style={{ animationDelay: "60ms" }}>
            <Stat label="在线" value={spaceStats.online} accent="green" />
          </div>
          <div className="cs-reveal" style={{ animationDelay: "120ms" }}>
            <Stat label="本地数据" value="434k" unit="行 · 留在院内" />
          </div>
          <div className="cs-reveal" style={{ animationDelay: "180ms" }}>
            <Stat label="活跃任务" value={spaceStats.activeTasks} accent="cyan" />
          </div>
          <div className="cs-reveal" style={{ animationDelay: "240ms" }}>
            <Stat label="上链存证" value={spaceStats.attestations} accent="green" />
          </div>
          <div className="cs-reveal" style={{ animationDelay: "300ms" }}>
            <Stat label="原始数据出域" value={spaceStats.rawDataEgress} unit="行" accent="green" />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* topology — the showpiece */}
          <Panel ticks className="xl:col-span-2 p-6 cs-reveal" style={{ animationDelay: "200ms" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="cs-label">TOPOLOGY · 数据流向</div>
              <div className="cs-chip">
                <span className="cs-dot cs-dot-on" /> 数据不出域 · 仅聚合流通
              </div>
            </div>
            <Topology />
          </Panel>

          {/* connector strip */}
          <Panel className="p-6 cs-reveal" style={{ animationDelay: "300ms" }}>
            <div className="cs-label mb-4">CONNECTORS · 连接器状态</div>
            <div className="space-y-3">
              {connectors.map((c) => (
                <div key={c.id} className="flex items-center gap-3">
                  <span
                    className={`cs-dot ${c.status === "online" ? "cs-dot-on" : c.status === "idle" ? "cs-dot-idle" : "cs-dot-off"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{c.org}</div>
                    <div className="cs-mono text-[0.68rem]" style={{ color: "var(--cs-faint)" }}>
                      {c.role === "provider" ? "数据提供方" : "数据使用方"} · {c.lastSeen}
                    </div>
                  </div>
                  <span className="cs-mono text-xs tabular-nums" style={{ color: "var(--cs-dim)" }}>
                    {c.recordCount ? `${(c.recordCount / 1000).toFixed(0)}k` : "—"}
                  </span>
                </div>
              ))}
            </div>
            <Link
              href="/space/connectors"
              className="cs-navlink mt-4 justify-center"
              style={{ borderColor: "var(--cs-line)" }}
            >
              查看全部连接器 <ArrowUpRight size={14} />
            </Link>
          </Panel>
        </div>

        {/* active tasks + attestations */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Panel className="cs-reveal" style={{ animationDelay: "360ms" }}>
            <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--cs-line)" }}>
              <div className="cs-label">RWS TASKS · 最新任务</div>
              <Link href="/space/tasks" className="text-xs" style={{ color: "var(--cs-cyan)" }}>
                全部 →
              </Link>
            </div>
            <div>
              {tasks.slice(0, 4).map((t) => (
                <Link
                  key={t.id}
                  href={`/space/tasks/${t.id}`}
                  className="cs-row flex items-center gap-3 px-6 py-3.5"
                >
                  {t.status === "blocked" && <ShieldOff size={14} style={{ color: "var(--cs-red)" }} />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{t.title}</div>
                    <div className="cs-mono text-[0.68rem]" style={{ color: "var(--cs-faint)" }}>
                      {t.id} · {t.initiator}
                    </div>
                  </div>
                  <TaskStatusBadge status={t.status} />
                </Link>
              ))}
            </div>
          </Panel>

          <Panel className="cs-reveal" style={{ animationDelay: "420ms" }}>
            <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--cs-line)" }}>
              <div className="cs-label">ATTESTATIONS · 上链存证</div>
              <Link href="/space/attestations" className="text-xs" style={{ color: "var(--cs-cyan)" }}>
                全部 →
              </Link>
            </div>
            <div>
              {attestations.map((a) => (
                <div key={a.id} className="cs-row flex items-center gap-3 px-6 py-3.5">
                  <span className="cs-dot cs-dot-on" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{a.taskTitle}</div>
                    <div className="cs-mono text-[0.68rem]" style={{ color: "var(--cs-faint)" }}>
                      {a.txHash} · #{a.block.toLocaleString()}
                    </div>
                  </div>
                  <span className="cs-mono text-[0.68rem]" style={{ color: "var(--cs-dim)" }}>{a.at.slice(5)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
