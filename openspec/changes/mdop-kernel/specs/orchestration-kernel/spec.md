## ADDED Requirements

### Requirement: 作业提交
申请方 SHALL 以逻辑计划提交作业（`JobSubmit`）。逻辑计划 MUST 包含：
- 用途编码；
- 申请方（机构 + 项目）；
- 引用的合约列表；
- 阶段集合：每个阶段写明算子 `id@version` 和输入。

可选字段为伦理批件号、DP 预算、截止时间。平台 MUST 分配全局唯一的 `job_id`。逻辑计划 MUST NOT 携带可执行代码，只能引用已注册的算子。

#### Scenario: 缺少用途编码
- **WHEN** 提交的逻辑计划没有用途编码
- **THEN** 平台 MUST 拒绝提交，作业不进入编译

#### Scenario: 引用未注册的算子
- **WHEN** 逻辑计划引用了注册中心中不存在的算子 `id@version`
- **THEN** 编译 MUST 失败，作业进入 `REJECTED`

### Requirement: 编译期放置
编译器 SHALL 按「数据就近」放置阶段：
- 以 `ds://<node>/…` 为输入的阶段放在该节点；
- 只依赖单个节点输出的阶段跟随该节点；
- 依赖多个节点输出的阶段只能放在平台上，作为合并阶段。

显式指定的 `at` 与数据所在节点冲突时，编译 MUST 以 `E_LABEL_VIOLATION` 失败。

#### Scenario: 数据所在节点放置
- **WHEN** 一个阶段的输入是 `ds://hospA/…`
- **THEN** 该阶段 MUST 被放在 hospA

#### Scenario: 显式放置越过数据边界
- **WHEN** 一个以 `ds://hospA/…` 为输入的阶段被显式指定 `at: hospB`
- **THEN** 编译 MUST 以 `E_LABEL_VIOLATION` 失败，并指出越界的边

### Requirement: 编译期标签、能力与合约校验
编译器 SHALL 按拓扑序遍历计划：推导每个阶段的输出等级，用 `mdop-protocol` 的传播规则校验每条边，并按各节点最近一次能力通告做能力匹配。

每个持有方片段 MUST 引用一份合约，该合约 MUST 满足：
- 有持有方签名，否则 `E_CONTRACT_UNSIGNED`；
- 处于生效状态，否则 `E_CONTRACT_EXPIRED`；
- 用途编码与作业一致，否则 `E_PURPOSE_MISMATCH`。

任一失败，作业 MUST 进入 `REJECTED`，失败原因须指明对应的边或合约。

#### Scenario: 计划把 C0 投向平台
- **WHEN** 计划中某阶段把 C0 输出直接连到平台合并阶段
- **THEN** 编译 MUST 以 `E_LABEL_VIOLATION` 失败

#### Scenario: 引用旧合约
- **WHEN** 计划引用了一份没有持有方签名的合约
- **THEN** 编译 MUST 以 `E_CONTRACT_UNSIGNED` 失败

#### Scenario: 请求本期未开放的等级
- **WHEN** 计划中出现 C1 或 C2 边，而没有任何节点通告相应能力
- **THEN** 编译 MUST 以 `E_CAPABILITY_MISMATCH` 失败

### Requirement: 片段切分与计划哈希
编译器 SHALL 把物理计划按节点切成片段。每个片段包含：
- 本节点的阶段：算子摘要、参数、输入输出；
- 全部边界边：对端、等级、通道。

片段哈希为规范化片段的 SM3。计划哈希 `plan_hash` MUST 等于 `SM3(JCS({作业头, fragments: {节点: 片段哈希}}))`，其中作业头包括作业 ID、用途、申请方、合约、伦理批件、预算、有效期。

每个节点 MUST 只收到本节点的片段全文和片段哈希表，MUST NOT 收到其他节点的片段内容。

#### Scenario: 任一节点可独立重算计划哈希
- **WHEN** 某节点用收到的本方片段、作业头和片段哈希表重算
- **THEN** 重算出的片段哈希与 `plan_hash` MUST 与要约中的值一致

#### Scenario: 节点看不到他院片段
- **WHEN** 平台向 hospA 发出片段要约
- **THEN** 要约 MUST NOT 包含 hospB 片段的内容，只包含其片段哈希

### Requirement: 执行凭证与持有方否决
平台 SHALL 向每个相关节点发出 `PlanFragmentOffer`，其中带凭证核心 `{ticket_id, job_id, plan_hash, fragments, not_before, not_after}`。凭证有效期 MUST 落在所有相关合约的有效期之内。

- 收齐全部持有方的 `PlanFragmentAccept` 后，平台 MUST 附上平台节点密钥的签名组成执行凭证，并以 `ExecutionTicketIssue` 发给全部相关节点。
- 任一持有方返回 `PlanFragmentReject`，或复核超时，作业 MUST 立即进入 `REJECTED`，MUST NOT 发出任何 `StageDispatch`。

