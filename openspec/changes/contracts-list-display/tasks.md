# Tasks

## 1. 控制面列表契约

- [x] 1.1 `ContractService.list` 增加稳定排序（最近创建优先 + id 并列），单测验证同查看者两次序列一致；验证通过
- [x] 1.2 列表项附带 `providerDisplayName` / `consumerDisplayName` / `dataProductTitle`（批量解析，缺失省略），单测验证有登记/产品时字段存在、解析失败不 500；验证通过
- [x] 1.3 角色/空间过滤保持相对顺序；验证过滤结果为输入子序列

## 2. 列表呈现

- [x] 2.1 重做 `/space/contracts` 行信息架构（purpose 标题、机构显示名、产品标题、收敛条款摘要），验证「胰岛素暴露·胰腺炎…」类合约不再以裸 `p-`/`dp-` 为关系/产品主文案
- [x] 2.2 状态 chip 闭集补全并登记文案/颜色；验证已持签/待审批等常见态有中文徽章
- [x] 2.3 将 `C2PolicyPanel` 移出列表行，改为抽屉/侧面板/独立入口；验证列表行无 C2 编辑表单且仍可从入口配置
- [x] 2.4 `PageHeader` 补 `title`；`listContracts` 与页面去掉 `any[]`，改为显式类型；验证类型检查通过且页头有标题
- [x] 2.5 参与方显示名与 `catalog-browse-display` 共用解析路径（或明确过渡兜底）；验证无第三套硬编码主路径

## 3. 治理与验收

- [x] 3.1 `DESIGN.md` 登记合约 ListCard 行结构、状态徽章、C2 入口位置；验证与实现一致
- [x] 3.2 跑相关单测/lint；浏览器核对：排序稳定、名称可读、副行不刷 id、无行内 C2 编辑、签发/知悉/推理入口无回归；验证通过

## Workflow follow-up

- Archive after implementation and review; verify main `digital-contract` spec merges cleanly.
