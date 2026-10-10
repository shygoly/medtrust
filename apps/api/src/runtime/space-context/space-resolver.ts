import { ForbiddenException } from "@nestjs/common";

/** 空间覆盖请求头（仅允许覆盖为本用户已属的空间）。 */
export const SPACE_HEADER = "x-space-id";

export interface SpacePrincipal {
  readonly spaces?: readonly string[];
  readonly spaceId?: string;
}

/**
 * 解析用户所属空间集合（P2.1）。
 *
 * 过渡期（P6 成员关系落库前）令牌可能没有 spaces 声明，此时回落到默认空间，
 * 使**单空间部署行为零变更**（D-SPD-2 / P1.5）。
 */
export function resolveSpaces(
  principal: SpacePrincipal | undefined,
  fallbackSpaceId: string,
): readonly string[] {
  const list = (principal?.spaces ?? []).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  return list.length ? list : [fallbackSpaceId];
}

/** 解析本次请求的目标空间：请求头 > 令牌当前空间 > 所属空间首个。 */
export function resolveRequestedSpace(
  headerValue: unknown,
  principal: SpacePrincipal | undefined,
  fallbackSpaceId: string,
): string | undefined {
  if (typeof headerValue === "string" && headerValue.trim()) return headerValue.trim();
  if (typeof principal?.spaceId === "string" && principal.spaceId.trim()) {
    return principal.spaceId.trim();
  }
  return resolveSpaces(principal, fallbackSpaceId)[0];
}

/**
 * 强制校验（fail-closed）：缺失上下文或请求了非本用户空间即拒。
 * 报错不区分「不存在」与「不属于」，避免空间枚举。
 */
export function assertSpaceAllowed(
  requested: string | undefined,
  allowed: readonly string[],
): string {
  if (!requested) throw new ForbiddenException("空间上下文缺失");
  if (!allowed.includes(requested)) throw new ForbiddenException("无权访问该空间");
  return requested;
}