#### Scenario: 任一院拒绝
- **WHEN** 两家医院中一家接受、一家拒绝
- **THEN** 作业 MUST 进入 `REJECTED`，平台 MUST NOT 向任何节点发出 `StageDispatch`，并通知已接受的节点作废要约

#### Scenario: 复核超时
- **WHEN** 某持有方在合约规定的复核时限内没有应答
- **THEN** 平台 MUST 视同拒绝，作业进入 `REJECTED`

#### Scenario: 全部接受
- **WHEN** 全部持有方都返回了有效的接受签名
- **THEN** 平台 MUST 签发凭证，凭证 MUST 包含每个持有方的签名、它签入的快照标识，以及平台签名

### Requirement: 作业与阶段状态机
作业 SHALL 使用以下状态与迁移：`SUBMITTED → COMPILED → NEGOTIATING → TICKETED → RUNNING → RELEASING → SUCCEEDED`。
- `RUNNING` 可进入 `FAILED` 或 `ABORTED`，`RELEASING` 可进入 `FAILED`；
- `SUCCEEDED`、`FAILED`、`ABORTED` 最终进入 `PURGED`；
- 编译失败、否决或复核超时进入 `REJECTED`。

阶段 SHALL 使用以下状态与迁移：`PENDING → READY → RUNNING → SUCCEEDED`；`RUNNING → RETRYING → RUNNING`；`RUNNING` 或 `RETRYING` 可进入 `FAILED`。

迁移 MUST 以显式的合法迁移表实现，非法迁移 MUST 被拒绝并记录审计。

#### Scenario: 非法迁移
- **WHEN** 有代码试图把 `REJECTED` 的作业置为 `RUNNING`
- **THEN** 迁移 MUST 被拒绝，并记录审计

### Requirement: 调度、幂等与重试
平台 SHALL 在上游制品就绪后，把阶段置为 `READY` 并发出 `StageDispatch`。`StageDispatch` 带凭证编号和幂等键 `job_id:stage:attempt`。

- 对 `E_RUNTIME`、`E_TIMEOUT`、`E_PEER_UNREACHABLE` 等可重试错误，平台 MUST 以新的 attempt 重试，最多 3 次，间隔按指数退避。
- 超过次数的阶段 MUST 进入 `FAILED`，作业随之进入 `FAILED`。
- 不可重试的错误 MUST 直接使阶段与作业失败。

#### Scenario: 可重试错误后成功
- **WHEN** 某本地阶段第一次返回 `E_RUNTIME`，第二次成功
- **THEN** 该阶段 MUST 以 attempt 2 完成，作业继续推进

#### Scenario: 超过重试次数
- **WHEN** 某阶段连续 4 次返回可重试错误
- **THEN** 该阶段与作业 MUST 进入 `FAILED`，并触发销毁

### Requirement: 平台作为合约明示的 C3 接收方合并
平台 SHALL 只经数据面接口接收 C3 结果投递。每次投递 MUST 同时满足：
- 投递的制品等级为 C3；
- 内容摘要与已登记的句柄一致；
- 平台出现在对应合约的接收方列表中；
- 作业持有有效凭证。

平台上的合并阶段 MUST 只接受 C3 输入，其输出等级为 C3。平台 MUST NOT 提供接收 C0、C1 明文或 C2 数据的接口。

#### Scenario: 非 C3 投递被拒
- **WHEN** 一次投递声明的等级不是 C3
- **THEN** 平台 MUST 拒收，并记录审计

#### Scenario: 合约未列平台为接收方
- **WHEN** 投递对应的合约接收方列表中没有平台
- **THEN** 平台 MUST 拒收该投递

### Requirement: 终态销毁
作业进入 `SUCCEEDED`、`FAILED` 或 `ABORTED` 后，平台 SHALL 向所有持有该作业中间制品的节点发出 `PurgeOrder`。
- 收齐全部节点的有效 `PurgeReceipt` 后，作业 MUST 进入 `PURGED`；
- 缺少回执时，作业 MUST 保持原终态，并按原幂等键重发销毁指令；
- 平台上的 C3 结果（各院投递与合并结果）是交付物，MUST NOT 列入销毁范围。

#### Scenario: 失败作业完成销毁
- **WHEN** 作业进入 `FAILED`，且两家医院都返回了有效销毁回执
- **THEN** 作业 MUST 进入 `PURGED`

#### Scenario: 缺回执不得进入 PURGED
- **WHEN** 只有一家医院返回了销毁回执
- **THEN** 作业 MUST NOT 进入 `PURGED`，平台 MUST 向另一家重发销毁指令
