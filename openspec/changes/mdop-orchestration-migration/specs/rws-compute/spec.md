## ADDED Requirements

### Requirement: L1.5 失衡检测只剩 MDOP 通道

L1.5 失衡检测 MUST 只经 MDOP 作业执行（`mdopTemplate=rws.l15.disproportionality`）。旧通道（`analysisType=disproportionality` 的旧执行分支、旧端点、旧详情页）MUST 下线：端点不可再执行，旧地址 MUST 永久重定向到 MDOP 作业详情，前端 MUST 只有一个入口与一个详情页。

#### Scenario: 旧端点不再执行

- **WHEN** 以旧通道的请求形态调用 L1.5
- **THEN** 服务 MUST 不再执行该分析，MUST 返回明确的不可用或重定向响应

#### Scenario: 与历史结果一致

- **WHEN** 在未触发小单元格抑制的同一份数据上，对同一 L1.5 分析比较旧通道历史结果与 MDOP 结果
- **THEN** 四格表与 PRR/ROR/IC MUST 逐字段一致

#### Scenario: 前端不再并列

- **WHEN** 任一角色的用户打开 L1.5 相关入口
- **THEN** MUST 只能到达一个详情页；MUST NOT 出现「旧通道 / MDOP 通道」两个并列入口

### Requirement: 未迁移分析类型按台账逐类切换

尚未迁移的分析类型（本期：RWS 阶梯 L0/L1/L2/L3、FL 预测、LoRA FedAvg）MUST 继续按各自现有要求执行，本变更 MUST NOT 改写其现有要求原文。任一类型切换到 MDOP 时，MUST 由迁移台账驱动，并同时满足该类型对应的下线闸门；MUST NOT 出现「同一类型两条通道都可执行」的窗口。

#### Scenario: 未迁移类型照常运行

- **WHEN** 某分析类型台账 `channel=legacy`，提交该类型作业
- **THEN** 作业 MUST 按该类型既有通道执行，行为与迁移前一致

#### Scenario: 切换后旧入口必须收敛

- **WHEN** 某分析类型由 `legacy` 切到 `mdop`
- **THEN** 在观察窗内旧入口 MUST 标注 deprecated 且不新增第二个入口；删除旧路径 MUST 受下线闸门约束

### Requirement: FL 家族经 MDOP 执行采用节点间安全聚合

L4 联邦预测与 LoRA FedAvg 迁入 MDOP 时 MUST 采用节点间安全聚合：各院在节点内完成聚合，平台 MUST NOT 接收任何单院模型更新（系数、梯度、LoRA 增量），只收聚合后的总和（C3）。出域的「模型参数」MUST 是聚合后参数，并仍受合约 `outputPolicy.allowedArtifacts`（`aggregate_and_model`）与 D-MDOP-2 接收方列表约束。迁移顺序 MUST 为先 L4、后 LoRA；LoRA 迁移 MUST NOT 在 D-MDOP-8 落册与协议 v0.3 聚合扩展完成前开工。

#### Scenario: 平台收到单院更新

- **WHEN** 某节点向平台投递单院模型系数、梯度或 LoRA 增量（非聚合后总和）
- **THEN** 平台 MUST 拒绝该投递并留痕，MUST NOT 入库

#### Scenario: 合约未列平台

- **WHEN** 合约接收方列表不含平台
- **THEN** 聚合后总和 MUST NOT 投递平台

#### Scenario: LoRA 迁移抢跑

- **WHEN** 在 D-MDOP-8 与协议 v0.3 聚合扩展完成前启动 LoRA FedAvg 的通道切换
- **THEN** 守护 MUST 报红，评审 MUST 拒绝
