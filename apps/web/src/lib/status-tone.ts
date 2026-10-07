// 非任务类状态（账号 / 认证申请 / 证书 / 开放平台应用 / 互认主体）到语义色的唯一映射。
// 与 DESIGN.md §2 的登记一致；页面只管中文标签，不私自配色。

export type StatusTone = "ok" | "attention" | "blocked" | "neutral";

const TONE: Record<string, StatusTone> = {
  active: "ok",
  approved: "ok",
  pending: "attention",
  submitted: "attention",
  disabled: "blocked",
  rejected: "blocked",
  revoked: "blocked",
};

/** 未登记的状态一律中性色——宁可不强调，也不把未知状态染成"正常"。 */
export function statusTone(status: string | null | undefined): StatusTone {
  return TONE[(status ?? "").toLowerCase()] ?? "neutral";
}
