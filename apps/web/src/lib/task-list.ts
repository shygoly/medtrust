// 统一任务列表的行模型与分面（ia-task-surface）。
//
// 后端目前有三条并行编排（RWS / L4 联邦预测 / SecretFlow）加 MDOP 作业内核，提供方另有入站分派。
// 这里把五个来源各用一个适配函数映射成同一行模型——纯函数、逐来源独立：
// MDOP 二期下线某条旧编排时，删掉对应的适配函数与来源字段即可。

import type { FlPredictionOrchestrationRecord, ProviderInboxItem, RwsOrchestrationRecord } from "../api/client";
import { federatedStateLabel, type SecretFlowTaskSummary } from "./federated-tasks";
import { mapOrchestrationStatus, workloadMeta, type OrchestrationWorkloadKind } from "./orchestration-workloads";

export type TaskChannel = OrchestrationWorkloadKind | "mdop";
export type TaskBadge = "running" | "completed" | "blocked";
/** 我方在该任务中的角色：我方发起，或分派给本院执行。旁观（运营/合规）为空。 */
export type TaskRole = "initiator" | "provider";

export interface TaskRow {
  channel: TaskChannel;
  taskId: string;
  title: string;
  purpose: string;
  /** 归一后的状态，用于徽标与状态分面。 */
  badge: TaskBadge;
  /** 该通道自己的状态词（各通道词汇不同，只用于展示）。 */
  statusLabel: string;
  consumerId: string;
  createdAt: string;
  providerCount: number;
  summary?: string;
  myRole?: TaskRole;
  href: string;
}

export interface MdopJobSummary {
  id: string;
  purpose?: string;
  status?: string;
  createdAt?: string;
}

/** 各来源的返回值；`undefined` = 该来源未请求或读取失败（不是「没有数据」）。 */
export interface TaskSources {
  rws?: RwsOrchestrationRecord[];
  fl?: FlPredictionOrchestrationRecord[];
  secretflow?: SecretFlowTaskSummary[];
  mdopJobs?: MdopJobSummary[];
  /** 仅提供方：分派给本院的入站任务。 */
  inbox?: ProviderInboxItem[];
}

export const CHANNEL_OPTIONS: Array<{ value: TaskChannel; label: string }> = [
  { value: "rws", label: "RWS" },
  { value: "fl_prediction", label: "L4 联邦预测" },
  { value: "secretflow", label: "SecretFlow" },
  { value: "mdop", label: "MDOP" },
];
export const STATUS_OPTIONS: Array<{ value: TaskBadge; label: string }> = [
  { value: "running", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "blocked", label: "受阻" },
];
export const ROLE_OPTIONS: Array<{ value: TaskRole; label: string }> = [
  { value: "initiator", label: "我发起的" },
  { value: "provider", label: "分派给本院" },
];

export function channelLabel(channel: TaskChannel): string {
  return channel === "mdop" ? "MDOP" : workloadMeta(channel).shortLabel;
}

const assignmentStatusLabel: Record<string, string> = {
  pending: "待拉取",
  running: "执行中",
  completed: "已回传",
  failed: "失败",
};

const initiatorRole = (consumerId: string | undefined, me?: string): TaskRole | undefined =>
  me && consumerId === me ? "initiator" : undefined;

function fromRws(t: RwsOrchestrationRecord, me?: string): TaskRow {
  return {
    channel: "rws",
    taskId: t.taskId,
    title: t.title,
    purpose: t.purpose,
    badge: mapOrchestrationStatus(t.status),
    statusLabel: t.status,
    consumerId: t.consumerId,
    createdAt: t.createdAt,
    providerCount: t.assignments.length,
    summary: t.merged ? `合并队列 n=${t.merged.cohortSize}` : `${t.analysis.type}`,
    myRole: initiatorRole(t.consumerId, me),
    href: `/space/tasks/${t.taskId}?workload=rws`,
  };
}

function fromFlPrediction(t: FlPredictionOrchestrationRecord, me?: string): TaskRow {
  return {
    channel: "fl_prediction",
    taskId: t.taskId,
    title: t.title,
    purpose: t.purpose,
    badge: mapOrchestrationStatus(t.status),
    statusLabel: t.status,
    consumerId: t.consumerId,
    createdAt: t.createdAt,
    providerCount: t.assignments.length,
    summary: t.resultSummary?.auc
      ? `AUC ${t.resultSummary.auc} · ${t.flPredictionSpec.modelType}`
      : `${t.flPredictionSpec.modelType} → ${t.flPredictionSpec.targetColumn}`,
    myRole: initiatorRole(t.consumerId, me),
    href: `/space/tasks/${t.taskId}?workload=fl_prediction`,
  };
}

function secretFlowSummary(t: SecretFlowTaskSummary): string {
  if (t.state === "COMPLETED") return "LoRA 联邦微调已完成";
  const parts: string[] = [];
  if (t.currentEpoch != null) parts.push(`epoch ${t.currentEpoch}`);
  if (t.lastLoss != null) parts.push(`loss ${t.lastLoss.toFixed(0)}`);
  return parts.length ? parts.join(" · ") : federatedStateLabel(t.state);
}

