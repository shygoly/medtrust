## MODIFIED Requirements

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

## ADDED Requirements

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
