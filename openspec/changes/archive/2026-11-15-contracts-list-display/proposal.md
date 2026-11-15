# Proposal

## Why

`/space/contracts` 列表能列出数字合约，但浏览成本高：主标题只有 `purpose`；使用方/提供方/数据产品全是裸 id、无机构名与产品标题；副行把 id、留存、输出、minCell、pinnedModules 挤成一条技术串；生效合约还把整块 C2 策略编辑面板塞进列表行；`GET /contracts` 无稳定排序；PageHeader 缺 title；前端用 `any[]`。需要把合约列表呈现升成可验收契约，并与目录浏览侧的「显示名」策略对齐（可复用同一参与方解析思路）。

## What Changes

- 列表行信息架构：用途为主标题；提供方/使用方显示登记名；数据产品显示标题（或可解析的短名），id 降为次要提示。
- 副行收敛：保留对浏览有用的条款摘要（留存、输出、minCell），去掉或折叠过长 id 刷屏与 pinnedModules 截断噪音。
- 状态 chip 闭集补全（含 active 三态与遗漏的 `approved` 等），文案与页头流程对齐。
- 列表默认稳定排序；C2 策略编辑移出列表行（详情/抽屉/独立入口），列表至多保留只读提示。
- PageHeader 补齐 title；合约列表项类型收紧（替代 `any`）。
- `DESIGN.md` 登记合约 ListCard 行结构。

非目标：不改合约状态机与签发/知悉 API 语义；不新建完整合约详情站（若仅需承载 C2，可用轻量面板/路由，不强制本变更交付完整详情页）；不做分页/全文搜索。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `digital-contract`: 增加控制台合约**列表浏览**的呈现与排序要求（参与方/产品显示名、行信息架构、状态徽章、C2 编辑不进列表行）。

## Impact

- Web：`apps/web/src/app/(console)/space/contracts/page.tsx`、`ContractRowActions` / `C2PolicyPanel` 挂载位置；可能复用或对齐 `catalog-browse-display` 的参与方显示名 helper；catalog 标题解析（list 附带或前端批查）。
- API（可选但推荐）：`GET /contracts` 稳定排序；列表项附带 `providerDisplayName` / `consumerDisplayName` / `dataProductTitle`（或等价字段），避免 N+1。
- 治理：`DESIGN.md`；手工验收用「胰岛素暴露·胰腺炎…」类种子合约对照。
- 与未归档 `catalog-browse-display`：参与方显示名宜共用解析路径，避免两套硬编码。
