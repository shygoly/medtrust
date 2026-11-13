// 空间总览的显示模型：只由真实接口的返回值算出，不含任何演示数字。
// 某个数据源读取失败时，对应指标为 null（界面显示「—」），不以 0 冒充。

import {
  EMPTY_MARK,
  formatDateTime,
  toAttestationRows,
  type AttestationLedgerRecord,
  type AttestationRow,
} from "./attestations";
import { participantLabel } from "./federated-tasks";
import { mapOrchestrationStatus } from "./orchestration-workloads";
import { mdopBadge as browseMdopBadge } from "./task-list";

export interface OverviewConnectorRecord {
  id: string;
  participantId: string;
  healthStatus: string;
  lastSeen?: string;
  lastHeartbeat?: { version?: string } | null;
}

interface OrchestrationTaskRecord {
  taskId: string;
  title: string;
  status: string;
  consumerId?: string;
  createdAt: string;
}

interface SecretFlowTaskRecord {
  taskId: string;
  state: string;
  purpose?: string;
  createdAt?: string;
  consumerId?: string;
}

interface MdopJobRecord {
  id: string;
  purpose?: string;
  status?: string;
  createdAt?: string;
  rejectReason?: string | null;
}

/** 各接口的返回值；`undefined` 表示该接口读取失败（不是「没有数据」）。 */
export interface OverviewSources {
  connectors?: OverviewConnectorRecord[];
  products?: unknown[];
  contracts?: Array<{ status?: string }>;
  rws?: OrchestrationTaskRecord[];
  fl?: OrchestrationTaskRecord[];
  secretflow?: SecretFlowTaskRecord[];
  mdopJobs?: MdopJobRecord[];
  attestations?: AttestationLedgerRecord[];
}

export type OverviewTaskBadge = "completed" | "running" | "failed" | "cancelled";

export interface OverviewTask {
  key: string;
  id: string;
  title: string;
  kindLabel: string;
  /** 与任务列表同一四态闭集；未知时为 null，界面原样显示 `statusText`。 */
  badge: OverviewTaskBadge | null;
  statusText: string;
  initiator: string;
  createdAt: string;
  href: string;
}

export interface OverviewConnector {
  id: string;
  participantId: string;
  name: string;
  state: "online" | "offline" | "unknown";
  stateLabel: string;
  lastSeen: string;
  version: string;
}

export interface SpaceOverview {
  stats: {
    connectors: number | null;
    online: number | null;
    products: number | null;
    activeContracts: number | null;
    activeTasks: number | null;
    attestations: number | null;
  };
  connectors: OverviewConnector[];
  tasks: OverviewTask[];
  attestations: AttestationRow[];
  /** 读取失败的数据源名称（界面据此提示，避免把缺数当成零）。 */
  unavailable: string[];
}

const LATEST = 4;

const CONNECTOR_STATE_LABEL: Record<OverviewConnector["state"], string> = {
  online: "在线",
  offline: "离线",
  unknown: "未上报",
};

function collectTasks(sources: OverviewSources): OverviewTask[] {
  const out: OverviewTask[] = [];
  for (const t of sources.rws ?? []) {
    out.push({
      key: `rws-${t.taskId}`,
      id: t.taskId,
      title: t.title,
      kindLabel: "RWS",
      badge: mapOrchestrationStatus(t.status),
      statusText: t.status,
      initiator: t.consumerId ?? EMPTY_MARK,
      createdAt: t.createdAt,
      href: `/space/tasks/${t.taskId}?workload=rws`,
    });
  }
  for (const t of sources.fl ?? []) {
    out.push({
      key: `fl-${t.taskId}`,
      id: t.taskId,
      title: t.title,
      kindLabel: "L4 FL",
      badge: mapOrchestrationStatus(t.status),
      statusText: t.status,
      initiator: t.consumerId ?? EMPTY_MARK,
      createdAt: t.createdAt,
      href: `/space/tasks/${t.taskId}?workload=fl_prediction`,
    });
  }
  for (const t of sources.secretflow ?? []) {
    out.push({
      key: `sf-${t.taskId}`,
      id: t.taskId,
      title: t.purpose ? `SecretFlow · ${t.purpose}` : `SecretFlow · ${t.taskId}`,
      kindLabel: "SF",
      badge: mapOrchestrationStatus(t.state),
      statusText: t.state,
      initiator: t.consumerId ?? EMPTY_MARK,
      createdAt: t.createdAt ?? "",
      href: `/space/federated/${encodeURIComponent(t.taskId)}`,
    });
  }
  for (const j of sources.mdopJobs ?? []) {
    const status = j.status ?? "";
    out.push({
      key: `mdop-${j.id}`,
      id: j.id,
      title: j.purpose ? `MDOP · ${j.purpose}` : `MDOP · ${j.id}`,
      kindLabel: "MDOP",
      badge: status
        ? browseMdopBadge(status, { rejectReason: j.rejectReason })
        : null,
      statusText: status || EMPTY_MARK,
      initiator: EMPTY_MARK,
      createdAt: j.createdAt ?? "",
      href: `/space/mdop/jobs/${encodeURIComponent(j.id)}`,
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function buildSpaceOverview(sources: OverviewSources, timeZone?: string): SpaceOverview {
  const unavailable: string[] = [];
  const missing = (value: unknown, label: string) => {
    if (value === undefined) unavailable.push(label);
  };
  missing(sources.connectors, "连接器状态");
  missing(sources.products, "数据产品目录");
  missing(sources.contracts, "数字合约");
  missing(sources.rws, "RWS 任务");
  missing(sources.fl, "联邦预测任务");
  missing(sources.secretflow, "SecretFlow 任务");
  missing(sources.mdopJobs, "MDOP 作业");
  missing(sources.attestations, "存证账本");

  const connectors: OverviewConnector[] = (sources.connectors ?? []).map((c) => {
    const state: OverviewConnector["state"] =
      c.healthStatus === "online" ? "online" : c.healthStatus === "offline" ? "offline" : "unknown";
    return {
      id: c.id,
      participantId: c.participantId,
      name: participantLabel(c.participantId),
      state,
      stateLabel: CONNECTOR_STATE_LABEL[state],
      lastSeen: formatDateTime(c.lastSeen, timeZone),
      version: c.lastHeartbeat?.version ?? EMPTY_MARK,
    };
  });

  const tasks = collectTasks(sources);
  const allTaskSourcesLoaded =
    sources.rws !== undefined &&
    sources.fl !== undefined &&
    sources.secretflow !== undefined &&
    sources.mdopJobs !== undefined;

  const attestations = [...(sources.attestations ?? [])].sort((a, b) =>
    b.anchoredAt.localeCompare(a.anchoredAt),
  );

  return {
    stats: {
      connectors: sources.connectors ? connectors.length : null,
      online: sources.connectors ? connectors.filter((c) => c.state === "online").length : null,
      products: sources.products ? sources.products.length : null,
      activeContracts: sources.contracts
        ? sources.contracts.filter((c) => c.status === "active").length
        : null,
      activeTasks: allTaskSourcesLoaded ? tasks.filter((t) => t.badge === "running").length : null,
      attestations: sources.attestations ? sources.attestations.length : null,
    },
    connectors,
    tasks: tasks.slice(0, LATEST),
    attestations: toAttestationRows(attestations.slice(0, LATEST), timeZone),
    unavailable,
  };
}
