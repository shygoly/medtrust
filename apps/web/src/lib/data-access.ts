/**
 * 产品级访问授权（ACL，D-ACL-1）的纯逻辑：状态归一与展示口径。
 *
 * 这一层只回答「能不能碰这个数据产品」。以什么条款执行是数字合约的事，
 * 所以这里**不出现**留存/输出/目的等条款字段——页面保持一页两动作（授予、回收）。
 */

export type AccessPermission = "catalog" | "compute";
export type AccessGrantStatus = "active" | "revoked";

export interface AccessGrantRow {
  id: string;
  dataProductId: string;
  providerId: string;
  granteeParticipantId: string;
  permissions?: AccessPermission[] | null;
  purpose?: string | null;
  status?: AccessGrantStatus;
  grantedByParticipantId?: string | null;
  grantedAt?: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  note?: string | null;
}

export interface InstitutionRow {
  id: string;
  participantId?: string | null;
  org: string;
  role?: string | null;
}

/** 生效状态：回收优先，其次看到期（服务端判定同样按 expiresAt）。 */
export type GrantState = "active" | "expired" | "revoked";

export const GRANT_STATE_META: Record<
  GrantState,
  { label: string; color: string; hint: string }
> = {
  active: { label: "生效中", color: "var(--cs-green)", hint: "该机构按权限位可访问" },
  expired: { label: "已过期", color: "var(--cs-amber)", hint: "超过到期时间，等同未授权" },
  revoked: { label: "已回收", color: "var(--cs-dim)", hint: "提供方已回收；记录保留为审计证据" },
};

export function grantState(row: AccessGrantRow, now = Date.now()): GrantState {
  if (row.status === "revoked") return "revoked";
  if (row.expiresAt) {
    const until = new Date(row.expiresAt).getTime();
    if (Number.isFinite(until) && until < now) return "expired";
  }
  return "active";
}

export function grantStateLabel(row: AccessGrantRow, now = Date.now()): { label: string; color: string } {
  const meta = GRANT_STATE_META[grantState(row, now)];
  return { label: meta.label, color: meta.color };
}

/** 默认分面：优先「生效中」，没有就看第一个有数据的档（避免打开就是空列表）。 */
export function defaultGrantFacet(rows: readonly AccessGrantRow[], now = Date.now()): GrantState {
  const counts: Record<GrantState, number> = { active: 0, expired: 0, revoked: 0 };
  for (const row of rows) counts[grantState(row, now)] += 1;
  if (counts.active > 0 || rows.length === 0) return "active";
  return (["expired", "revoked"] as GrantState[]).find((f) => counts[f] > 0) ?? "active";
}

/** 权限位的中文口径（短，够懂就行）。 */
export function permissionLabel(permission: AccessPermission): string {
  return permission === "catalog" ? "查看目录" : "可计算";
}

export function permissionSummary(permissions?: readonly AccessPermission[] | null): string {
  const list: readonly AccessPermission[] = permissions?.length ? permissions : ["compute"];
  return list.map(permissionLabel).join(" · ");
}

/** 机构名：优先注册表 org，查不到回退 slug（不显示空白）。 */
export function institutionName(
  byParticipantId: ReadonlyMap<string, string>,
  participantId: string,
): string {
  return (byParticipantId.get(participantId) ?? "").trim() || participantId;
}

/**
 * 可被授权的机构：排除提供方自己（自访问无需授权，服务端也会拒）。
 * 只保留有 slug 的（旧行没有 slug，无法作为授权主体）。
 */
export function granteeOptions(
  institutions: readonly InstitutionRow[],
  providerId: string | undefined,
): Array<{ participantId: string; org: string }> {
  const seen = new Set<string>();
  const out: Array<{ participantId: string; org: string }> = [];
  for (const row of institutions) {
    const slug = row.participantId?.trim();
    if (!slug || slug === providerId || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ participantId: slug, org: row.org?.trim() || slug });
  }
  return out.sort((a, b) => a.org.localeCompare(b.org, "zh-CN"));
}

/** 到期日的本地展示（只到天，授权粒度不需要分钟）。 */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
