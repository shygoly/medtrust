// 统一任务列表的行模型与分面（ia-task-surface + tasks-browse-display）。
//
// 后端目前有三条并行编排（RWS / L4 联邦预测 / SecretFlow）加 MDOP 作业内核，提供方另有入站分派。
// 这里把五个来源各用一个适配函数映射成同一行模型——纯函数、逐来源独立：
// MDOP 二期下线某条旧编排时，删掉对应的适配函数与来源字段即可。

import type { FlPredictionOrchestrationRecord, ProviderInboxItem, RwsOrchestrationRecord } from "../api/client";
import { federatedStateLabel, type SecretFlowTaskSummary } from "./federated-tasks";
import { mapOrchestrationStatus, workloadMeta, type OrchestrationWorkloadKind } from "./orchestration-workloads";

export type TaskChannel = OrchestrationWorkloadKind | "mdop";
/** 浏览主徽章四态（tasks-browse-status）；与 DESIGN §2 对齐。 */
export type TaskBadge = "running" | "completed" | "failed" | "cancelled";
/** 我方在该任务中的角色：我方发起，或分派给本院执行。旁观（运营/合规）为空。 */
export type TaskRole = "initiator" | "provider";

export interface TaskRow {
  channel: TaskChannel;
  taskId: string;
  title: string;
  purpose: string;
  /** 归一后的状态，用于徽标与状态分面。 */
  badge: TaskBadge;
  /** 该通道自己的状态词（各通道词汇不同，只作次要文案）。 */
  statusLabel: string;
  consumerId: string;
  createdAt: string;
  /** 可推导时 >0；未知时为 null（列表不展示假「0 家」）。 */
  providerCount: number | null;
  summary?: string;
  myRole?: TaskRole;
  href: string;
  /** 迁移前旧通道只读任务。 */
  historical?: boolean;
}

export interface MdopJobSummary {
  id: string;
  purpose?: string;
  status?: string;
  createdAt?: string;
  /** 失败/拒绝原因；PURGED 后仍可能保留，用于推断销毁前成败。 */
  rejectReason?: string | null;
  /** 列表或详情若已带结果载荷，用于 PURGED 成功推断。 */
  hasResult?: boolean;
  applicant?: { org?: string; project?: string } | null;
  contracts?: string[] | null;
  logicalPlan?: {
    stages?: Array<{
      op?: string;
      params?: { uri?: string };
      inputs?: Array<{ from?: string }>;
    }>;
  } | null;
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
  { value: "failed", label: "失败" },
  { value: "cancelled", label: "已取消" },
];
export const ROLE_OPTIONS: Array<{ value: TaskRole; label: string }> = [
  { value: "initiator", label: "我发起的" },
  { value: "provider", label: "分派给本院" },
];

/** 表单未填标题时写入 applicant.project 的默认串——不当作用户标题。 */
export const MDOP_PROJECT_PLACEHOLDERS = new Set([
  "rws-l15",
  "rws-comparative-effect",
  "rws-causal-psm",
  "rws-causal-survival",
  "rws-algorithm-validation",
  "rws-cohort-count",
  "rws-condition-prevalence",
  "rws-adverse-event-signal",
  "fl-prediction",
  "sponsor",
]);

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
  me && consumerId && consumerId === me ? "initiator" : undefined;

function isPlaceholderProject(project: string | undefined | null): boolean {
  if (!project?.trim()) return true;
  return MDOP_PROJECT_PLACEHOLDERS.has(project.trim());
}

/**
 * 浏览用显示标题：用户任务标题优先，排除 MDOP project 占位，再回退 purpose / id。
 */
export function taskDisplayTitle(input: {
  title?: string | null;
  purpose?: string | null;
  applicantProject?: string | null;
  fallbackId?: string | null;
}): string {
  const project = input.applicantProject?.trim();
  if (project && !isPlaceholderProject(project)) return project;
  const titled = input.title?.trim();
  if (titled) return titled;
  const purpose = input.purpose?.trim();
  if (purpose) return purpose;
  return (input.fallbackId?.trim() || "未命名任务");
}

/** 列表时间：本地 YYYY-MM-DD HH:mm；非法则原文或 —。 */
export function formatTaskListTime(iso: string | undefined | null): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 主标题已覆盖目的时，列表不再重复「目的 ·」chip。 */
export function shouldShowPurposeChip(title: string, purpose: string): boolean {
  const t = title.trim();
  const p = purpose.trim();
  if (!p) return false;
  if (t === p) return false;
  if (t.endsWith(p) || t.includes(` · ${p}`) || t.includes(`· ${p}`)) return false;
  return true;
}

function countMdopProviders(job: MdopJobSummary): number | null {
  const fromContracts = job.contracts?.filter(Boolean).length ?? 0;
  if (fromContracts > 0) return fromContracts;
  const stages = job.logicalPlan?.stages ?? [];
  const holders = new Set<string>();
  for (const s of stages) {
    const uri = s.params?.uri;
    if (typeof uri === "string") {
      const m = /^ds:\/\/([^/]+)\//.exec(uri);
      if (m?.[1]) holders.add(m[1]);
    }
    for (const inp of s.inputs ?? []) {
      const from = inp.from;
      if (typeof from === "string" && from.startsWith("ds://")) {
        const m = /^ds:\/\/([^/]+)\//.exec(from);
        if (m?.[1]) holders.add(m[1]);
      }
    }
  }
  return holders.size > 0 ? holders.size : null;
}

