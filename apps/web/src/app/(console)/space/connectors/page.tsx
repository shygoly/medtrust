"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Lock } from "lucide-react";
import { PageHeader, Panel, Stat } from "@/components/console/ui";
import { RoleGate } from "@/components/console/role-gate";
import { PublishProductButton } from "@/components/console/publish-product-button";
import { api, type ProviderInboxItem } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { participantLabel } from "@/lib/federated-tasks";
import { taskListHref } from "@/lib/task-list";

type NodeVisual = {
  label: string;
  dot: string;
  accent: "cyan" | "green" | "amber" | "red";
};

function deriveNodeVisual(
  healthStatus: string | undefined,
  inbox: ProviderInboxItem[],
  heartbeat?: { version?: string } | null,
): NodeVisual {
  if (healthStatus === "offline") {
    return { label: "离线", dot: "cs-dot-block", accent: "red" };
  }
  if (healthStatus === "unknown" || !healthStatus) {
    return { label: "未知", dot: "cs-dot-idle", accent: "amber" };
  }
  // online：任务态叠加展示，便于院方看见执行中/待拉取。
  if (inbox.some((i) => i.status === "running")) {
    return { label: "运行中", dot: "cs-dot-run", accent: "cyan" };
  }
  if (inbox.some((i) => i.status === "pending")) {
    return { label: "待执行", dot: "cs-dot-idle", accent: "amber" };
  }
  if (inbox.some((i) => i.status === "failed")) {
    return { label: "有失败", dot: "cs-dot-block", accent: "red" };
  }
  const ver = heartbeat?.version ? ` · v${heartbeat.version}` : "";
  return { label: `在线${ver}`, dot: "cs-dot-on", accent: "green" };
}

export default function ConnectorsPage() {
  const { user, ready } = useAuth();
  const isProvider = user?.role === "provider";
  const participantId = user?.participantId;

  const inboxQuery = useQuery({
    queryKey: ["connector-inbox", participantId],
    enabled: ready && isProvider && !!participantId,
    queryFn: async () => {
      const [rws, fl] = await Promise.all([api.listRwsInbox(), api.listFlInbox()]);
      return [...rws, ...fl].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    refetchInterval: 8_000,
  });

  // P1-9:真实心跳状态(停连接器约 1min 内标离线)。
  const statusQuery = useQuery({
    queryKey: ["connector-status", participantId],
    enabled: ready && isProvider && !!participantId,
    queryFn: () => api.listConnectorStatus(),
    refetchInterval: 15_000,
  });

  const catalogQuery = useQuery({
    queryKey: ["catalog"],
    enabled: ready && isProvider,
    queryFn: () => api.getDataAssets(),
  });

  const contractsQuery = useQuery({
    queryKey: ["contracts"],
    enabled: ready && isProvider,
    queryFn: () => api.listContracts(),
  });

  const inbox = inboxQuery.data ?? [];
  const myStatus = (statusQuery.data ?? []).find(
    (row) => row.participantId === participantId,
  );
  const node = deriveNodeVisual(
    myStatus?.healthStatus,
    inbox,
    myStatus?.lastHeartbeat,
  );

  const myProducts = useMemo(() => {
    if (!participantId) return [];
    return (catalogQuery.data ?? []).filter(
      (p) => (p as { providerId?: string }).providerId === participantId,
    );
  }, [catalogQuery.data, participantId]);

  const activeContracts = useMemo(() => {
    if (!participantId) return 0;
    return (contractsQuery.data ?? []).filter((c) => {
      const row = c as { providerId?: string; status?: string };
      return row.providerId === participantId && row.status === "active";
    }).length;
  }, [contractsQuery.data, participantId]);

  const pendingCount = inbox.filter((i) => i.status === "pending").length;
  const runningCount = inbox.filter((i) => i.status === "running").length;

  return (
    <div>
      <PageHeader
        kicker="CONNECTOR · 本院连接器"
        desc="仅展示本机构连接器及其收到的任务分派。入网申请和合约确认在连接器本机页面完成（默认 http://localhost:5022/local）。本页用于监视状态与本院回传摘要。"
        action={
          <RoleGate roles={["provider"]}>
            <PublishProductButton />
          </RoleGate>
        }
      />

      {!ready ? null : !isProvider ? (
        <div className="p-8">
          <Panel className="px-6 py-5">
            <div className="text-sm" style={{ color: "var(--cs-dim)" }}>
              连接器视图面向<strong style={{ color: "var(--cs-text)" }}>数据提供方（医院）</strong>
              。请使用医院账号登录以查看本院节点与收到的任务队列。
            </div>
          </Panel>
        </div>
      ) : (
        <div className="p-8 flex flex-col gap-6">
          <Panel className="px-6 py-5" ticks>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="cs-label">LOCAL NODE · 本院节点</div>
                <div className="text-xl font-semibold mt-1.5 tracking-tight">
                  {participantId ? participantLabel(participantId) : "—"}
                </div>
                <div className="cs-mono text-[0.72rem] mt-1" style={{ color: "var(--cs-faint)" }}>
                  {participantId ?? "—"}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <span className="cs-chip">
                    <span className={`cs-dot ${node.dot}`} />
                    {node.label}
                  </span>
                  <span
                    className="cs-chip"
                    style={{ color: "var(--cs-green)", borderColor: "var(--cs-green)" }}
                  >
                    <Lock size={11} /> 原始数据驻留本院
                  </span>
                </div>
              </div>
              <div className="text-sm max-w-md" style={{ color: "var(--cs-dim)" }}>
                使用方基于已生效合约发起任务后，本院 worker 自动拉取执行；PEP
                与输出闸门在本地强制合约约束。院方授权发生在合约签发，而非逐任务确认。
              </div>
            </div>
          </Panel>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="驻留数据产品" value={myProducts.length} unit="个" accent="cyan" />
            <Stat label="生效合约" value={activeContracts} unit="份" accent="green" />
            <Stat label="待拉取" value={pendingCount} unit="个" accent="amber" />
            <Stat label="执行中" value={runningCount} unit="个" accent={runningCount ? "cyan" : undefined} />
          </div>

          <Panel className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="cs-label">INBOUND · 分派给本院的任务</div>
              <div className="text-sm mt-1" style={{ color: "var(--cs-dim)" }}>
                共 {inbox.length} 个，其中待拉取 {pendingCount}、执行中 {runningCount}。任务由 worker 自动拉取，逐项进度在任务列表查看。
              </div>
            </div>
            <Link href={taskListHref({ role: "provider" })} className="cs-btn cs-btn-ghost">
              查看分派给本院的任务 <ArrowUpRight size={14} />
            </Link>
          </Panel>
        </div>
      )}
    </div>
  );
}
