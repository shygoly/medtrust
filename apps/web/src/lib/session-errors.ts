// 会话失效 vs 暂时不可用的判定。
// 只有服务端明确拒绝凭证（400/401/403）才清登录；网关 5xx（含 Cloudflare 52x）、
// 限流 429、网络断开或跨域响应被截断，都只是暂时不可用——清掉登录会把正在演示/录入的人踢出去。

export type RefreshOutcome = "refreshed" | "rejected" | "unavailable";

export function classifyRefreshStatus(status: number): RefreshOutcome {
  if (status >= 200 && status < 300) return "refreshed";
  if (status === 400 || status === 401 || status === 403) return "rejected";
  return "unavailable";
}

export function isSessionRejected(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  return status === 401 || status === 403;
}
