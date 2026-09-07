# space-management

可信数据空间本身作为顶层容器：创建、查询、删除与默认空间种子。空间是服务平台最小功能之一
（对齐 TC609-6-2025-01「空间管理」）；目录与合约通过 `homeSpace`/`spaceId` 引用真实空间 id。

## ADDED Requirements

### Requirement: 空间实体持久化
系统 SHALL 在 control-plane 库持久化空间记录 `cp_space`（id/name/description/status/createdAt），
且该表不得承载任何行级医疗数据。

#### Scenario: 空间记录只含元数据
- **WHEN** 创建空间
- **THEN** 持久化的记录仅含空间元数据字段，无 `rows`/`data` 等原始数据字段。

### Requirement: 空间管理角色门控
空间创建与删除 SHALL 仅对 `operator` 角色开放；查询对任意登录角色开放。

#### Scenario: operator 创建空间
- **WHEN** operator 调用 `POST /spaces` 且 id 非空、未占用
- **THEN** 空间创建成功并返回 `active` 状态。

#### Scenario: 重复空间 id 被拒
- **WHEN** 以已存在的 id 创建空间
- **THEN** 返回冲突错误，且不覆盖既有空间。

### Requirement: 默认空间幂等种子
系统启动时 SHALL 幂等种子默认空间（id 与 demo-scenario `SPACE_ID` 一致），
使目录/合约既有 `homeSpace` 引用指向真实空间行；已有空间时不得重复插入。

#### Scenario: 重启不重复种子
- **WHEN** 对已含默认空间的库再次启动
- **THEN** 默认空间仅一条，已有记录不被覆盖。
