# Design

## Context

See `proposal.md` Why。列表：`CatalogService.list` 无 order；`space/catalog/page.tsx` 用 `participantLabel`、可选 CDM 块、恒真确权 chip。详情：`[id]/page.tsx` 内 `dataSourceText` 只认文件/CDM 路径，ImagingStudy 变「未声明」；状态/`listingScope` 英文原文；fields 裸 `<table>`。两边应对齐同一套元数据摘要与命名。

## Goals / Non-Goals

**Goals:**

- 一份 helper、两处页面、同一验收产品（WSI + CDM）列表↔详情口径一致。
- 满足合并后的 `data-product` delta。

**Non-Goals:**

- 全站替换所有 `participantLabel` 调用点（目录浏览为必达）。
- 折叠 CDM 覆盖大块、分页/搜索。
- 强制改种子补 `dataSource`。

## Decisions

### 1. 单一 helper 模块

`lib/catalog-display.ts`（或 `components/console/catalog-display.ts`）导出：

- `catalogDataSourceSummary(...)`
- `catalogClassificationLabel(...)`
- `catalogScaleLabel(...)`
- `catalogStatusLabel` / `catalogListingScopeLabel`
- 提供方显示名解析（响应字段 → 登记 → 演示兜底 → id）

列表与详情禁止再各写一套 `dataSourceText` / 分级拼串。

### 2. API：排序 + 显示名

- `list`：`order: { updatedAt: "DESC", id: "ASC" }`；NULL `updatedAt` 行为单测钉死；协作 filter 保序。
- `list` 与 `get`：附带可选 `providerDisplayName`；解析失败不 500。

### 3. 列表行 vs 详情面板

| 表面 | 要点 |
|------|------|
| 列表 | 标题 → 可选 scenarioTitle → 提供方名 → 摘要 →（CDM 覆盖）→ 分级 → 规模 → 条件确权 → 动作；无完整 UUID |
| 详情 | 产品块（可读状态/上架范围/分级、空间与时间、确权）→ 数据源与规模（同摘要；空 roles/provenance 省略）→ 字段契约 DataGrid → 条件服务/授权块 → 高级 JSON |

### 4. 摘要与标签闭集

与先前两 change 一致：CDM / ImagingStudy / 其它 resourceType / 服务 / 未声明；status、listingScope、classificationTag 中文映射表单一维护。

### 5. 落地顺序

1. helper + 单测  
2. API 排序与显示名  
3. 列表页  
4. 详情页  
5. DESIGN + 对照验收  

## Risks / Trade-offs

- [helper 与页面同 PR 体量偏大] → tasks 分组可分 commit，仍同一 change 归档。
- [分级映射改观感] → 预期统一；自由文本作回退。
- [排序影响「第 N 条」脚本] → 按 title/id 定位。

## Migration Plan

无库迁移。回滚 = 回退提交。旧 change 目录已删除，勿再打开。

## Open Questions

无。
