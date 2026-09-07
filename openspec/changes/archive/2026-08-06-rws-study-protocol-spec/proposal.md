## Why

药监《真实世界数据支持药品安全性主动监测的研究设计和分析指导原则》（征求意见稿）对研究方案有两条贯穿全文的硬要求：**方案先行**（§1，初始方案须在数据收集前完成，任何实质性修改须留痕：版本号+日期+内容+原因）与**预先设定**（§3.1 SAP 事先制订；附1·2 监管要点明示"建议预先指明用于构建倾向评分模型的变量，避免为获得理想结果而反复调整模型"）。这两条对抗的是同一件事：**事后调整分析以迎合期望结果**（p-hacking）与**选择性报告**。

本仓的 RWS 任务规格目前**无法承载也无法约束**这些（[EVIDENCE.md](../../../EVIDENCE.md) 待接入项 P-EVD-1/3/4/5/6/7/8，覆盖矩阵第 13、16–21 项缺口）：`cp_rws_task` 无版本字段（改了无痕）；`matchingCovariates` 可随时改（PS 变量无锁）；SAP、敏感性分析、缺失值策略、流行病学设计类型均无字段；`outcome.event` 与 `exposureArm` 都是自由文本，**结局定义混入暴露状态（§2.7.4 硬红线）无任何校验**。

现在做的理由：这些约束的价值全在"事前"——任务一旦执行完再补版本号和 SAP 就毫无意义。每多跑一个 RWS 任务，就多一份不可追溯的研究记录。

## What Changes

- **研究方案成为版本化对象**：`cp_rws_task` 增 `protocolVersion` + `revisionReason` + `revisedAt`；已进入执行的任务其规格 MUST 不可变，修改 = 新版本 + 必填理由（§1.2）。
- **预先指定并锁定**（§3.1、附1·2）：`matchingCovariates`（PS 变量）与 `allowedArtifacts` 在任务提交时冻结；执行开始后变更 MUST 被拒绝，只能开新版本。这把既有的 `allowedArtifacts` PEP 白名单（`EVD-01`）从"授权边界"扩展为"防 p-hacking 边界"。
- **结局定义独立于暴露**（§2.7.4 硬要求，P-EVD-1）：任务准入校验 `outcome.event` 引用的变量 MUST NOT 包含 `exposureArm` / `comparatorArm` 所指的暴露定义；违反则拒绝执行（fail-closed）。
- **流行病学设计类型显式化**（§2.5，P-EVD-8）：新增 `designType` 六值封闭集（横断面/队列/病例对照/巢式病例对照/病例队列/病例交叉，值域已在 EVIDENCE.md §4 预登记）+ **必填选型理由**；规范明示"不推荐认定某设计一定优于其他"，故系统 MUST NOT 内置优劣排序，只强制"选了就要说理由"。
- **SAP 成为规格的一等部分**（§3.1/§3.2，P-EVD-5）：显著性水平、检验效能、样本量假设与计算依据、多重性 α 校正方式（涉及多亚组或多组比较时必填）。
- **缺失值声明**（§3.4，P-EVD-7）：缺失机制假设（MCAR/MAR/MNAR）+ 填补策略，二者 MUST 同时声明。
- **敏感性分析全报**（§3.5，P-EVD-6）：spec 中声明的每一项敏感性分析，其结果 MUST 全部随主分析回传；缺项则结果 MUST NOT 出具（对抗选择性报告）。
- **报告口径**（§3.1）：风险估计 MUST 同时给出绝对风险与相对风险的点估计、P 值、置信区间——当前 `EffectEstimatePayload` 只有相对量（`log_or`/`log_hr`/`ate` + CI），缺绝对风险。

**BREAKING**：`RwsAnalysis` 新增必填字段（`designType` + `rationale`；L2/L3 任务另需 SAP）。既有 e2e 与 demo 的任务定义须补齐字段。L1.5 单纯信号检测可豁免 SAP（在 spec 中明确豁免条件）。

**Non-Goals**：
- 不做 SAP 的内容正确性判断（系统校验"是否声明"，不判断"统计方案是否科学合理"——那是人的责任）。
- 不实现 P-EVD-9（阴性结果重审检验效能）的自动化——它是结果出具环节的人工评审项，本 change 只在报告模板中留出位置。
- 不引入 DAG 结构化（协变量类型区分：时依混杂/中介/效应修饰/碰撞）——单独评估，见 Impact。

## Capabilities

### Modified Capabilities
- `rws-compute`: 研究规格从"分析参数集合"升级为"可版本化、可锁定、要素完备的研究方案对象"；新增设计类型、SAP、缺失值、敏感性分析声明；新增结局-暴露独立性准入校验。（当前定义于未归档 change `federated-data-space-rws` + `rws-analytics-ladder`，本 change 的 delta 叠加其上，归档时统一 reconcile。）
- `usage-control`: 预先指定字段的冻结语义（执行后变更拒绝）；敏感性分析缺项时阻断结果出具。（同上。）
- `federated-meta-analysis`: 合并结果须携带主分析与全部声明的敏感性分析；报告口径新增绝对风险。（同上。）

### New Capabilities
（无。本 change 是既有能力的规格硬化，不引入新能力。）

## Impact

- **代码**
  - `apps/connector` — `types.ts` 的 `TteSpec` / `RwsAnalysis` 扩展（设计类型、SAP、缺失值、敏感性分析声明）；`policy-enforcement` 增冻结校验。
  - `apps/api` — `runtime/rws-orchestrator` 的 DTO 与准入校验（结局-暴露独立性、必填字段、冻结检查）；`rws-persistence` 版本列；`meta-analysis` 报告口径扩展。
  - `packages/database` — `cp_rws_task` 增版本三列；`cp_rws_assignment` 关联规格版本。
  - `apps/web` — 任务提交表单大改（当前 DESIGN.md §4 标注 Form 原型栈未定、缺 `react-hook-form + zod`，本 change 会触发该选型；见 DESIGN.md §4「已知缺口」）。
- **治理契约（必须同步，`pnpm check:meta` 强制）**
  - `EVIDENCE.md` — 覆盖矩阵第 13、16–21 项转 `已承载`，第 6、7、8 项由 `部分承载` 升级；P-EVD-1/3/4/5/6/7/8 移入 §2 正册（预计新增 `EVD-06`..`EVD-12`）；§4 值域预登记转为实装引用。
  - `DOMAIN.md` — 状态词汇表增规格版本语义；术语表增 SAP、多重性校正、缺失机制三类。
  - `FLOWS.md` — `FLOW-RWS-01..04` 的准入步补版本冻结与独立性校验；新增"规格修订"分支。
  - `DECISIONS.md` — 若 Form 栈选型落定（`react-hook-form + zod`），登记为 `D-UI-1`。
- **迁移**：SQLite `synchronize` 环境下新列自动生效；存量 `cp_rws_task` 行需回填 `protocolVersion = 1`。
- **待评估（可能拆下一个 change）**：DAG 结构化协变量分类（§2.7.5，覆盖矩阵第 8 项的完全承载）。它引入图结构与因果语义，复杂度与本 change 的"字段硬化"不同质，倾向单独立项。
