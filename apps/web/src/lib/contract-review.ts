/**
 * 数字合约审核页的纯逻辑（无 React）：状态归一、分面、人/机构/时间的展示口径。
 *
 * 单独放在 lib 里是为了可测：状态语义（尤其 revoked 同时承担「驳回」与「解除」）
 * 是这个页面最容易漂的地方，不靠肉眼。
 */

export type RawContractStatus = "draft" | "active" | "expired" | "revoked";

export interface ContractActor {
  participantId?: string | null;
  userId?: number | string | null;
  name?: string | null;
  email?: string | null;
}

export interface ContractRow {
  id: string;
  dataProductId: string;
  providerId: string;
  consumerId: string;
  purpose: string;
  retention?: string;
  output?: string;
  outputPolicy?: { preset?: string; minCell?: number; allowedArtifacts?: string[] } | null;
  pinnedModules?: Record<string, unknown> | null;
  validUntil?: string;
  status?: RawContractStatus;
  /** 服务端惰性计算的过期状态；优先于 status。 */
  effectiveStatus?: RawContractStatus;
  canApprove?: boolean;
  createdAt?: string;
  hash?: string | null;
  attestationTxHash?: string | null;
  mdopStatus?: string | null;
  preReview?: {
    verdict?: string;
    overallRisk?: string;
    evaluatedAt?: string;
  } | null;
  /** 申请人快照（旧合约为空）。 */
  requestedBy?: {
    userId?: number | string | null;
    name?: string | null;
    email?: string | null;
    at?: string;
  } | null;
  /** 审批决定快照（旧合约为空）。 */
  decision?: {
    outcome?: "approved" | "rejected";
    at?: string;
    by?: ContractActor | null;
    note?: string | null;
  } | null;
  /** 解除留痕（旧合约为空）。 */
  revocation?: {
    at?: string;
    reason?: string;
    by?: ContractActor | null;
  } | null;
  consumerOrg?: string | null;
  providerOrg?: string | null;
  dataProductTitle?: string | null;
}

/** 页面状态的唯一口径（chip 文案 + 颜色 + 分面）。 */
export type ReviewState = "pending" | "active" | "rejected" | "terminated" | "expired";

export const REVIEW_STATE_META: Record<
  ReviewState,
  { label: string; color: string; hint: string }
> = {
  pending: { label: "待审批", color: "var(--cs-amber)", hint: "等医院签发或驳回" },
  active: { label: "已生效", color: "var(--cs-green)", hint: "合约已签发" },
  rejected: { label: "已驳回", color: "var(--cs-red)", hint: "医院驳回了申请" },
  terminated: { label: "已解除", color: "var(--cs-dim)", hint: "生效后被提供方解除" },
  expired: { label: "已过期", color: "var(--cs-amber)", hint: "超过有效期" },
};

/** 分面顺序 = 审核动线的顺序：待办在上，历史在下。 */
export const REVIEW_FACETS: ReviewState[] = ["pending", "active", "rejected", "terminated", "expired"];

/**
 * `revoked` 同时承载「驳回」和「解除」——这里按留痕拆开：
 * - decision=rejected → 已驳回
 * - revocation 有记录 → 已解除
 * - 两者都没有（本字段上线前的旧数据）→ 归入「已解除」分面，但 chip 用「已撤销」，
 *   不假装知道当时是驳回还是解除。
 */
export function reviewStateOf(row: ContractRow): ReviewState | "revoked-legacy" {
  const raw = row.effectiveStatus ?? row.status ?? "draft";
  if (raw === "draft") return "pending";
  if (raw === "expired") return "expired";
  if (raw === "active") return "active";
  if (row.decision?.outcome === "rejected") return "rejected";
  if (row.revocation?.at) return "terminated";
  return "revoked-legacy";
}

export function reviewStateLabel(row: ContractRow): { label: string; color: string } {
  const state = reviewStateOf(row);
  if (state === "revoked-legacy") {
    return { label: "已撤销（未记录原因）", color: "var(--cs-dim)" };
  }
  const meta = REVIEW_STATE_META[state];
  return { label: meta.label, color: meta.color };
}

/** 分面归属：legacy revoked 并入「已解除」，否则会有一类合约在任何分面里都看不到。 */
export function facetOf(row: ContractRow): ReviewState {
  const state = reviewStateOf(row);
  return state === "revoked-legacy" ? "terminated" : state;
}

export function facetCounts(rows: readonly ContractRow[]): Record<ReviewState, number> {
  const counts: Record<ReviewState, number> = {
    pending: 0,
    active: 0,
    rejected: 0,
    terminated: 0,
    expired: 0,
  };
  for (const row of rows) counts[facetOf(row)] += 1;
  return counts;
}

/** 默认分面：有待审批就先看待办（医院要审、药企要看自己刚提交的），否则看已生效。 */
export function defaultFacet(_role: string | undefined, rows: readonly ContractRow[]): ReviewState {
  const counts = facetCounts(rows);
  return counts.pending > 0 ? "pending" : "active";
}

/** 机构展示：优先注册表里的 org，查不到回退 slug（绝不显示空白）。 */
export function orgLabel(org: string | null | undefined, slug: string): string {
  return (org ?? "").trim() || slug;
}

/** 人展示：姓名 + 邮箱；只有其一就只用其一。 */
export function personLabel(
  name: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const n = (name ?? "").trim();
  const e = (email ?? "").trim();
  if (n && e) return `${n} <${e}>`;
  return n || e || null;
}

/** 本地时间 `YYYY-MM-DD HH:mm`；无值/非法值返回 null（界面显示「未记录」）。 */
export function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 申请时间：优先申请人快照时间，其次合约创建时间。 */
export function appliedAt(row: ContractRow): string | null {
  return formatTime(row.requestedBy?.at ?? row.createdAt);
}

/** MDOP 合约：网页点了「签发」不等于持有方已签 —— 未签完时给一条次级提示。 */
export function mdopHint(row: ContractRow): string | null {
  if (reviewStateOf(row) !== "active") return null;
  const s = row.mdopStatus;
  if (!s || s === "agreed" || s === "active" || s === "terminated") return null;
  if (s === "unsigned") return "待院方连接器签署";
  if (s === "offered") return "已发出要约，待院方连接器签署";
  return null;
}

/** 预审裁决的中文标签（快照里存的是枚举）。 */
export function preReviewLabel(verdict: string | undefined): string | null {
  if (verdict === "auto_approve") return "批准";
  if (verdict === "manual_review") return "需审批";
  if (verdict === "block") return "驳回";
  return null;
}
