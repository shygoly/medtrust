## 1. 实体与数据源

- [x] 1.1 `packages/database/src/control-plane/index.ts` 新增 `SpaceEntity`（`@Entity('cp_space')`），注册进 `controlPlaneEntities`。
- [x] 1.2 `pnpm --filter @medtrust/database build`，确认 `dist/` 导出 `SpaceEntity`。

## 2. 空间模块

- [x] 2.1 新增 `space.module.ts`：`TypeOrmModule.forFeature([SpaceEntity], 'controlplane')`。
- [x] 2.2 `space.service.ts`：幂等 seed（id=SPACE_ID）+ create（去重/非空校验）+ list/get/remove。
- [x] 2.3 `space.controller.ts`：`GET /spaces`、`GET /spaces/:id`、`POST /spaces`（operator）、`DELETE /spaces/:id`（operator）。
- [x] 2.4 `app.module.ts` 接线 `SpaceModule`。

## 3. 治理同步

- [x] 3.1 `DOMAIN.md` 覆盖矩阵新增 `cp_space` 行；新增「空间管理」小节 + INV-SPACE-01。
- [x] 3.2 `openspec/changes/tc609-space-management/` 建 change set（本目录）。

## 4. 验证

- [x] 4.1 `space.service.spec.ts`：create/list/去重/删除/缺空校验全绿。
- [x] 4.2 `node scripts/check-meta-docs.mjs` 无新增 [ERR]。
- [x] 4.3 `openspec validate tc609-space-management` 通过。
- [ ] 4.4 更新 `docs/TC609-6-2025-16-整改计划.md` 差距矩阵 6.5 状态（❌→✅）。
