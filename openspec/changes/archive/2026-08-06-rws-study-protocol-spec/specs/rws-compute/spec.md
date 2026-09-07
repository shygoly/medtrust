## MODIFIED Requirements

> Delta 说明：本文件叠加于未归档 change `federated-data-space-rws` 与 `rws-analytics-ladder` 定义的 `rws-compute`，归档时统一 reconcile。下列 MODIFIED requirement 的原文取自 `federated-data-space-rws/specs/rws-compute/spec.md`，已按本 change 补全。

### Requirement: RWS 任务定义与发起

药企(数据使用方)SHALL 通过其连接器发起 RWS 任务,任务 MUST 包含队列定义、分析逻辑、目标参与方、声明目的。

任务 MUST 另行声明**研究方案要素**（《指导原则》§1 方案先行）：流行病学设计类型（`designType`，六值封闭集：横断面 / 队列 / 病例对照 / 巢式病例对照 / 病例队列 / 病例交叉）与**选型理由**（`rationale`，必填自由文本）。系统 MUST NOT 内置设计类型的优劣排序——规范 §2.5 明示"不推荐认定某设计一定优于其他"，系统只强制"选了就要说理由"。

任务规格 MUST 携带方案版本（`protocolVersion`）；版本变更 MUST 记录修改原因（`revisionReason`）与修改时间（§1.2 留痕四要素）。

#### Scenario: 任务发起
- **WHEN** 药企提交一个包含队列定义与分析逻辑的 RWS 任务
- **THEN** 中心控制面 MUST 接收任务并进入合约/授权校验流程

#### Scenario: 缺设计类型或理由被拒
- **WHEN** 提交的任务未声明 `designType` 或未填写 `rationale`
- **THEN** 控制面 MUST 拒绝该任务并指明缺失要素

#### Scenario: 设计类型无优劣排序
- **WHEN** 用户选择任一合法的 `designType`
- **THEN** 系统 MUST NOT 提示该选择优于或劣于其他设计类型

#### Scenario: 版本变更必须带原因
- **WHEN** 一个已冻结任务的规格被修改并提交为新版本
- **THEN** 系统 MUST 要求 `revisionReason` 非空，否则拒绝

## ADDED Requirements

### Requirement: 规格冻结于首次派发

RWS 任务规格 SHALL 在**首次向任一连接器派发 assignment 时**冻结。冻结集 MUST 包含影响分析结论的字段：`designType`、`rationale`、`tte` 全部子字段、`matchingCovariates`、`allowedArtifacts`、SAP、缺失值策略、敏感性分析声明。冻结后对上述字段的修改 MUST 被拒绝，只能创建新版本。

描述性字段（标题、说明）与目标参与方列表 MUST NOT 纳入冻结集——前者变更不影响结论，后者可能因合约撤销而合法减少（D-DC-1 补偿语义）。

理由：提交到派发之间存在合法的准入失败与修正窗口；一旦派发即意味着连接器将读取本地数据，此后任何规格变更都构成"看到数据后改方案"。

#### Scenario: 派发前可自由修改
- **WHEN** 一个已提交但尚未派发的任务被修改 `matchingCovariates`
- **THEN** 修改 MUST 被接受，且 MUST NOT 产生新版本

#### Scenario: 派发后修改被拒
- **WHEN** 一个已派发的任务被修改 `matchingCovariates`
- **THEN** 系统 MUST 拒绝该修改，并提示需创建新版本

#### Scenario: 描述性字段派发后仍可改
- **WHEN** 一个已派发的任务被修改标题
- **THEN** 修改 MUST 被接受，MUST NOT 要求新版本

### Requirement: 结局定义独立于暴露

任务准入 SHALL 校验结局定义与暴露定义的独立性（《指导原则》§2.7.4 硬要求：药品暴露不应作为结局定义的组成部分）。当结局与暴露以 `IdentificationAlgorithm` 结构化引用表达时（见 [[algorithm-validation]]），系统 MUST 校验两者引用的算法标识与编码集**无交集**，有交集则 MUST 拒绝执行（fail-closed）。

当规格仍为自由文本时，系统 MUST 降级为警告而非阻断——自由文本下该性质不可判定，硬阻断会产生假阳性并诱使用户绕过校验。

#### Scenario: 结构化引用下交集被拒
- **WHEN** 某任务的结局定义与暴露定义引用了同一个编码集
- **THEN** 控制面 MUST 拒绝执行该任务并指出交集所在

#### Scenario: 结构化引用无交集通过
- **WHEN** 结局与暴露引用的算法与编码集无交集
- **THEN** 校验 MUST 通过

#### Scenario: 自由文本降级为警告
- **WHEN** 某任务的结局与暴露仍为自由文本
- **THEN** 系统 MUST 放行并附独立性未校验的警告，MUST NOT 阻断

### Requirement: 统计分析计划按层级分级必填

L2 / L3 / L4 任务 SHALL 声明统计分析计划（SAP）：显著性水平、检验效能、样本量假设与计算依据（《指导原则》§3.1、§3.2）。L1.5 单纯信号检测 MUST 豁免检验效能与样本量声明——它是假设生成而非假设检验。

**多重性 α 校正**按"是否涉及多重比较"判定而非按层级：任何涉及多亚组比较或多组比较的任务（含 L1.5 扫描多个药-事件组合）MUST 声明 α 校正方式或其他多重检验控制方法。

#### Scenario: L3 缺 SAP 被拒
- **WHEN** 提交一个未声明 SAP 的 L3 因果任务
- **THEN** 控制面 MUST 拒绝并指明缺失项

#### Scenario: L1.5 单信号豁免 SAP
- **WHEN** 提交一个单一药-事件组合的 L1.5 任务且未声明检验效能
- **THEN** 任务 MUST 被接受

#### Scenario: L1.5 多组合须声明 α 校正
- **WHEN** 提交一个扫描多个药-事件组合的 L1.5 任务且未声明 α 校正方式
- **THEN** 控制面 MUST 拒绝并要求声明多重性控制方法

### Requirement: 缺失值机制与填补策略同时声明

任务规格 SHALL 声明缺失值处理（《指导原则》§3.4）：缺失机制假设（MCAR / MAR / MNAR）与填补策略 MUST 同时声明，MUST NOT 只声明其一——填补方法的适用性取决于机制假设，单独声明任一方都不足以判断处理是否恰当。

#### Scenario: 只声明填补方法被拒
- **WHEN** 任务声明了多重填补但未声明缺失机制假设
- **THEN** 控制面 MUST 拒绝并要求补齐机制假设

#### Scenario: 二者齐备通过
- **WHEN** 任务同时声明了 MAR 假设与多重填补策略
- **THEN** 校验 MUST 通过

### Requirement: 报告口径含绝对风险

风险估计结果 SHALL 同时包含绝对风险与相对风险的点估计、P 值与置信区间（《指导原则》§3.1）。仅有相对量的结果 MUST NOT 出具——相对风险在低基线率下会严重误导，而药品安全性信号常处于低基线区间。

绝对风险的出域 MUST 同样通过输出闸门（它是聚合量，但可能触及小单元格）。

#### Scenario: 缺绝对风险不出具
- **WHEN** 某 L2 任务的合并结果只含 OR 及其 CI
- **THEN** 系统 MUST NOT 出具该结果，直至补齐绝对风险表达

#### Scenario: 绝对风险须过闸门
- **WHEN** 绝对风险的计算依赖某个低于抑制阈值的基线计数
- **THEN** 输出闸门 MUST 按既有小单元格规则处理，MUST NOT 因其为"派生量"而豁免
