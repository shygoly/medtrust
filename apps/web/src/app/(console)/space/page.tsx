"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ShieldOff } from "lucide-react";
import { PageHeader, Panel, Stat, TaskStatusBadge } from "@/components/console/ui";
import { AsyncBoundary } from "@/components/console/data";
import { WorkbenchPanel } from "@/components/console/workbench-panel";
import { NotificationsPanel } from "@/components/console/notifications-panel";
import { Topology, TOPOLOGY_PROVIDER_SLOTS } from "@/components/console/topology";
import { api } from "@/api/client";
import { EMPTY_MARK } from "@/lib/attestations";
import { buildSpaceOverview, type OverviewConnector } from "@/lib/space-overview";

/** 单个数据源读失败不拖垮整页：返回 undefined，由显示模型如实标成「未知」。 */
async function settle<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

const connectorDot: Record<OverviewConnector["state"], string> = {
  online: "cs-dot-on",
  offline: "cs-dot-off",
  unknown: "cs-dot-off",
};

const stat = (value: number | null | undefined) => value ?? EMPTY_MARK;

export default function OverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["space-overview"],
    queryFn: async () => {
      const [connectors, products, contracts, rws, fl, secretflow, mdopJobs, attestations] =
        await Promise.all([
          settle(() => api.listConnectorStatus()),
          settle(() => api.getDataAssets()),
          settle(() => api.listContracts()),
          settle(() => api.listRwsTasks()),
          settle(() => api.listFlPredictionTasks()),
          settle(() => api.listSecretFlowTasks()),
          settle(() => api.listMdopJobs()),
          settle(() => api.listAttestations()),
        ]);
      return buildSpaceOverview({
        connectors,
        products,
        contracts,
        rws,
        fl,
        secretflow,
        mdopJobs,
        attestations,
      });
    },
    refetchInterval: 15000,
  });

  const stats = data?.stats;
  const connectors = data?.connectors ?? [];
  const connectorsFailed = !!data && data.stats.connectors === null;
  const hiddenConnectors = Math.max(0, connectors.length - TOPOLOGY_PROVIDER_SLOTS);

  return (
    <div>
      <PageHeader
        kicker="OVERVIEW · 空间总览"
        desc="数据留在各参与方本地,可用不可见;只有经输出闸门的聚合结果会流向中心,全程上链存证。"
      />

      <div className="p-8 space-y-6">
        <WorkbenchPanel />
        <NotificationsPanel />
        <AsyncBoundary loading={isLoading} loadingText="正在读取空间状态…">
          {data && data.unavailable.length > 0 && (
            <Panel className="px-5 py-3 text-sm" style={{ color: "var(--cs-red)" }}>
              部分数据读取失败：{data.unavailable.join("、")}。对应指标显示为「{EMPTY_MARK}」。
            </Panel>
          )}

          {/* stats — 全部由接口返回值计数 */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="cs-reveal" style={{ animationDelay: "0ms" }}>
              <Stat label="连接器" value={stat(stats?.connectors)} unit="个已注册" />
            </div>
            <div className="cs-reveal" style={{ animationDelay: "60ms" }}>
              <Stat label="在线" value={stat(stats?.online)} accent="green" />
            </div>
            <div className="cs-reveal" style={{ animationDelay: "120ms" }}>
              <Stat label="数据产品" value={stat(stats?.products)} unit="个" />
            </div>
            <div className="cs-reveal" style={{ animationDelay: "180ms" }}>
              <Stat label="生效合约" value={stat(stats?.activeContracts)} />
            </div>
            <div className="cs-reveal" style={{ animationDelay: "240ms" }}>
              <Stat label="活跃任务" value={stat(stats?.activeTasks)} accent="cyan" />
            </div>
            <div className="cs-reveal" style={{ animationDelay: "300ms" }}>
              <Stat label="上链存证" value={stat(stats?.attestations)} accent="green" />
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
              <AsyncBoundary
                variant="bare"
                error={connectorsFailed}
                errorText="连接器状态读取失败，无法绘制拓扑。"
                empty={connectors.length === 0}
                emptyText="暂无已注册连接器。"
              >
                <Topology
                  providers={connectors.map((c) => ({
                    name: c.name,
                    note: c.stateLabel,
                    state: c.state === "online" ? "run" : "idle",
                  }))}
                />
                {hiddenConnectors > 0 && (
                  <div className="cs-label mt-2">
                    图中显示前 {TOPOLOGY_PROVIDER_SLOTS} 个连接器，另有 {hiddenConnectors} 个见右侧列表
                  </div>
                )}
              </AsyncBoundary>
            </Panel>

            {/* connector strip */}
            <Panel className="p-6 cs-reveal" style={{ animationDelay: "300ms" }}>
              <div className="cs-label mb-4">CONNECTORS · 连接器状态</div>
              <AsyncBoundary
                variant="bare"
                error={connectorsFailed}
                errorText="连接器状态读取失败。"
                empty={connectors.length === 0}
                emptyText="暂无已注册连接器。"
              >
                <div className="space-y-3">
                  {connectors.map((c) => (
                    <div key={c.id} className="flex items-center gap-3">
                      <span className={`cs-dot ${connectorDot[c.state]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{c.name}</div>
                        <div className="cs-mono text-[0.68rem] truncate" style={{ color: "var(--cs-faint)" }}>
                          {c.stateLabel} · 最近心跳 {c.lastSeen}
                        </div>
                      </div>
                      <span className="cs-mono text-xs tabular-nums" style={{ color: "var(--cs-dim)" }}>
                        {c.version}
                      </span>
                    </div>
                  ))}
                </div>
              </AsyncBoundary>
              <Link
                href="/space/connectors"
                className="cs-navlink mt-4 justify-center"
                style={{ borderColor: "var(--cs-line)" }}
              >
                查看本院连接器 <ArrowUpRight size={14} />
              </Link>
            </Panel>
          </div>

          {/* latest tasks + attestations */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Panel className="cs-reveal" style={{ animationDelay: "360ms" }}>
              <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--cs-line)" }}>
                <div className="cs-label">TASKS · 最新任务</div>
                <Link href="/space/tasks" className="text-xs" style={{ color: "var(--cs-cyan)" }}>
                  全部 →
                </Link>
              </div>
              <AsyncBoundary variant="bare" empty={!data || data.tasks.length === 0} emptyText="暂无任务。">
                {data?.tasks.map((t) => (
                  <Link key={t.key} href={t.href} className="cs-row flex items-center gap-3 px-6 py-3.5">
                    {t.badge === "failed" && <ShieldOff size={14} style={{ color: "var(--cs-red)" }} />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{t.title}</div>
                      <div className="cs-mono text-[0.68rem] truncate" style={{ color: "var(--cs-faint)" }}>
                        {t.kindLabel} · {t.id} · {t.initiator}
                      </div>
                    </div>
                    {t.badge ? (
                      <TaskStatusBadge status={t.badge} />
                    ) : (
                      <span className="cs-chip">{t.statusText}</span>
                    )}
                  </Link>
                ))}
              </AsyncBoundary>
            </Panel>

            <Panel className="cs-reveal" style={{ animationDelay: "420ms" }}>
              <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--cs-line)" }}>
                <div className="cs-label">ATTESTATIONS · 上链存证</div>
                <Link href="/space/attestations" className="text-xs" style={{ color: "var(--cs-cyan)" }}>
                  全部 →
                </Link>
              </div>
              <AsyncBoundary
                variant="bare"
                error={!!data && data.stats.attestations === null}
                errorText="存证账本读取失败。"
                empty={!data || data.attestations.length === 0}
                emptyText="暂无链上存证记录。"
              >
                {data?.attestations.map((a) => (
                  <div key={a.id} className="cs-row flex items-center gap-3 px-6 py-3.5">
                    <span className="cs-dot cs-dot-on" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        {a.kindLabel} · {a.subjectLabel}
                      </div>
                      <div className="cs-mono text-[0.68rem] truncate" style={{ color: "var(--cs-faint)" }} title={a.txHash}>
                        tx · {a.txShort} · {a.block}
                      </div>
                    </div>
                    <span className="cs-mono text-[0.68rem] tabular-nums" style={{ color: "var(--cs-dim)" }}>
                      {a.time}
                    </span>
                  </div>
                ))}
              </AsyncBoundary>
            </Panel>
          </div>
        </AsyncBoundary>
      </div>
    </div>
  );
}
