## ADDED Requirements

### Requirement: MDOP 消息信封
MDOP 控制面与数据面的每条消息 SHALL 使用统一信封，字段为 `mdop`、`msg_id`、`msg_type`、`job_id`、`sender`、`receiver`、`timestamp`、`nonce`、`idempotency_key`、`body`、`sig{alg,kid,value}`。
- 签名内容 MUST 是「去掉 `sig` 后的信封」经 JCS 规范化后的 SM3 摘要。
- 接收方 MUST 依次校验：签名能用发送方登记的公钥验证；`receiver` 是自己；`timestamp` 与本地时间相差不超过 5 分钟；`nonce` 在 10 分钟内未出现过。
- 已见过的 nonce MUST 持久化保存，重启后仍然有效。
- 任一校验失败，接收方 MUST 丢弃该消息并记录审计，MUST NOT 执行消息内容。

#### Scenario: 信封内容被篡改
- **WHEN** 接收方收到的信封在签名之后被改动了 `body` 的任一字段
- **THEN** 接收方 MUST 以 `E_AUTH_INVALID` 拒收并记录审计

#### Scenario: nonce 重放
- **WHEN** 接收方在 10 分钟内收到与已处理消息相同 `nonce` 的信封，包括接收方重启之后
- **THEN** 接收方 MUST 以 `E_REPLAY` 拒收

#### Scenario: 时间偏差超出窗口
- **WHEN** 信封的 `timestamp` 与接收方本地时间相差超过 5 分钟
- **THEN** 接收方 MUST 以 `E_AUTH_INVALID` 拒收

#### Scenario: 收件人不是自己
- **WHEN** 信封的 `receiver` 不是本节点
- **THEN** 接收方 MUST 拒收，MUST NOT 执行消息内容

### Requirement: SM2 签名口径
MDOP 中的所有签名 SHALL 按 GM/T 0003.2 计算：
- 带 Z_A 预处理，未另行约定时用户 ID 为 `1234567812345678`；
- 签名值按 GM/T 0009 用 DER 编码，算法标识为 `SM2-SM3`；
- 密钥标识 `kid` MUST 是公钥 SM3 摘要的完整十六进制（64 位字符）。

旧格式（不做 Z_A、原始 r‖s）只能用于核验切换之前产生的历史对象，线上链路 MUST NOT 接受旧格式签名。

#### Scenario: 与独立实现互验
- **WHEN** 用本实现签名的消息交给独立的国密实现（如 gmssl 或 Tongsuo）验签，或反过来
- **THEN** 双向验签 MUST 都通过

#### Scenario: 线上链路拒收旧格式
- **WHEN** 切换后，线上链路收到一条旧格式签名的信封
- **THEN** 接收方 MUST 以 `E_AUTH_INVALID` 拒收

### Requirement: 规范化哈希
MDOP 中所有需要计算哈希或签名的对象 SHALL 先按 RFC 8785（JCS）规范化，再计算 SM3，包括计划、片段、凭证核心、句柄、回执、规范化合约。

#### Scenario: 字段顺序不影响哈希
- **WHEN** 两个语义相同、只是字段顺序不同的对象分别计算哈希
- **THEN** 两个哈希 MUST 相同

#### Scenario: 任一字段变化改变哈希
- **WHEN** 对象中任一字段的值发生变化
- **THEN** 其哈希 MUST 随之变化

### Requirement: 流动等级 C0–C3
每个制品和每条跨阶段的边 SHALL 带一个流动等级：
- C0 本地明文：只允许出现在所属节点内部；
- C1 密态：只允许在同一协议实例的参与方之间流动；
- C2 受控流动：只允许流向通过远程证明、且满足合约证明策略的可信空间节点；
- C3 可发布：可交付给合约接收方列表中的主体。

四个等级 MUST 构成格：C0 最严，C3 最宽，C1 与 C2 互不可比。

#### Scenario: C1 与 C2 的输入相遇
- **WHEN** 一个普通算子同时有 C1 输入和 C2 输入
- **THEN** 其输出等级 MUST 判为 C0

### Requirement: 标签传播规则
编译器与连接器复核 SHALL 按以下规则推导输出等级并校验边：
- 普通算子的输出等级 MUST 等于其全部输入等级在格上的最严上界；
- 只有 `declassify` 类算子可以降低等级，其输出等级由清单声明，且其参数 MUST NOT 弱于合约的发布条件；
- C0 数据 MUST 经封装算子才能成为 C2，再流向可信空间节点；
- 可信空间节点内的数据 MUST NOT 回流到原持有方以外的节点，除非经过降密。

跨节点的边还要校验：
- C0 边 MUST 判为 `E_LABEL_VIOLATION`；
- C3 边的目标 MUST 在合约接收方列表里；
- C1 边的所有端点 MUST 声明同一协议及版本；
- C2 边的目标 MUST 声明 TEE 能力且满足合约证明策略。

能力类校验失败 MUST 判为 `E_CAPABILITY_MISMATCH`。任一失败 MUST 指明违规的边。

#### Scenario: 普通算子不得降级
- **WHEN** 一个非 `declassify` 算子的清单声明其输出等级低于输入推导出的等级
- **THEN** 校验 MUST 以 `E_LABEL_VIOLATION` 失败

#### Scenario: 降密参数弱于合约
- **WHEN** 降密算子的 `minCell` 参数小于合约发布条件中的 `minCell`
- **THEN** 校验 MUST 以 `E_LABEL_VIOLATION` 失败

#### Scenario: C0 跨节点
- **WHEN** 计划中一条 C0 边连接了两个不同节点
- **THEN** 校验 MUST 以 `E_LABEL_VIOLATION` 失败并指出该边

#### Scenario: C3 目标不在接收方列表
- **WHEN** 一条 C3 边的目标不在相关合约的接收方列表里
- **THEN** 校验 MUST 以 `E_CAPABILITY_MISMATCH` 失败并指出该边

### Requirement: 错误码与拒绝粒度
MDOP SHALL 使用统一的错误码集合：MDOP v0.1 §11 的全部错误码，加上 `E_CONTRACT_UNSIGNED`（合约没有持有方签名）和 `E_SNAPSHOT_CHANGED`（执行时数据快照与接受时不一致）。每个错误码 MUST 标明是否可重试。

拒绝类消息 MUST 只包含错误码和一句面向申请方的说明，MUST NOT 包含本地策略原文、剩余预算的精确值或数据集规模。

#### Scenario: 拒绝不泄露本地信息
- **WHEN** 连接器因预算或策略原因拒绝一个计划片段
- **THEN** 拒绝消息 MUST 只有错误码和简短说明，MUST NOT 出现策略原文、预算数值或数据行数

### Requirement: 协议对象结构校验
计划、片段、凭证、句柄、审计回执、销毁回执、算子清单 SHALL 各有机器可校验的结构定义，由平台与连接器共用同一份实现（`packages/mdop`）。缺少必填字段或出现未定义字段的对象 MUST 被拒绝。

#### Scenario: 缺少必填字段
- **WHEN** 收到的凭证缺少 `plan_hash`
- **THEN** 接收方 MUST 拒绝该对象，MUST NOT 按缺省值补全
