## ADDED Requirements

> Delta 说明：本文件叠加于未归档 change `federated-data-space-rws` 与 `rws-analytics-ladder` 定义的 `rws-compute`，归档时统一 reconcile。本 change 对既有 L1.5–L4 行为**无修改**，故全部使用 ADDED。

### Requirement: L0 算法验证分析类型

`rws-compute` SHALL 新增 `algorithm-validation` 分析类型与 `L0` 分析层级。L0 的定位是**其他层的前置**：L1.5–L4 所用的人群与结局识别算法，其准确性由 L0 给出。L0 任务 MUST 在连接器 TEE 内本地执行，且 MUST 只输出 2×2 混淆矩阵（见 [[algorithm-validation]]）。

#### Scenario: L0 任务被路由到验证执行器
- **WHEN** 一个 `analysisType = algorithm-validation` 的任务下发到连接器
- **THEN** 连接器 MUST 路由到算法验证执行器，MUST NOT 走 L1.5–L4 的估计量路径

#### Scenario: L0 不改变既有层行为
- **WHEN** 一个 L1.5 / L2 / L3 / L4 任务在本 change 落地后执行
- **THEN** 其产物与出域约束 MUST 与本 change 之前完全一致

### Requirement: 研究规格可引用识别算法替代自由文本

`rws-compute` 的研究规格 SHALL 允许人群纳排与结局定义引用 `IdentificationAlgorithm` 标识，作为自由文本的替代表达。当规格引用算法时，系统 MUST 记录所引用的算法版本，使该任务的操作性定义可追溯。

自由文本形式在本 change 中 MUST 继续被接受（不破坏既有任务）；两种形式的取舍与强制时点见 `rws-study-protocol-spec` change。

#### Scenario: 规格引用算法并记录版本
- **WHEN** 一个 RWS 任务的结局定义引用了某识别算法
- **THEN** 任务记录 MUST 保存该算法的标识与版本

#### Scenario: 自由文本规格仍可执行
- **WHEN** 一个既有任务的纳排仍为自由文本
- **THEN** 该任务 MUST 正常执行，MUST NOT 因未引用算法而被拒

### Requirement: 已验证算法的准确性随报告带出

当一个 L1.5–L4 任务引用的识别算法在该数据源已有验证结果时，任务报告 SHALL 附带该算法的准确性指标（Se / Sp / PPV / NPV + 95%CI）。本 change 中，引用**未验证**算法 MUST NOT 阻断任务执行（渐进策略，见 design D5）。

#### Scenario: 有验证结果时自动附带
- **WHEN** 某 L2 任务引用的算法在该数据源已有有效验证结果
- **THEN** 该任务报告 MUST 包含该算法的准确性指标

#### Scenario: 无验证结果不阻断执行
- **WHEN** 某 L2 任务引用的算法尚无验证结果
- **THEN** 任务 MUST 正常执行，报告 MUST 明确标注该算法准确性未知
