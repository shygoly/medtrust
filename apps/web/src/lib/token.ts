/**
 * JWT 过期判断（只读 payload 的 `exp`，不验签）。
 *
 * 用途：**聊天消息走的是 chat-agent 独立服务**，它不会经过本前端 API 客户端的
 * 「401 → refresh → 重试」路径；access token 默认只有 15 分钟，长演示里很容易过期。
 * 所以发消息前先用这里判断"要不要先续签"。
 *
 * 不验签是刻意的：这里只决定"值不值得去 refresh"，真正的信任由服务端验签。
 */
export function tokenExpiryMs(token: string | null | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

/** 已过期或将在 skewSeconds 内过期 → true；解析不出 exp → false（不据此反复续签）。 */
export function isTokenExpiringSoon(
  token: string | null | undefined,
  skewSeconds = 90,
  now: number = Date.now(),
): boolean {
  const expiry = tokenExpiryMs(token);
  if (expiry === null) return false;
  return expiry - now <= skewSeconds * 1000;
}
