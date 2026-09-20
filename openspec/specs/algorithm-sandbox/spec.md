# algorithm-sandbox Specification

## Purpose
TBD - created by archiving change connector-wasm-sandbox-disproportionality. Update Purpose after archive.
## Requirements
### Requirement: 算法模块运行前双重校验
连接器 SHALL 在执行任何 Wasm 算法模块之前完成两项相互独立的校验：一是模块字节的 SM3 必须等于数字合约为该分析类型固定的 SM3；二是模块的 SM2 签名必须能用部署配置中固定的平台 CA 公钥（`CONNECTOR_PLATFORM_CA_PUBKEY`）验证通过。平台公钥 MUST NOT 从控制面任务通道获取。任一校验失败，连接器 MUST 拒绝执行并判任务失败，MUST NOT 回退到非沙箱实现。

#### Scenario: SM3 与合约固定值不符
- **WHEN** 连接器取得的模块字节的 SM3 与合约固定的 SM3 不一致
- **THEN** 连接器 MUST 拒绝执行、任务失败，并记录 `sandbox-fail` 审计，且 MUST NOT 改走 TS 实现

#### Scenario: 签名无法验证
- **WHEN** 模块 SM3 与合约一致，但签名不能用部署固定的平台 CA 公钥验证
- **THEN** 连接器 MUST 拒绝执行、任务失败，并记录 `sandbox-fail` 审计

#### Scenario: 双重校验通过
- **WHEN** 模块 SM3 与合约一致，且签名验证通过
- **THEN** 连接器 MUST 进入零能力实例化检查，且仅当该检查也通过后才执行模块

### Requirement: 零能力实例化
连接器 SHALL 只实例化满足以下条件的模块：导入恰好为一块由宿主提供、声明了上限的线性内存（`env.memory`）；导出包含 `run` 函数和常量全局 `abi_version`，且其值为连接器支持的 ABI 版本。含其他任何导入（函数、表、全局量、WASI 等）的模块 MUST 被拒绝。

#### Scenario: 模块导入了函数
- **WHEN** 待运行模块除 `env.memory` 外还导入了任何函数
- **THEN** 连接器 MUST 在实例化前拒绝，任务失败

#### Scenario: ABI 版本不受支持
- **WHEN** 模块导出的 `abi_version` 不是连接器支持的版本
- **THEN** 连接器 MUST 拒绝执行，任务失败

### Requirement: 资源上限与超限失败
连接器 SHALL 在独立的 worker 线程中运行模块，worker 不继承宿主环境变量。超过执行时限（`CONNECTOR_SANDBOX_TIMEOUT_MS`）MUST 终止 worker，任务判为失败。所需内存超过上限（`CONNECTOR_SANDBOX_MAX_MEMORY_MB`）MUST 在调用前拒绝。任何超限 MUST NOT 回退到非沙箱实现。

#### Scenario: 死循环被终止
- **WHEN** 模块的 `run` 在时限内不返回
- **THEN** 连接器 MUST 终止该 worker、任务失败并记录 `sandbox-fail` 审计，连接器进程继续正常服务

#### Scenario: 输入超过内存上限
- **WHEN** 按行数与事件词条数算出的所需内存超过上限
- **THEN** 连接器 MUST 在调用模块之前拒绝并给出明确原因

### Requirement: 最小列投影输入
连接器 SHALL 只向沙箱传入该分析类型所需的最小整数标记列（L1.5：是否入组、是否暴露、每个事件词条是否发生）。投影 MUST 在本地库守卫（`aggregateInternal`）内完成。词条文本、主体标识及其他任何字段 MUST NOT 进入沙箱内存。

#### Scenario: 沙箱内存不含文本与标识
- **WHEN** 一次 L1.5 任务进入沙箱执行
- **THEN** 写入模块内存的只有 0/1 标记与计数，不含词条文本、主体标识或其他记录字段

### Requirement: 输出不变量校验
连接器 SHALL 对模块输出校验不变量：每个词条的 `a+b` 等于入组内用药人数、`c+d` 等于入组内未用药人数，所有格值非负，`cohortSize` 不超过输入行数。违反任一项 MUST 判任务失败。

#### Scenario: 模块输出自相矛盾
- **WHEN** 模块返回的某个词条 `a+b` 不等于入组内用药人数
- **THEN** 连接器 MUST 判任务失败并记录 `sandbox-fail` 审计，不回传结果

### Requirement: 沙箱运行写入本地审计
连接器 SHALL 为每次沙箱运行写入本地审计：成功记 `sandbox-run`（模块 SM3、ABI 版本、耗时、内存页数），失败记 `sandbox-fail`（失败原因）。

#### Scenario: 成功运行留痕
- **WHEN** 一次沙箱运行成功返回
- **THEN** 本地审计 MUST 出现一条含该模块 SM3 的 `sandbox-run` 记录

### Requirement: 模块可复现构建
平台 SHALL 以仓库内源码和锁定版本的编译器构建算法模块，构建清单记录分析类型、ABI 版本、SM3 与编译器版本。任何人用同一源码和同一编译器版本重新构建，MUST 得到相同的 SM3。

#### Scenario: 重新构建得到相同指纹
- **WHEN** CI 以锁定编译器从源码重新构建失衡检测模块
- **THEN** 产物 SM3 MUST 与入库清单中的 SM3 一致，否则构建失败

