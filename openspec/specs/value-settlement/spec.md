## Purpose

定义价值共创的计费与分配。覆盖两条计费模型不同的轨道：RWS 轨道按数字合约计价 × cohortSize 贡献占比分账（为数据贡献付费），SecretFlow 轨道按任务预算 × share 分配（为算力与交付物付费）。两轨道口径不互串。

## Requirements

> **两条计费轨道（2026-07-21 归档前修订）**：本能力覆盖两条计费模型不同的轨道，MUST NOT 相互套用。
> - **RWS 轨道**（数据贡献分账）：按数字合约计价 × 各院 cohortSize 贡献占比，收益分配给提供数据的医院。规格见「RWS 轨道」各需求。
> - **SecretFlow 轨道**（任务预算制）：按消费方声明的任务预算 × 各方 share 分配，计费对象是算力与交付物而非数据贡献。规格见「SecretFlow 轨道」各需求。
>
> 修订原因：原规格把两者写成单一模型，与实现不符——RWS 轨道的合约计价分账仅在连接器离线路径实现（`apps/connector/src/domain/settlement.ts`），控制面在跑的是 SecretFlow 轨道的预算制（`secretflow-orchestrator`）。两条轨道计费语义本就不同（前者为数据贡献付费，后者为算力/交付物付费），强行统一会失真。RWS 轨道的控制面接线为已知缺口（TD-6）。

### Requirement: 数字合约计价条款

数字合约 SHALL 可携带计价条款（计费模型：按任务 / 按记录 / 订阅，及金额与币种/积分单位）。计价 MUST 是合约的组成部分并参与合约哈希计算，使得事后调价不可抵赖（对齐"数据二十条"按贡献分配）。

#### Scenario: 计价随合约生效并入哈希
- **WHEN** 数据提供方批准一份带计价条款的数字合约
- **THEN** 该计价 MUST 成为合约的一部分，且 MUST 参与合约 SM3 哈希计算并随之上链

#### Scenario: 改动计价即改动哈希
- **WHEN** 两份除金额外完全相同的合约分别生成
- **THEN** 二者的合约哈希 MUST 不同

#### Scenario: 无计价条款的合约
- **WHEN** 一份数字合约不含计价条款
- **THEN** 该合约 MUST 正常生效（计价是可选条款），但 MUST NOT 用于 RWS 轨道的合约计价分账

### Requirement: RWS 轨道 —— 贡献度计量

RWS 轨道的每个完成任务 SHALL 对每个参与的数据提供方计量其贡献度，口径为该院的 `cohortSize`（队列规模，D-VS-1）。计量数据 MUST 来自任务执行的真实结果（编排器产出），MUST NOT 由使用方单方声明。

#### Scenario: 按队列规模计量
- **WHEN** 一个跨院 RWS 任务完成
- **THEN** 系统 MUST 记录每个参与院的 `cohortSize` 作为其贡献度

#### Scenario: 贡献不可自报
- **WHEN** 任务请求中携带了使用方声明的贡献值
- **THEN** 系统 MUST 忽略该声明，以编排器产出的真实结果为准

### Requirement: RWS 轨道 —— 按合约计价与贡献占比分账

RWS 轨道的结算 SHALL 以数字合约的计价条款为金额来源：使用方应付金额按合约计价计算，各提供方收益按其 `cohortSize` 贡献占比分配（收益占比 = 贡献占比）。

**关联合约不含计价条款时，系统 MUST NOT 对该任务产生结算记录**（无认可不计费）。RWS 轨道 MUST NOT 使用任务级预算或任何默认金额兜底——金额只能来自双方已签署的合约。

#### Scenario: 按贡献分账
- **WHEN** 一个由 A、B 两院参与的 RWS 计费任务完成且已存证
- **THEN** 系统 MUST 生成结算记录，A、B 的收益占比 MUST 与其 `cohortSize` 占比一致

#### Scenario: 无计价不计费
- **WHEN** 一个 RWS 任务关联的数字合约不含计价条款
- **THEN** 系统 MUST NOT 对该任务产生结算记录，MUST NOT 套用任何默认金额

### Requirement: SecretFlow 轨道 —— 按任务预算分配

SecretFlow 轨道的结算 SHALL 以消费方声明的任务预算（`TaskBudget`）为金额来源，各参与方按其 `share` 占比分配。该轨道计费的对象是**算力与交付物**（如 LoRA 适配器），而非数据贡献量，故 MUST NOT 套用 RWS 轨道的合约计价与 `cohortSize` 口径。

未声明预算时系统 MAY 套用默认预算——该轨道的结算是任务执行成本的分摊，不构成对数据提供方的数据付费承诺。

#### Scenario: 按 share 分配预算
- **WHEN** 一个 SecretFlow 任务完成且已存证
- **THEN** 系统 MUST 按各参与方 `share` 占比分配任务预算生成结算记录

#### Scenario: 两轨道口径不互串
- **WHEN** 一个 SecretFlow 任务的参与方同时在某 RWS 合约中有计价条款
- **THEN** 该 SecretFlow 任务的结算 MUST NOT 使用该合约计价

### Requirement: 结算记录上链可追溯

两条轨道的结算记录 SHALL 一致地上链存证：结算台账摘要 MUST 上链并关联到对应的任务存证，链上 MUST NOT 含金额与参与方标识以外的敏感数据。

#### Scenario: 结算可追溯
- **WHEN** 任一轨道生成一条结算记录
- **THEN** 其摘要 MUST 上链，且 MUST 关联到对应的任务存证

### Requirement: 结算查询按角色可见

结算查询 SHALL 按参与方角色控权：提供方仅可见自身收益、使用方仅可见自身费用、运营方可见全局结算；MUST NOT 越权查看他方结算明细。本要求对两条轨道一致适用。

#### Scenario: 提供方只见自身收益
- **WHEN** 一个数据提供方查询结算
- **THEN** 系统 MUST 只返回与其相关的收益记录，不返回其他参与方的明细
