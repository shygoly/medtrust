## ADDED Requirements

### Requirement: 合规体检产出结构化报告

`compliance-review-agent` SHALL 接收一份研究方案 spec（草稿或已提交），产出结构化合规报告：逐项对照药监指导原则要素（EVIDENCE 覆盖矩阵）与信任红线（TRUST CTL），每项 MUST 含判定级别（`pass` / `warn` / `block`）、理由、以及所引用的在册条目 id（EVD-x / CTL-x / P-EVD-x）。

报告 MUST 显式声明其为**提交前体检建议**，MUST NOT 表述为放行或准入结果。

#### Scenario: 缺 SAP 的 L3 方案被标 block
- **WHEN** 一份 L3 因果方案未声明 SAP
- **THEN** 报告 MUST 含一条 `block` 项，引用对应 EVD 条目并说明缺失内容

#### Scenario: 完备方案全项通过
- **WHEN** 一份方案满足全部硬规则
- **THEN** 报告各硬规则项 MUST 为 `pass`，且 MUST 声明"体检通过不等于已放行"

#### Scenario: 报告标注体检性质
- **WHEN** 任一报告生成
- **THEN** 其 MUST 含"提交前体检建议、非准入放行"的显式声明

### Requirement: 硬规则判定确定性，LLM 无权翻案

`compliance-review-agent` 的硬规则判定（designType/rationale 声明、SAP 分级齐备、缺失值成对、结局-暴露独立性、产物范围、因果方法在册值域、attestationLevel 非虚标、引用算法的 L0 验证）SHALL 由确定性代码产出，MUST 与既有提交准入校验（`rws-study-protocol-spec`）同源同口径。LLM MUST NOT 改变硬规则的判定结果；LLM 仅承担解释与软判断。

#### Scenario: 硬规则结论与准入一致
- **WHEN** 同一份 spec 分别经 agent 体检与提交准入校验
- **THEN** 二者对每条硬规则的判定 MUST 一致（不得体检说过、准入说缺）

#### Scenario: LLM 不可用时硬规则仍出
- **WHEN** 外部 LLM 不可用
- **THEN** agent MUST 仍产出全部硬规则判定，仅将解释与软判断降级并标注 LLM 不可用

#### Scenario: 软判断只产 warn 不产 block
- **WHEN** LLM 对某软判断项（如 rationale 疑似凑字）给出否定
- **THEN** 该项 MUST 为 `warn` 并附"建议人工确认"，MUST NOT 升级为 `block`

### Requirement: 体检判定与准入行为解耦

`compliance-review-agent` 的判定 SHALL 仅为建议：`block` MUST NOT 阻止用户提交，`pass` MUST NOT 使方案免于提交时的准入校验。准入的 fail-closed 硬拒绝始终由 `rws-study-protocol-spec` 的既有校验独立执行。

#### Scenario: agent block 不阻断提交
- **WHEN** agent 给出 `block` 但用户仍选择提交
- **THEN** 系统 MUST 允许提交进入正常准入流程（由准入校验独立裁决）

#### Scenario: agent pass 不豁免准入
- **WHEN** agent 给出全 `pass` 的方案被提交
- **THEN** 提交时准入校验 MUST 照常执行，MUST NOT 因体检通过而跳过

### Requirement: control-plane 边界与出域约束

`compliance-review-agent` SHALL 运行在控制面（`plane: control-plane`），MUST NOT 触达任何患者衍生数据。送外部 LLM 供应商的载荷 MUST 仅为 `prompt-text`（spec 草稿文本 + 硬规则判定结果 + 静态规则文本），MUST NOT 附带数据产品真实 schema、合约敏感内容、聚合或行级数据。

需核对的数据事实（如数据源是否含某变量）MUST 委托给既有 gated 计算任务或目录元数据查询，agent 自身 MUST NOT 下沉到数据平面。

#### Scenario: 出域载荷仅 prompt-text
- **WHEN** agent 调用外部 LLM
- **THEN** 出域内容 MUST 不含任何患者衍生数据或目录真实 schema

#### Scenario: 数据核对委托而非自取
- **WHEN** 体检需要确认"数据源是否含变量 X"
- **THEN** agent MUST 委托既有 gated 路径获取布尔结论，MUST NOT 自行读取本地数据

### Requirement: 登记为 AGT-02

`compliance-review-agent` 落地时 SHALL 在 [AGENT.md](../../../AGENT.md) §2 登记为 `AGT-02`，声明 `plane: control-plane`、`data-access: none`（v1）、`vendor: deepseek`、`flow: FLOW-AI-02`，enforcement 指向落地的真实符号。登记 MUST 在实现存在后进行（`enforcement` 须可被 checker 符号级校验，否则报红）。

#### Scenario: 登记项通过 checker
- **WHEN** AGT-02 移入 §2 正册
- **THEN** `node scripts/check-meta-docs.mjs` MUST 绿（enforcement 符号存在、flow 在册、R1–R4 满足）