function fromRws(t: RwsOrchestrationRecord, me?: string): TaskRow {
  return {
    channel: "rws",
    taskId: t.taskId,
    title: taskDisplayTitle({ title: t.title, purpose: t.purpose, fallbackId: t.taskId }),
    purpose: t.purpose,
    badge: mapOrchestrationStatus(t.status),
    statusLabel: t.status,
    consumerId: t.consumerId,
    createdAt: t.createdAt,
    providerCount: t.assignments.length,
    summary: t.merged ? `合并队列 n=${t.merged.cohortSize}` : `${t.analysis.type}`,
    myRole: initiatorRole(t.consumerId, me),
    href: `/space/tasks/${t.taskId}?workload=rws`,
    ...(t.analysis?.type === "disproportionality" ? { historical: true as const } : {}),
  };
}

function fromFlPrediction(t: FlPredictionOrchestrationRecord, me?: string): TaskRow {
  return {
    channel: "fl_prediction",
    taskId: t.taskId,
    title: taskDisplayTitle({ title: t.title, purpose: t.purpose, fallbackId: t.taskId }),
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
    historical: true,
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
  const purpose = t.purpose ?? "联邦密算";
  return {
    channel: "secretflow",
    taskId: t.taskId,
    title: taskDisplayTitle({
      title: t.purpose ? `SecretFlow · ${t.purpose}` : null,
      purpose,
      fallbackId: t.taskId,
    }),
    purpose,
    badge: mapOrchestrationStatus(t.state),
    statusLabel: federatedStateLabel(t.state),
    consumerId: t.consumerId ?? "",
    createdAt: t.createdAt ?? "",
    providerCount: t.providerCount ?? null,
    summary: secretFlowSummary(t),
    myRole: initiatorRole(t.consumerId, me),
    href: `/space/federated/${encodeURIComponent(t.taskId)}`,
  };
}

export type MdopBadgeHints = {
  rejectReason?: string | null;
  hasResult?: boolean;
};

/** 销毁前结果线索：拒绝/中止类 → cancelled，其余非空原因 → failed。 */
function badgeFromRejectReason(reason: string): TaskBadge {
  if (/reject|拒绝|abort|中止|cancel|取消/i.test(reason)) return "cancelled";
  return "failed";
}

/**
 * MDOP 作业状态 → 浏览四态。
 * `PURGED`：成功与失败都会销毁。控制面惯例是失败/中止会留下 `rejectReason`，
 * 成功销毁通常为空——故无原因且无反证时视为已完成（勿默认已取消）。
 */
export function mdopBadge(
  status: string | undefined,
  hints?: MdopBadgeHints,
): TaskBadge {
  const s = (status ?? "").toLowerCase();
  if (s === "purged") {
    const reason = hints?.rejectReason?.trim();
    if (reason) return badgeFromRejectReason(reason);
    if (hints?.hasResult === false) return "cancelled";
    return "completed";
  }
  if (/^(completed|merged|published|succeeded|done)$/.test(s)) return "completed";
  if (/^(failed|partial|expired)$/.test(s)) return "failed";
  if (/^(rejected|refused|aborted|cancelled)$/.test(s)) return "cancelled";
  return "running";
}

function fromMdopJob(job: MdopJobSummary, me?: string): TaskRow {
  const org = job.applicant?.org?.trim() || "";
  const purpose = job.purpose ?? "MDOP 作业";
  const title = taskDisplayTitle({
    applicantProject: job.applicant?.project,
    purpose,
    fallbackId: job.id,
  });
  return {
    channel: "mdop",
    taskId: job.id,
    title,
    purpose,
    badge: mdopBadge(job.status, {
      rejectReason: job.rejectReason,
      hasResult: job.hasResult,
    }),
    statusLabel: job.status ?? "—",
    consumerId: org,
    createdAt: job.createdAt ?? "",
    providerCount: countMdopProviders(job),
    summary: "作业内核：各院本地复核并签名 → 平台签发执行凭证 → 执行 → 平台合并",
    myRole: initiatorRole(org || undefined, me),
    href: `/space/mdop/jobs/${encodeURIComponent(job.id)}`,
  };
}

function fromInbox(item: ProviderInboxItem): TaskRow {
  const progress = item.latestProgress?.stage
    ? `${item.latestProgress.stage}${item.latestProgress.detail ? ` · ${item.latestProgress.detail}` : ""}`
    : undefined;
  const historical =
    item.kind === "fl_prediction" || item.workloadLabel?.includes("L1.5");
  return {
    channel: item.kind,
    taskId: item.taskId,
    title: taskDisplayTitle({
      title: item.title,
      purpose: item.purpose,
      fallbackId: item.taskId,
    }),
    purpose: item.purpose,
    badge:
      item.status === "completed"
        ? "completed"
        : item.status === "failed"
          ? "failed"
          : "running",
    statusLabel: assignmentStatusLabel[item.status] ?? item.status,
    consumerId: item.consumerId,
    createdAt: item.createdAt,
    providerCount: null,
    summary: item.error ?? progress ?? item.resultHint ?? item.workloadLabel,
    myRole: "provider",
    href: `/space/tasks/${item.taskId}?workload=${item.kind}`,
    ...(historical ? { historical: true as const } : {}),
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
    ...(sources.mdopJobs ?? []).map((j) => fromMdopJob(j, mine)),
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

/** 从地址查询串读分面；闭集外忽略。旧书签 `blocked` 映到 `failed`。 */
export function parseTaskFacets(params: { get(name: string): string | null }): TaskFacets {
  const rawStatus = params.get("status");
  const status: TaskBadge | undefined =
    rawStatus === "blocked" ? "failed" : pick(STATUS_OPTIONS, rawStatus);
  return {
    channel: pick(CHANNEL_OPTIONS, params.get("channel")),
    status,
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
