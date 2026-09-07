## Why

TC609-6-2025-16 基础级评测项 6.5「空间基础管理」在代码核查中判为 ❌ 未实现：全库无 Space
实体、无空间 CRUD API，`spaceId="sh-med"` 硬编码于 `packages/demo-scenario/src/ckd-scenario.json`。
这是整改计划（`docs/TC609-6-2025-16-整改计划.md`）P0-1 的硬缺口——不修则基础级专项检验直接不过。

## What Changes

- 新建 `cp_space` 实体（id/name/description/status/createdAt），注册进 control-plane 连接（D7 物理隔离）。
- 新增 `apps/api/src/runtime/space` 模块：`SpaceService`（幂等 seed + create/list/get/remove）、
  `SpaceController`（`GET /spaces`、`GET /spaces/:id`、`POST /spaces`（operator）、
  `DELETE /spaces/:id`（operator））。
- `SPACE_ID` 不再只是 demo-scenario 常量：`SpaceService.onModuleInit` 以相同 id 幂等种子默认
  空间记录，使目录/合约现有的 `homeSpace`/`spaceId` 引用指向真实 `cp_space` 行（保留 seed 兼容）。
- 同步 `DOMAIN.md` 覆盖矩阵（新增 `cp_space` 行）与「空间管理」小节（关系 + INV-SPACE-01 不变量）。

## Capabilities

### New Capabilities
- `space-management`: 可信数据空间本身作为顶层容器可被创建/查询/删除（operator 门控），
  目录与合约通过真实空间 id 引用它，且默认空间幂等种子。

### Modified Capabilities
None.（`catalog`/`digital-contract` 的 `homeSpace`/`spaceId` 引用语义不变，仅从「常量」升为「指向真实空间行」。）

## Impact

- **Code:** `packages/database/src/control-plane/index.ts`（`SpaceEntity` + 注册）、
  `apps/api/src/runtime/space/*`（新增）、`apps/api/src/app.module.ts`（接线 SpaceModule）。
- **Data:** 新增 `cp_space` 表；开机幂等 seed 一条默认空间行（id=SPACE_ID）。
- **APIs:** 新增 `GET/POST/DELETE /spaces` 端点（JWT + operator 门控）。
- **Risk:** 低。纯增量；默认空间 seed 与既有 `SPACE_ID` 常量一致，不改变现有 homeSpace 数据。
