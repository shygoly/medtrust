## ADDED Requirements

### Requirement: 算子清单
每个算子 SHALL 以清单登记在注册中心。清单字段包括：
- `id`、`version`、`kind`、`category`、`digest`；
- 输入：可接受的等级与 schema；
- 输出：等级规则，`inherit` 或声明等级；
- 参数 schema、可运行环境、`security.network`、发布方。

清单 MUST 由注册中心密钥签名。非 `declassify` 类算子的输出规则 MUST 为 `inherit`。除协同类算子外，`security.network` MUST 为 `none`。

#### Scenario: 非降密算子声明降级
- **WHEN** 一份 `local` 类清单把输出规则写成固定的 C3
- **THEN** 注册中心 MUST 拒绝登记

#### Scenario: 清单签名无效
- **WHEN** 连接器收到的清单签名不能用部署固定的注册中心公钥验证
- **THEN** 连接器 MUST 拒绝使用该清单，并记录审计

### Requirement: 算子类型
算子的 `kind` SHALL 取以下三类之一：
- `wasm`：`digest` 为模块 SM3；
- `oci`：`digest` 为镜像摘要，本期不启用；
- `system`：连接器或平台自带的机制，以 `id@version` 加组件构建版本标识。

承载受托分析逻辑的算子 MUST 是 `wasm` 或 `oci`。`system` 算子 MUST 只属于 `source`、`declassify`、合并这三类机制。

#### Scenario: system 算子冒充分析算子
- **WHEN** 有人试图把一个 `local` 类分析算子登记为 `system`
- **THEN** 注册中心 MUST 拒绝登记

#### Scenario: 本期不启用 oci
- **WHEN** 计划引用了一个 `kind: oci` 的算子
- **THEN** 编译 MUST 以 `E_CAPABILITY_MISMATCH` 失败

### Requirement: wasm 算子准入来源
`wasm` 算子的摘要 SHALL 来自既有的第三方算法准入流程：源码-only、平台用锁定工具链复现构建，并过完五道闸（D-CN-5）。复现构建不出的摘要 MUST NOT 登记为算子。

#### Scenario: 未经复现构建的模块
- **WHEN** 有人提交一个没有复现构建记录的 wasm 摘要申请登记
- **THEN** 注册中心 MUST 拒绝登记

### Requirement: 连接器本地白名单
每个连接器 SHALL 维护本地的算子白名单，缺省为空。
- 只能由医院在本地（CLI）按摘要加入或移除；平台 MUST NOT 有远程修改白名单的途径。
- 复核与执行都 MUST 要求算子摘要在本地白名单中，否则以 `E_OP_NOT_WHITELISTED` 拒绝。

#### Scenario: 摘要不在白名单
- **WHEN** 片段中某算子的摘要不在本院白名单里
- **THEN** 连接器 MUST 以 `E_OP_NOT_WHITELISTED` 拒绝该片段

#### Scenario: 平台无法远程加白
- **WHEN** 平台下发任何消息，试图把一个摘要加入某院白名单
- **THEN** 连接器 MUST 忽略该内容，白名单不变

### Requirement: 签名吊销名单同步
平台 SHALL 用平台节点密钥签名算子吊销名单，随长轮询下发。连接器必须满足：
- MUST 验签；
- MUST 持久化保存；
- MUST 只接受版本号更高的名单；
- 启动后在收到并验过一份有效名单之前，MUST 拒绝执行任何 `wasm` 算子。

被吊销的算子在复核与执行时 MUST 以 `E_OP_REVOKED` 拒绝。

#### Scenario: 吊销后拒绝
- **WHEN** 某算子摘要出现在已验签的吊销名单里
- **THEN** 连接器 MUST 在复核和执行时都以 `E_OP_REVOKED` 拒绝

#### Scenario: 版本回退
- **WHEN** 连接器收到一份版本号低于本地已存版本的吊销名单
- **THEN** 连接器 MUST 拒收，继续使用本地版本

#### Scenario: 重启后尚未同步
- **WHEN** 连接器重启后还没收到有效吊销名单，就收到了执行 wasm 算子的指令
- **THEN** 连接器 MUST 拒绝执行

### Requirement: 能力通告
连接器 SHALL 在启动时和每次心跳时发送 `CapabilityAdvertise`，内容包括：可用运行时、`system` 算子版本、白名单摘要集合、TEE 证明能力、协同协议版本。编译器 MUST 只把阶段放在通告了所需能力的节点上。

#### Scenario: 未通告能力的节点
- **WHEN** 某节点的通告中没有 TEE 能力，而计划要求以它为 C2 目标
- **THEN** 编译 MUST 以 `E_CAPABILITY_MISMATCH` 失败
