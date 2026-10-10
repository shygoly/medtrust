import { Injectable } from "@nestjs/common";
import { scopeToSpace, type SpaceContextValue } from "@medtrust/space-kernel";
import { SpaceContextService } from "./space-context.service";

export interface ScopableQueryBuilder {
  readonly alias: string;
  andWhere(condition: string, parameters?: Record<string, unknown>): unknown;
}

/**
 * 仓储层空间过滤门面（P2.3）。
 * 调用方只写 `scopeService.scope(qb, Entity.name)`，不自己拼 space_id 条件；
 * 未登记的实体自动跳过，因此 P4 逐表登记即为启用点。
 */
@Injectable()
export class SpaceScopeService {
  constructor(private readonly spaceContext: SpaceContextService) {}

  scope<T extends ScopableQueryBuilder>(
    qb: T,
    entityName: string,
    ctx?: SpaceContextValue,
  ): T {
    return scopeToSpace(qb, entityName, ctx ?? this.spaceContext.current());
  }
}
