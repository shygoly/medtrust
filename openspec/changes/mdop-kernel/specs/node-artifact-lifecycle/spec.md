## ADDED Requirements

### Requirement: 制品句柄
每个阶段输出 SHALL 登记为制品句柄，字段为：
- 句柄 `art://<node>/<job>/<stage>/<output>`；
- 等级、schema、内容摘要；
- 生产方（阶段、算子、算子摘要）、凭证编号、过期时间；
- `stats`。

句柄 MUST NOT 包含数据本身。只有 C3 句柄可以填写 `stats`，其他等级的 `stats` MUST 为空。平台只登记句柄，MUST NOT 接收 C3 以外制品的内容。

#### Scenario: 非 C3 句柄带统计量
- **WHEN** 一个 C0 句柄的 `stats` 字段非空
- **THEN** 平台与连接器 MUST 拒绝该句柄

### Requirement: 本地制品库与 TTL
连接器 SHALL 在本地制品库中保存本节点产生的制品，并按阶段的 `ttl` 设置过期时间（缺省 72 小时）。到期后连接器 MUST 自主销毁该制品，无需等待平台指令，并发出签名的 `PurgeReceipt`，原因为 `ttl`。

#### Scenario: 到期自主销毁
- **WHEN** 某制品过期，而平台没有下发任何指令
- **THEN** 连接器 MUST 销毁该制品，并发出原因为 `ttl` 的签名销毁回执

### Requirement: 销毁指令与销毁回执
连接器收到 `PurgeOrder` 后 SHALL 销毁该作业在本节点的全部制品与临时缓存，并返回签名的 `PurgeReceipt`，内容为被销毁的句柄列表与销毁时间。销毁后按句柄读取 MUST 失败。

重复的 `PurgeOrder` MUST 返回同一份回执。

#### Scenario: 销毁后不可读
- **WHEN** 连接器处理完某作业的 `PurgeOrder` 后，又收到按该作业句柄读取制品的请求
- **THEN** 读取 MUST 失败

#### Scenario: 重复销毁指令
- **WHEN** 连接器第二次收到同一作业、同一幂等键的 `PurgeOrder`
- **THEN** 连接器 MUST 返回与第一次相同的销毁回执

### Requirement: C0 不出节点
连接器的数据面出口 SHALL 只投递 C3 制品，且目标 MUST 在本地合约的接收方列表中。

任何把 C0、C1 或 C2 制品发往本节点之外的尝试，MUST 被拒绝、抛错，并记录审计，与编译和复核的结论无关。

#### Scenario: 尝试投递 C0 制品
- **WHEN** 有代码路径试图经数据面把一个 C0 制品投给平台
- **THEN** 出口 MUST 拒绝投递，并记录审计

#### Scenario: 接收方不在合约里
- **WHEN** 一个 C3 制品的投递目标不在本地合约的接收方列表中
- **THEN** 出口 MUST 拒绝投递

### Requirement: 审计回执链
连接器 SHALL 为每个 MDOP 事件生成签名的审计回执，事件包括：接受、拒绝、阶段开始、成功、失败、销毁。回执字段为：
- 事件、作业、阶段；
- 输入摘要、算子摘要、输出摘要、等级；
- 上一条回执的哈希、签名方。

回执在本节点形成哈希链并持久化，以 `AuditReceipt` 上报平台。平台 MUST 逐节点校验链的连续性。仓库 MUST 提供可脱离平台运行的校验工具。

#### Scenario: 回执被删除或篡改
- **WHEN** 某节点回执链中的一条回执被删除或改动
- **THEN** 平台校验与离线校验工具 MUST 都报告断链，并指出位置

### Requirement: 回执链头锚定
平台 SHALL 在作业进入终态时，以及每 30 分钟，把各节点回执链的链头经存证服务锚定到长安链。链不可达时，锚定 MUST 进入补偿队列稍后重试，MUST NOT 返回伪造的交易号或区块号。

#### Scenario: 链不可达
- **WHEN** 锚定时长安链不可达
- **THEN** 该链头 MUST 进入补偿队列，记录显示「待上链」，MUST NOT 出现伪造的交易号
