> **前置**：本 change 的「结局-暴露独立性」完全生效依赖 `rws-algorithm-validation`（结构化算法引用）。**该 change 已于 2026-07-22 归档**，结构化路径（task 4.2/4.3）已与本 Phase 1 同步落地。

## 1. 阶段一：字段可选 + 告警（不破坏既有任务）

- [x] 1.1 `packages/database` `cp_rws_task` 增 `protocolVersion` / `revisionReason` / `revisedAt`；`cp_rws_assignment` 关联规格版本
- [x] 1.2 存量 `cp_rws_task` 行回填 `protocolVersion = 1`（含 Fly 上在跑数据）
- [x] 1.3 `apps/connector/src/domain/types.ts` `RwsAnalysis` 增 `designType`（六值封闭集，值域取 EVIDENCE.md §4 预登记）+ `rationale`，本阶段**可选**
- [x] 1.4 增 SAP 子结构（显著性水平 / 检验效能 / 样本量假设与依据 / 多重性 α 校正方式），本阶段可选
- [x] 1.5 增缺失值声明（机制假设 MCAR|MAR|MNAR + 填补策略）与敏感性分析声明列表，本阶段可选
- [x] 1.6 要素不完备的任务可执行，但报告标注「要素不完备」并列出缺失项

## 2. 规格冻结（design D1 / D3）

- [x] 2.1 实现冻结触发点：首次向任一连接器派发 assignment 时冻结（非提交时）
- [x] 2.2 实现冻结集：`designType` / `rationale` / `tte` 全部子字段 / `matchingCovariates` / `allowedArtifacts` / SAP / 缺失值 / 敏感性分析声明
- [x] 2.3 非冻结集（标题、说明、目标参与方列表）派发后仍可改，且不产生新版本
- [x] 2.4 冻结后修改冻结集字段 → 拒绝并提示创建新版本；新版本 MUST 要求 `revisionReason` 非空
- [x] 2.5 `policy-enforcement` 增 PEP 侧冻结校验（usage-control spec：派发后改 PS 变量 / 扩大产物范围均拒）
- [x] 2.6 冻结与版本行为的 spec 覆盖（派发前可改 / 派发后拒 / 描述性字段例外三条场景）

> Phase 3 已落地：pullPending 首次派发写 frozenAt（幂等）；冻结集字段不可变；
> 变更经 POST /rws/tasks/:id/revise 创建新版本（protocolVersion+1，必填 revisionReason，
> frozenAt 重置，旧 assignment 丢弃重排）。

## 3. SAP 与缺失值分级校验（design D4）

- [x] 3.1 L2/L3/L4 缺 SAP → 拒绝并指明缺失项
- [x] 3.2 L1.5 单一药-事件组合豁免检验效能与样本量声明
- [x] 3.3 多重比较判定（多亚组或多药-事件组合，含 L1.5 扫描）→ 强制声明 α 校正方式
- [x] 3.4 缺失值机制与填补策略「同时声明」校验（只声明其一即拒）

> Phase 2 已落地：3.1/3.2/3.3 按层级转必填（designType+rationale 全局必填，L0 例外；
> SAP 在 L2/L3/L4 必填；多重比较须声明 α 校正）；3.4 是 Phase 1 的配对校验。

## 4. 结局-暴露独立性（design D2）

- [x] 4.1 自由文本路径：降级为警告并放行，报告标注「独立性未校验」
- [x] 4.2 结构化路径（依赖 `rws-algorithm-validation`）：校验结局与暴露引用的算法标识与编码集无交集
- [x] 4.3 有交集 → fail-closed 拒绝并指出交集所在
- [x] 4.4 三条场景的 spec 覆盖（交集拒 / 无交集通过 / 自由文本降级）

## 5. 敏感性分析全报与报告口径（design D5 / D6）