function fromSecretFlow(t: SecretFlowTaskSummary, me?: string): TaskRow {
  return {
    channel: "secretflow",
    taskId: t.taskId,
    title: t.purpose ? `SecretFlow · ${t.purpose}` : `SecretFlow · ${t.taskId}`,
    purpose: t.purpose ?? "联邦密算",
    badge: mapOrchestrationStatus(t.state),
    statusLabel: federatedStateLabel(t.state),
    consumerId: t.consumerId ?? "—",
    createdAt: t.createdAt ?? "",
    providerCount: t.providerCount ?? 0,
    summary: secretFlowSummary(t),
    myRole: initiatorRole(t.consumerId, me),
    href: `/space/federated/${encodeURIComponent(t.taskId)}`,
  };
}

/** MDOP 作业的状态词未与旧编排对齐：终态成功/失败之外一律算进行中。 */
function mdopBadge(status: string | undefined): TaskBadge {
  const s = (status ?? "").toLowerCase();
  if (/^(completed|merged|published|succeeded|done|closed)$/.test(s)) return "completed";
  if (/^(failed|rejected|refused|aborted|cancelled|expired|partial)$/.test(s)) return "blocked";
  return "running";
}

function fromMdopJob(job: MdopJobSummary): TaskRow {
  return {
    channel: "mdop",
    taskId: job.id,
    title: job.purpose ? `MDOP · ${job.purpose}` : `MDOP 作业 ${job.id}`,
    purpose: job.purpose ?? "MDOP 作业",
    badge: mdopBadge(job.status),
    statusLabel: job.status ?? "—",
    consumerId: "—",
    createdAt: job.createdAt ?? "",
    providerCount: 0,
    summary: "作业内核：各院本地复核并签名 → 平台签发执行凭证 → 执行 → 平台合并",
    href: `/space/mdop/jobs/${encodeURIComponent(job.id)}`,
  };
}

function fromInbox(item: ProviderInboxItem): TaskRow {
  const progress = item.latestProgress?.stage
    ? `${item.latestProgress.stage}${item.latestProgress.detail ? ` · ${item.latestProgress.detail}` : ""}`
    : undefined;
  return {
    channel: item.kind,
    taskId: item.taskId,
    title: item.title || item.purpose,
    purpose: item.purpose,
    badge: item.status === "completed" ? "completed" : item.status === "failed" ? "blocked" : "running",
    statusLabel: assignmentStatusLabel[item.status] ?? item.status,
    consumerId: item.consumerId,
    createdAt: item.createdAt,
    providerCount: 0,
    summary: item.error ?? progress ?? item.resultHint ?? item.workloadLabel,
    myRole: "provider",
    href: `/space/tasks/${item.taskId}?workload=${item.kind}`,
  };
}

/**
 * 五个来源 → 同一行模型，按创建时间倒序。
 * 同一任务既在入站分派又在任务列表里时，以入站行为准（它是本院视角：本院的执行状态与进度）。
 */
export function toTaskRows(sources: TaskSources, me?: { participantId?: string }): TaskRow[] {
  const mine = me?.participantId;
  const inbox = (sources.inbox ?? []).map(fromInbox);
  const inboxKeys = new Set(inbox.map((r) => `${r.channel}:${r.taskId}`));
  const rest = [
    ...(sources.rws ?? []).map((t) => fromRws(t, mine)),
    ...(sources.fl ?? []).map((t) => fromFlPrediction(t, mine)),
    ...(sources.secretflow ?? []).map((t) => fromSecretFlow(t, mine)),
    ...(sources.mdopJobs ?? []).map(fromMdopJob),
  ].filter((r) => !inboxKeys.has(`${r.channel}:${r.taskId}`));
  return [...inbox, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 任务 ID → 详情地址。账本（结算、存证）里只有任务 ID，不知道它属于哪个通道，靠这个反查。 */
export function taskHrefIndex(rows: TaskRow[]): Map<string, string> {
  return new Map(rows.map((r) => [r.taskId, r.href]));
}

export interface TaskFacets {
  channel?: TaskChannel;
  status?: TaskBadge;
  role?: TaskRole;
}

const pick = <T extends string>(options: Array<{ value: T }>, raw: string | null): T | undefined =>
  options.find((o) => o.value === raw)?.value;

/** 从地址查询串读分面；不在闭集内的取值一律忽略。 */
export function parseTaskFacets(params: { get(name: string): string | null }): TaskFacets {
  return {
    channel: pick(CHANNEL_OPTIONS, params.get("channel")),
    status: pick(STATUS_OPTIONS, params.get("status")),
    role: pick(ROLE_OPTIONS, params.get("role")),
  };
}

export function filterTaskRows(rows: TaskRow[], facets: TaskFacets): TaskRow[] {
  return rows.filter(
    (r) =>
      (!facets.channel || r.channel === facets.channel) &&
      (!facets.status || r.badge === facets.status) &&
      (!facets.role || r.myRole === facets.role),
  );
}

/** 带分面的任务列表地址（参数顺序固定，便于分享与比对）。 */
export function taskListHref(facets: TaskFacets = {}): string {
  const query = (["channel", "status", "role"] as const)
    .filter((k) => facets[k])
    .map((k) => `${k}=${facets[k]}`)
    .join("&");
  return query ? `/space/tasks?${query}` : "/space/tasks";
}
