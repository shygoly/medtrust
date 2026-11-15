# Tasks

## 1. 共享呈现与控制面

- [x] 1.1 抽出目录浏览 helper（数据源摘要 / 分级 / 规模 / 状态 / 上架范围 / 提供方显示名解析），单测覆盖 ImagingStudy≠未声明、CDM、服务、未知回退；验证测试通过
- [x] 1.2 `CatalogService.list` 稳定排序（`updatedAt DESC, id ASC`；明确 NULL 行为），单测：同过滤两次序列一致、更新后相对次序变化；验证通过
- [x] 1.3 `GET /catalog` 与 `GET /catalog/:id` 附带 `providerDisplayName`（批量/单条同一解析），验证缺失时省略且不 500
- [x] 1.4 Controller 协作可见性过滤保序；验证过滤结果为输入子序列

## 2. 列表页

- [x] 2.1 `/space/catalog` 接入 helper：摘要、分级、规模、提供方显示名；验证 WSI 有影像摘要、「N 行」、机构名
- [x] 2.2 默认在架视图去掉恒真确权 chip；验证默认列表无「已确权」文案
- [x] 2.3 主列不展示完整 UUID（可读短 id 可选弱提示）；验证 UUID 产品行主列无完整 UUID

## 3. 详情页

- [x] 3.1 详情数据源/规模/分级/提供方改用同一 helper，删除旧 `dataSourceText`；验证 WSI 详情不为「未声明」且与列表摘要口径一致
- [x] 3.2 状态、上架范围改为可读标签；验证 `active`/`internal` 不再仅英文码直出
- [x] 3.3 空 `productRoles` / provenance 从主面板省略；验证无空「—」双行占位
- [x] 3.4 字段契约改用 `DataGrid`；验证无裸 `<table>`、样式为 `--cs-*`
- [x] 3.5 增加 `homeSpace` 与创建/更新时间（本地可读）；验证可见且格式符合 DESIGN；id/urn 仍可核对

## 4. 治理与对照验收

- [x] 4.1 `DESIGN.md` 登记列表 ListCard 与详情信息架构，并写明共用 helper；验证文档与实现一致
- [x] 4.2 跑相关单测/lint；必要时更新目录页头 desc；验证检查通过
- [x] 4.3 浏览器对照：同一 WSI/CDM 产品列表↔详情摘要与规模一致；默认列表无确权刷屏；刷新后次序稳定；详情下架/申请合约动作无回归

## Workflow follow-up

- Archive after implementation and review; verify main `data-product` spec receives a single coherent merge (no leftover dual-change deltas).
