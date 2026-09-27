## Purpose

定义真实世界研究（RWS）任务的定义、下发与执行：分析分级（L1.5 信号 / L2 比较 / L3 因果 / L4 预测）、两种联邦执行模式、本地 TEE 计算与充分统计量出域、结果回传与上链存证。
## Requirements
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

### Requirement: 合约与授权校验
中心控制面 SHALL 在下发任务前校验该任务在每个目标参与方处是否存在生效的使用控制策略;任一参与方无生效授权时,任务 MUST NOT 下发到该参与方。

#### Scenario: 缺授权不下发
- **WHEN** RWS 任务的某目标医院不存在生效的使用控制策略
- **THEN** 中心控制面 MUST 不向该医院连接器下发任务,并向发起方返回原因

### Requirement: 本地 TEE 执行
连接器 SHALL 在本地对脱敏数据执行 RWS 分析逻辑，原始行数据 MUST NOT 离开连接器。计算经由可插拔 TEE 抽象执行。当前实现为 SoftwareSealedCompute（软件级、同进程、无隔离、无远程证明），对外 MUST 如实表述为软件级，MUST NOT 表述为硬件可信执行环境。数字合约为某分析类型固定了算法模块时，该分析 MUST 在 Wasm 沙箱内执行（见 `algorithm-sandbox`）；未固定时走连接器内置实现。联邦学习通道不在本要求范围。

#### Scenario: 软件级 TEE 抽象内执行
- **WHEN** 一个通过校验的 RWS 任务在连接器执行
- **THEN** 分析逻辑 MUST 在 TEE 抽象（当前为软件实现）内运行，原始数据 MUST NOT 离开连接器，本地审计 MUST 记录 `level=software isolation=none` 的运行证明

#### Scenario: 合约固定模块的 L1.5 在沙箱执行
- **WHEN** 一个 L1.5 失衡检测任务所依据的合约为 `disproportionality` 固定了模块 SM3
- **THEN** 连接器 MUST 以该模块在 Wasm 沙箱内计算 2×2 计数，MUST NOT 使用内置 TS 实现

#### Scenario: 未固定模块走内置实现
- **WHEN** 合约未为该分析类型固定模块
- **THEN** 连接器以内置实现计算，并 MUST 将执行隔离标注为 `none`

### Requirement: 输出闸门
连接器 SHALL 在计算结果离开前经输出闸门过滤;只有聚合统计/信号/模型参数可通过,行级原始数据 MUST NOT 通过。输出闸门 MUST 应用小单元格抑制(如计数小于阈值则抑制)。

#### Scenario: 小单元格抑制
- **WHEN** 计算输出包含计数小于阈值的单元格
- **THEN** 输出闸门 MUST 抑制该单元格后再放行

#### Scenario: 行级数据被拦截
- **WHEN** 计算输出中包含可识别到个体的行级数据
- **THEN** 输出闸门 MUST 阻止该输出离开连接器并记录审计

### Requirement: 结果回传与上链存证
RWS 任务完成后,连接器 SHALL 仅回传通过输出闸门的结果;中心控制面 MUST 将任务定义哈希、参与方、策略哈希、输入指纹、输出结果哈希、时间戳上链,链上 MUST NOT 包含任何医疗数据。

#### Scenario: 仅回传聚合结果
- **WHEN** 一个 RWS 任务在某医院连接器执行完成
- **THEN** 连接器 MUST 仅回传通过输出闸门的聚合结果,且不回传任何原始数据

#### Scenario: 存证内容不含数据
- **WHEN** 任务结果回传后触发上链存证
- **THEN** 链上记录 MUST 仅包含哈希/指纹/元数据,不含任何医疗数据明文

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

### Requirement: 执行隔离如实标注
连接器 SHALL 在每份聚合结果内部写入执行标注 `execution`：`isolation` 取 `none` 或 `wasm-sandbox`，沙箱执行时同时写入模块 SM3 与 ABI 版本。该标注 MUST 在规范化与计算结果 SM3 之前写入，从而受结果哈希保护。`attestationLevel` 与执行标注相互正交，本变更 MUST NOT 改变 `attestationLevel`（仍为 `software`）。控制面 SHALL 按每家医院的派发记录保存执行标注，任务级取所有医院中最弱的一级，写入存证元数据，并在任务详情中展示。

#### Scenario: 沙箱结果带标注且哈希通过
- **WHEN** 连接器回传一份在沙箱内算出的聚合结果
- **THEN** 结果内含 `execution.isolation = wasm-sandbox` 与模块 SM3，控制面对整份结果验 SM3 通过后入库，派发记录的 `executionIsolation` 为 `wasm-sandbox`

#### Scenario: 标注被篡改
- **WHEN** 回传途中结果内的执行标注被改动
- **THEN** 控制面验 SM3 失败并拒绝入库

#### Scenario: 旧版连接器无标注
- **WHEN** 回传的聚合结果不含 `execution`
- **THEN** 控制面 MUST 按 `none` 入库

#### Scenario: 非法标注值
- **WHEN** `execution.isolation` 不是 `none` 或 `wasm-sandbox`
- **THEN** 控制面 MUST 拒绝入库

#### Scenario: 任务级取最弱
- **WHEN** 一个任务中一家医院为 `wasm-sandbox`、另一家为 `none`
- **THEN** 任务级执行隔离 MUST 显示为 `none`

### Requirement: 沙箱与内置实现结果一致
对同一队列与同一目标药物，Wasm 沙箱路径 SHALL 产出与内置 TS 实现逐字段一致的 L1.5 聚合结果：`cohortSize`，以及每个词条的 `key`、`count`、`rate`、`b`、`c`、`d` 和词条顺序（`execution` 标注除外）。

#### Scenario: 同一数据两条路径一致
- **WHEN** 在合成数据集与注入信号数据集上分别用两条路径计算失衡检测
- **THEN** 去掉 `execution` 后两份结果 MUST 完全相等

