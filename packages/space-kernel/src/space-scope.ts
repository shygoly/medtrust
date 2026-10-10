// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type { SpaceContextValue } from "./space-context";

/**
 * 已登记为「域内活动表」的实体名集合。
 * 身份 / 主体表 MUST NOT 登记（D-SPD-12）；登记动作在 P4 随 `space_id` 列一起做。
 */
const SPACE_SCOPED_ENTITIES = new Set<string>();

export function registerSpaceScopedEntity(entityName: string): void {
  SPACE_SCOPED_ENTITIES.add(entityName);
}

export function isSpaceScopedEntity(entityName: string): boolean {
  return SPACE_SCOPED_ENTITIES.has(entityName);
}

export function spaceScopedEntities(): readonly string[] {
  return [...SPACE_SCOPED_ENTITIES].sort();
}

/** 仅供测试：清空登记表。 */
export function resetSpaceScopedEntitiesForTest(): void {
  SPACE_SCOPED_ENTITIES.clear();
}

export interface ScopableQueryBuilder {
  readonly alias: string;
  andWhere(condition: string, parameters?: Record<string, unknown>): unknown;
}

/**
 * 仓储层统一注入（P2.3）：为已登记的域内活动表追加空间过滤，
 * 使越权查询在仓储层被拦，而不是依赖逐个 service 自觉。
 *
 * 未登记实体、或无空间上下文时**原样返回**——因此在 P4 落 `space_id` 列之前
 * 本机制是 no-op，改造期间行为零变更（P1.5）。
 */
export function scopeToSpace<T extends ScopableQueryBuilder>(
  qb: T,
  entityName: string,
  ctx: SpaceContextValue | undefined,
  column = "space_id",
): T {
  if (!ctx?.spaceId) return qb;
  if (!SPACE_SCOPED_ENTITIES.has(entityName)) return qb;
  qb.andWhere(`${qb.alias}.${column} = :__spaceId`, { __spaceId: ctx.spaceId });
  return qb;
}
