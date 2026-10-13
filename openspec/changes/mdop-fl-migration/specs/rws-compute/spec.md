## ADDED Requirements

### Requirement: L4 联邦预测的编排通道由 MDOP 承接

L4 联邦预测 SHALL 经 MDOP 作业执行（计划模板 `rws.l4.fl-prediction`），任务规格 MUST 复用
`FlPredictionTaskSpec`（HFL、`fedavg|secureboost`、白名单产物），MUST NOT 另立一套字段语义。
切换（`cutoverAt`）后旧入口（`POST /rws`-系的 FL 提交路径）对 L4 MUST 拒绝（409 `E_CHANNEL_MDOP`）。

#### Scenario: 经 MDOP 提交一次 L4 作业

- **WHEN** 以 `FlPredictionTaskSpec` 提交 L4 模板作业
- **THEN** 平台 MUST 生成 MDOP 作业（`cp_mdop_job`），逐片段下发院内训练，聚合后按合约
  `outputPolicy.allowedArtifacts` 出域；MUST NOT 写入 `cp_fl_prediction_task` / `cp_fl_prediction_assignment`

#### Scenario: 切换后旧入口提交 L4

- **WHEN** 在 `cutoverAt` 之后从旧入口提交 L4
- **THEN** MUST 返回 409 且消息含 `E_CHANNEL_MDOP`；旧表不得新增记录

### Requirement: L4 的等价性判据

同一样本数与超参下，旧链与 MDOP 链的 `auc / f1 / precision / recall / 样本数` MUST 逐字段一致；
`localModelHash` 若因张量顺序不同，MUST 在证据档给出可复核解释与口径，MUST NOT 以「近似」结案。

#### Scenario: 固定 fixture 的两链路对拍

- **WHEN** 用固定 fixture、固定种子分别跑旧链与 MDOP 链的 LR+FedAvg
- **THEN** 上述指标 MUST 逐字段一致；证据 MUST 归档到 `evidence/l4-equivalence/`

#### Scenario: 片段未回执

- **WHEN** 某参与院的训练片段未回执或超时
- **THEN** 作业 MUST NOT 进入 `RELEASING`，MUST NOT 产出「部分结果」；失败原因 MUST 可审计

### Requirement: L4 的保留实现不被下线

两条通道共用的院内训练与聚合实现 SHALL 被显式保留：`apps/connector/src/domain/fl-prediction/` 中经算子注入的部分 MUST 记入迁移台账 `retained`（`reason: shared-runtime`），MUST NOT 出现在 `legacyRefs` 里。

#### Scenario: 下线旧链时误删共享实现

- **WHEN** 某变更把 `retained` 的路径同时写进 `legacyRefs` 的裸字符串
- **THEN** `pnpm check:orchestration` MUST 报红