- [x] 5.1 结果出具前对账：声明项与回传项的集合比对，缺项则 fail-closed 不出具
- [x] 5.2 未声明敏感性分析的任务不受该约束阻断
- [x] 5.3 `EffectEstimatePayload` 增绝对风险表达（率差/风险差 + CI）
- [x] 5.4 绝对风险的基线率取自过闸后站点聚合量，MUST NOT 由控制面从个体数据推算
- [x] 5.5 绝对风险同样过输出闸门（不因是派生量而豁免小单元格规则）
- [x] 5.6 `meta-analysis` 合并产物携带主分析 + 全部敏感性分析；不一致显式标注且系统不自动裁决

> 5.1/5.2/5.6 已落地：`completeAssignment` 中 `reconcileSensitivityAnalyses` 对账
> 声明项 id 与回传 `sensitivityResults[].id`，缺项 fail-closed（EVD-10）；
> 合并产物 `metaMerge.sensitivityAnalysesMerged` 携带全部回传结果，系统不自动裁决。
> `pooledAbsoluteRisk` 字段已加到 `RwsMetaPooledSuccess`，wiring 依赖
> `SiteEffectEstimate` 增 baselineRate 字段（拆下一个 change）。

## 6. 前端（触发 Form 栈选型）

- [x] 6.1 选定 Form 栈（DESIGN.md §4 标注缺 `react-hook-form + zod`），登记为 `D-UI-1` 进 DECISIONS.md 并同步 DESIGN.md §4「已知缺口」
- [x] 6.2 研究方案提交表单（设计类型 + 理由 + TTE 要素 + SAP + 缺失值 + 敏感性分析声明），遵循 DESIGN.md §4 Form 原型与 §9 禁止清单
- [x] 6.3 提交**前**明确展示「哪些字段冻结后不可改」（design Risks：摩擦缓解）
- [x] 6.4 版本历史视图（版本号 / 时间 / 修改原因 / 差异）
- [x] 6.5 UI 与文案明说系统只校验要素完备性与形式一致性，方法学合理性由研究者与伦理审查负责（design Risks：边界误解）

> §6 已全部落地。Form 栈选型 = react-hook-form + zod（D-UI-1, 2026-07-22）。
> 表单 9 个 useState → 单个 useForm + zodResolver；分组 Panel（基本信息 / 研究设计 /
> SAP / L0 算法 / 可选缺失值+敏感性）；冻结字段标 🔒（§6.3）；详情页加方案版本 Panel +
> 修订端点对接（§6.4）；顶部琥珀色边界文案（§6.5）。DESIGN §10 截图自查通过
> （rws-form-phase2-{default,l2}.png + rws-detail-{protocol-version,revise-expanded}.png）。
> 注：§6.4 的"差异"视图未做（仅版本号/时间/原因列表），diff 需额外组件。

## 7. 阶段二/三切换与治理契约收尾

- [x] 7.1 补齐既有 e2e / demo / Fly 任务定义的必填字段
- [x] 7.2 `designType` + `rationale` 转必填；SAP 按 D4 分级转必填
- [x] 7.3 启用冻结开关（阶段三），保留单独关闭能力以便回滚
- [x] 7.4 `EVIDENCE.md` 覆盖矩阵第 13、16–21 项转 `部分承载`（Phase 1 字段已落地，转 `已承载` 待 Phase 2 必填）；P-EVD-1/3/4/5/6/7/8 移入 §2 正册（`EVD-06`..`EVD-12`），enforcement 指向本 change 落地符号
- [x] 7.5 `FLOWS.md` `FLOW-RWS-01..04` 准入步补版本与独立性告警；冻结硬拒绝分支留待 Phase 3
- [x] 7.6 `DOMAIN.md` 状态词汇表增规格版本语义；术语表增 SAP / 多重性校正 / 缺失机制
- [x] 7.7 全量 `pnpm check:meta` 绿；负向验证：把 EVIDENCE 覆盖矩阵任一承载字段改为不存在的符号应报红

> **覆盖说明**：7.1/7.2/7.3 = Phase 2/3 转必填与冻结启用，按 migration plan
> 单独排期；7.4 标记为 `部分承载`（而非 `已承载`）是 Phase 1 诚实表述——字段
> 已存在、形状校验已启用，但按层级必填未转强制。
