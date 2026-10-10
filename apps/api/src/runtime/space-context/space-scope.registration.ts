import { registerSpaceScopedEntity } from "@medtrust/space-kernel";
import { SPACE_SCOPED_TABLES } from "@medtrust/database";

/**
 * P2.3 启用点：把「域内活动表」登记进基座空间过滤表。
 *
 * 在模块**加载期**完成（而非 onModuleInit），保证任何请求路径进入前过滤表已就绪。
 * 未登记的表不受影响，因此 P4 逐表登记即为启用开关（D-SPD-12）。
 */
for (const table of SPACE_SCOPED_TABLES) {
  registerSpaceScopedEntity(table);
}

export const REGISTERED_SPACE_SCOPED_TABLES = SPACE_SCOPED_TABLES;
