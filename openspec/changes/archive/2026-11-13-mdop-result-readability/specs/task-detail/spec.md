# Spec Delta

## ADDED Requirements

### Requirement: 配对队列聚合计数可读展开
当合并结果的分析类型为配对队列（如 `paired-cohort`）且 payload 含队列规模与暴露/结局聚合计数时，详情结果区 SHALL 以可读表格或等价结构展示这些计数（至少包括队列规模、暴露人数、结局人数、暴露且出现结局），并给出一句基于粗率比较的方向摘要（或「无法比较」说明）。MUST NOT 仅用「队列 n=…」类单行作为唯一展示。缺字段时该列回退「—」，MUST NOT 用 0 冒充缺失。

#### Scenario: 四计数齐全时展开
- **WHEN** 平台合并结果为 `paired-cohort`，且含 `cohortSize`、`exposed`、`outcome`、`exposedWithOutcome` 数值
- **THEN** 结果区 MUST 展示上述计数的可读指标，并 MUST 有一句暴露相对未暴露的粗率方向或无法比较说明
- **AND** MUST NOT 仅显示队列规模一行而无暴露/结局计数

#### Scenario: 缺计数不伪造
- **WHEN** `paired-cohort` 结果缺少任一必需计数字段
- **THEN** 结果区 MUST NOT 用数值 0 填补缺失计数冒充完整四格；MAY 回退摘要或「—」并保持已有字段可见

### Requirement: 联邦预测指标中文标签与结论摘要
当合并结果为联邦预测（如 `fl-prediction` 或含跨院合并模型指纹的等价 payload）时，详情结果区 SHALL 用中文（或登记产品名）标签展示已有聚合指标（如 AUC、F1、精确率、召回率、准确率）与训练轮次；结论摘要 MUST 含一句面向研究者的完成度/主指标说明。模型哈希等技术指纹 MAY 次要展示，MUST NOT 作为对研究者的唯一主文案。各方贡献表的列名 MUST 可读。

#### Scenario: 聚合指标不裸奔英文键
- **WHEN** 合并结果含 `aggregateMetrics`（或等价）中的 auc/f1 等数值
- **THEN** 结果区 MUST 以可读中文标签呈现这些指标，MUST NOT 仅以 `auc=… f1=…` 单行堆叠作为唯一展示

#### Scenario: 摘要含结论一句
- **WHEN** 联邦预测结果含轮次完成信息或主聚合指标
- **THEN** 结论摘要 MUST 包含一句可读完成度或主指标说明（例如轮次进度与主指标），MUST NOT 仅展示模型类型英文枚举

#### Scenario: 模型哈希次要
- **WHEN** 结果含 `modelHash`
- **THEN** 模型哈希 MUST NOT 作为结果区唯一主文案；MAY 以次要 mono 展示

### Requirement: 外对照注册结果术语可注解
外对照注册（`external-control-registration`）结果面板 SHALL 对面向研究者的关键术语提供可读注解（悬停说明、图例或并列中文名至少一种），覆盖至少：Estimand/Estimator、SMD、倾向评分（PS）、有效样本量（EES）、缺失机制（MCAR/MAR/MNAR）。效应量主文案 MUST 保持可读（如风险比/风险差中文或登记文案）。MUST NOT 要求用户仅凭英文缩写理解面板。注解不得改变数值或诊断判定语义。

#### Scenario: 关键术语有说明入口
- **WHEN** 用户查看含平衡（SMD）与 overlap/权重诊断的外对照注册结果
- **THEN** SMD 与倾向评分/有效样本量相关标签 MUST 具备可读注解入口（title、旁注或图例）
- **AND** 效应量主文案 MUST NOT 仅输出未解释的 `risk-ratio` / `risk-difference` 英文枚举作为唯一文案

#### Scenario: 缺失机制可读
- **WHEN** 结果声明缺失机制为 MCAR、MAR 或 MNAR
- **THEN** 面板 MUST 展示可读中文名或并列说明，MUST NOT 仅输出三字母缩写作为唯一文案

### Requirement: SCRI 分层计数之上有效应解读
当合并结果为疫苗 SCRI（`vaccine-scri`）且含风险期/对照期窗口与分层事件计数时，详情结果区 SHALL 在分层计数表之上提供效应解读：对未抑制且事件可计算的分层，展示相对发生率（或等价比值）方向/点估计及可得置信区间；无法计算时 MUST 明示「不可估计」（或等价），MUST NOT 显示 0 或 ∞ 冒充。摘要 MUST NOT 仅写「N 个分层」而无窗口或总体方向提示。分层键在有登记映射时 MUST 可读。

#### Scenario: 可计算分层展示相对发生率
- **WHEN** 某分层未抑制，且风险期与对照期事件计数及窗口天数足以计算相对发生率
- **THEN** 该分层（或汇总行）MUST 展示可读的相对发生率（或方向+点估计），MAY 含置信区间

#### Scenario: 不可估计不伪造
- **WHEN** 分层总事件为 0，或对照期事件为 0，或窗口缺失导致无法计算
- **THEN** 界面 MUST 显示「不可估计」或等价说明，MUST NOT 用 0 或 ∞ 作为相对发生率主值

#### Scenario: 摘要含窗口提示
- **WHEN** SCRI 结果含 `windows.risk` 与 `windows.control`
- **THEN** 结论摘要或结果区顶部 MUST 呈现可读的风险期/对照期说明，MUST NOT 仅显示分层个数
