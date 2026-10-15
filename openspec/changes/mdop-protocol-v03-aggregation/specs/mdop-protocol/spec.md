## ADDED Requirements

### Requirement: 节点间安全聚合阶段

MDOP v0.3 SHALL 支持节点间安全聚合阶段，允许各参与方在不向平台暴露明文中间结果的前提下，
产出聚合后的 C3 总和。平台 MUST NOT 参与聚合计算，只路由密文贡献。

#### Scenario: 聚合阶段的三种消息

- **WHEN** 作业包含 `system.secure_aggregate` 算子
- **THEN** 平台 MUST 依次下发三种消息：
  1. `AggregateRequest`（平台 → 各节点）：聚合任务规格、参与方列表、超时
  2. `AggregateContribution`（节点 → 平台）：各节点上传加密后的本地贡献（密文 blob 句柄）
  3. `AggregateResult`（平台 → 各节点）：分发全部密文句柄，各节点下载、解密、本地聚合

#### Scenario: 平台只路由密文，不见明文

- **WHEN** 节点上传 `AggregateContribution`
- **THEN** 平台 MUST 只存储密文 blob 句柄（对象存储引用），MUST NOT 解密或读取明文内容

#### Scenario: 聚合超时拒绝整个作业

- **WHEN** 聚合阶段超时期限内，任一参与方未上传 `AggregateContribution`
- **THEN** 整个聚合阶段 MUST 进入 `REJECTED` 状态，MUST NOT 做 partial 合并（即不合并已提交方的贡献）

### Requirement: 算子 kind 扩展 `system.secure_aggregate`

算子清单 SHALL 支持第四种 kind：`system.secure_aggregate`（与 `wasm` / `oci` / `system` 并列），
用于标识节点间安全聚合算子。

#### Scenario: 聚合算子的标签约束

- **WHEN** 算子清单声明 `kind: "secure_aggregate"`
- **THEN** 该算子 MUST 满足：
  - 输入等级为 C1（密态，同协议参与方间流动）
  - 输出等级为 C3（可发布给合约接收方）
  - 编译期校验：违反此约束的计划 MUST 被拒绝，错误码 `E_LABEL_VIOLATION`

#### Scenario: 聚合算子在节点侧执行

- **WHEN** 执行器遇到 `kind: "secure_aggregate"` 的算子
- **THEN** 该算子 MUST 在节点内执行（解密各方密文、本地聚合），平台 MUST NOT 参与聚合计算

### Requirement: partial 参与语义显式定义

MDOP v0.3 SHALL 显式定义 partial 参与语义：任一参与方未回执（接受片段、产出制品、上传贡献）时，
整个作业 MUST 进入 `REJECTED` 状态，MUST NOT 产生平台侧结果。

#### Scenario: 与旧管线的语义区分

- **WHEN** MDOP 作业的某个阶段，有一个参与方未在超时前回执
- **THEN** 该作业 MUST 进入 `REJECTED`，MUST NOT 做 partial 合并（即不合并其余方的结果）
- **AND** 此行为与旧管线（RWS / FL legacy）互斥：旧管线允许 partial 合并并标注"部分参与"

#### Scenario: 聚合阶段的 partial 拒绝

- **WHEN** 聚合阶段的 `AggregateContribution` 收集期内，任一方未上传贡献
- **THEN** 聚合 MUST 进入 `REJECTED`，MUST NOT 把已收集的贡献进行聚合（否则泄露缺席方边界信息）

### Requirement: 节点间密文中继通道

MDOP v0.3 SHALL 支持节点间密文中继模式：各节点将本地贡献加密后上传平台，平台分发密文句柄，
各节点下载他院密文后本地解密与聚合。平台 MUST NOT 持有解密密钥。

#### Scenario: 密文上传与 TTL 清理

- **WHEN** 节点上传密文贡献（`POST /api/v1/mdop/aggregate/contributions`）
- **THEN** 平台 MUST 存储密文 blob 到对象存储，返回 `contributionRef`（存储句柄）
- **AND** 密文 blob MUST 在 72 小时后自动清理（TTL），不依赖手动删除

#### Scenario: 密文下载与解密

- **WHEN** 节点收到 `AggregateResult` 消息（含 `contributionRefs[]`）
- **THEN** 节点 MUST 下载各密文 blob，用本节点私钥解密，本地执行聚合算法
- **AND** 解密失败时，节点 MUST 拒绝该阶段并记录审计，MUST NOT 静默降级或使用默认值

## MODIFIED Requirements

### Requirement: 标签传播规则（v0.2 已有，补充聚合路径）

编译器与连接器复核 SHALL 在 v0.2 的传播规则之外接受一条聚合路径：`secure_aggregate` 的全部输入为 C1、清单声明输出为 C3 时，输出等级就是 C3。这条降级只属于该 kind，普通算子仍不得自行降级。

#### Scenario: 聚合算子的 C1 → C3 路径

- **WHEN** 编译器遇到 `secure_aggregate` 算子，其输入为 C1、清单声明输出为 C3
- **THEN** 编译器 MUST 接受该标签降级（C1 → C3），因为聚合混合了各方贡献，单院信息已消失
- **AND** 若输入不是 C1，或清单声明输出不是 C3，编译器 MUST 拒绝，错误码 `E_LABEL_VIOLATION`
