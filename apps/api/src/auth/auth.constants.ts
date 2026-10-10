/** Legacy compute/privacy modules scope rows by tenant; federated users bind via participantId. */
export const DEFAULT_TENANT_ID = 1;

export function resolveTenantId(payload: { tenantId?: number | null }): number {
  return payload.tenantId ?? DEFAULT_TENANT_ID;
}

/**
 * 解析令牌中的所属空间集合（D-SPD-2）。
 * 无 spaces 声明（P6 成员关系落库前的旧令牌）时回落到默认空间，
 * 使单空间部署行为与改造前完全一致。
 */
export function resolveSpaces(
  payload: { spaces?: readonly string[] } | undefined,
  fallbackSpaceId: string,
): readonly string[] {
  const list = (payload?.spaces ?? []).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  return list.length ? list : [fallbackSpaceId];
}
