# Proposal

## Why

`/space/catalog` 列表与 `/space/catalog/{id}` 详情都能返回元数据，但浏览体验不可靠且两边口径不一致：无稳定排序；非 CDM（如肾活检 WSI）缺数据源摘要，详情甚至误报「未声明」；提供方名靠前端演示硬编码；默认列表确权 chip 恒真；分级/状态/上架范围多为自由文本或英文码；规模口径混用；详情空字段占行、字段契约裸表格。列表与详情本应共用一套呈现规则，拆成两个 change 只会增加 helper 与归档摩擦——合并为一处契约更合适。

## What Changes

- **共享呈现**：抽出单一目录浏览 helper（数据源摘要、提供方显示名、分级映射、规模口径、状态/上架范围标签）；列表与详情只消费该 helper。
- **列表**：稳定排序；行级摘要与规模；默认在架视图去掉恒真确权 chip；主列不刷 UUID；提供方登记名。
- **详情**：同一摘要不得对 ImagingStudy 误报未声明；状态/上架范围/分级可读；空 roles/provenance 省略；字段契约用 `DataGrid`；可核对 `homeSpace` 与时间；详情仍展示完整 id/urn。
- **API**：`GET /catalog` 与 `GET /catalog/:id` 附带 `providerDisplayName`（缺省可省略）。
- **DESIGN.md**：登记 ListCard 与详情信息架构，并写明共用 helper。

非目标：不改确权法律语义、不改 `listingConsent`、不做分页/搜索、不强制回填种子 `dataSource`/`scenarioTitle`、不重做编辑表单。

本变更合并并取代此前未归档的 `catalog-list-display` 与 `catalog-detail-display`（已删除，不再并行）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `data-product`: 增加目录**浏览**（列表 + 详情）的排序与呈现要求：共享摘要/命名/分级/规模口径，以及列表与详情各自的交互与信息架构约束。

## Impact

- API：`apps/api/src/runtime/catalog`（list 排序；list/get 显示名）。
- Web：`space/catalog/page.tsx`、`space/catalog/[id]/page.tsx`；新增共享 `lib`/`components/console` 呈现模块；`PARTICIPANT_LABELS` 降为兜底。
- 治理：`DESIGN.md`；单测 + WSI/CDM 列表↔详情对照验收。
