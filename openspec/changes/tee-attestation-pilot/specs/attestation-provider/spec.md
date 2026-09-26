## ADDED Requirements

### Requirement: 可插拔证明提供者接口
证明的产生 SHALL 通过可插拔的证明提供者接口完成，调用方（节点、KMS 客户端、编译期判定）MUST NOT 依赖具体证明链。
- 提供者输出 MUST 至少包含：`level`（`software` / `hardware`）、`isolation`（`none` / `hardware-enclave`）、
  `measurement`、`quote_digest`、`tcb`（硬件链给出 TCB 版本，软件链为空）。
- 硬件提供者给出的 `quote_digest` MUST 可被独立校验到厂商证明根；校验所需的信任根
  MUST 来自部署配置或合约，MUST NOT 从平台消息中获取。
- 软件实现 MUST 恒为 `level=software`、`isolation=none`，且 MUST 在输出与审计中如实标注。
- 同一接口 MUST 能容纳海光 CSV、Intel TDX、AMD SEV-SNP 三种证明链的字段差异（含 TCB 语义）。

#### Scenario: 软件实现冒充硬件级别
- **WHEN** 某个软件实现把 `level` 声明为 `hardware` 或把 `isolation` 声明为 `hardware-enclave`
- **THEN** 系统 MUST 拒绝接受该声明（校验失败并以审计记录）

#### Scenario: 证明信任根来自消息
- **WHEN** 校验方尝试用随消息下发的公钥作为证明校验的信任根
- **THEN** 该做法 MUST 被拒绝（信任根 MUST 来自部署配置或合约）

### Requirement: 软件实现不得作为 C2 目标
**编译期**（能力匹配）与**投递 / 执行前**（出口守卫、`verifyC2Execution`）SHALL 要求 C2 目标节点的证明为硬件级别。
- **本地复核阶段不承担证明校验**：本次会话的证明要到投递/执行时才产生；复核只判「本地合约有没有
  声明证明策略」与「对端在不在合约参与方之列」，并 MUST NOT 采信「平台说它是可信空间节点」。
- `level=software` 或 `isolation=none` 的节点 MUST NOT 被接受为 C2 目标，无论其如何声明。
- 该项 MUST 由用例固化（含正反例），防止后续以「先用软件实现顶上」绕过硬件门槛。
- 软件实现可用于开发与测试床（跑通接口、协议与回执链），其产出 MUST NOT 作为 C2 可用性证据。

#### Scenario: 计划把 C2 边指向软件实现节点
- **WHEN** 计划中出现一条 C2 边，目标节点只提供 `level=software` 的证明
- **THEN** 编译 MUST 以能力不符拒绝，且错误信息 MUST 指出目标节点与边

#### Scenario: 复核不采信「平台称其为 TEE」
- **WHEN** 片段里的 C2 边指向一个**本地没有依据**的对端（合约未声明证明策略，或对端不在合约
  参与方/接收方之列，而平台在消息里称它是可信空间节点）
- **THEN** 复核 MUST 拒绝签署——复核只认本地合约副本与参与方资格，MUST NOT 替平台认对端

#### Scenario: 投递时遇到软件级证明
- **WHEN** 连接器把 C2 信封投给目标节点，而本次会话的证明是 `level=software` / `isolation=none`
  （或干脆拿不出本次会话的证明声明）
- **THEN** 出口守卫 MUST 拒投（**这才是软件实现不得作为 C2 目标的实际拦截点**）——
  软件实现无法通过投递，也就永远不会在节点内被解封

### Requirement: 换链不改协议
更换证明链 SHALL 只替换证明提供者与 KMS 客户端实现，协议与凭证格式 MUST NOT 因此改动。
- 三种候选链的 quote 字段与 TCB 语义 MUST 能被既有证明契约（`quote_digest` / `measurement` / `tcb`）
  吸收；出现必须新增协议字段的情形 MUST 记录为设计缺陷并回写设计文档，而不是就地扩展字段。
- 试点 SHALL 用一次字段映射验证该性质，并把结论写成可复跑的测试。

#### Scenario: 新增链需要扩展协议
- **WHEN** 接入某条证明链时发现既有契约无法容纳其 TCB 或 quote 信息
- **THEN** 该情形 MUST 被记录为设计缺陷并回写设计文档，MUST NOT 直接在实现里扩展协议字段

#### Scenario: 字段映射验证
- **WHEN** 用三种候选链的样例 quote 做字段映射测试
- **THEN** 三者 MUST 都能映射到既有契约且不丢关键信息（度量、TCB、有效期）

#### Scenario: 换 KMS 客户端不动调用点
- **WHEN** 用**另一份 `KmsClient` 实现**（不复用本机演练 KMS）驱动同一段可信空间节点会话，
  信封也相应写明「密钥由该 KMS 保管」
- **THEN** 会话 / 复核 / 执行 / 发布审查 / 回执链的代码 MUST 一行不改，
  产出（C3 载荷）与回执事件序列 MUST 与本机演练 KMS 一致——换的只是「谁释放密钥」这一层

### Requirement: 硬件校验必须带 collateral 新鲜度
真实证明链的 quote 校验 SHALL 同时判定**信任材料（collateral）的时效**：气隙或受限网络的院内环境只能预取后离线校验，
因此材料的取回时间与自身有效期 MUST 随证明一起可见、可判——否则「离线校验」等于用一份不知道多旧的材料验一份不知道多新的证明。
- 部署侧 MUST 给出策略：**必须随带的材料种类** + **离线刷新窗口**（分钟）；未给策略就构造不出真实校验器。
- 材料缺失、已过自身有效期（`next_update`）、取回时间在未来、或超出离线刷新窗口 → 校验 MUST 失败
  （`E_ATTESTATION_FAILED`），MUST NOT 退化成「有几样算几样」。
- 开发替身（无真实 quote）可省材料；**真实部署 MUST 用带策略的校验器**（`createHardwareAttestationVerifier`），
  MUST NOT 用只验 quote 的校验器接真实链。

#### Scenario: 未随带材料
- **WHEN** 硬件证明报告没有随带部署策略要求的材料种类
- **THEN** 校验 MUST 失败（不得当作「该链不需要材料」放行）

#### Scenario: 材料过期或超出离线刷新窗口
- **WHEN** 真实部署用一份已过 `next_update`、或取回时间超出离线刷新窗口的材料去校验 quote
- **THEN** 校验 MUST 失败，KMS MUST NOT 释放密钥
