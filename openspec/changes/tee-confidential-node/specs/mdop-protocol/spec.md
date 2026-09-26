## ADDED Requirements

### Requirement: C2 数据信封
进入可信空间节点的数据 SHALL 使用数据信封 `mdop.env/1.0`，字段为 `envelope`、`payload{cipher,ciphertext_ref,digest}`、`wrapped_key{kms,key_id}`、`policy{contract,purpose,allowed_ops,attestation_policy,export,not_after}`、`watermark`、`origin_sig`。
- 密文 MUST 使用 AEAD，其 AAD MUST 绑定 `job_id`、执行凭证编号与合约哈希——换作业即解密失败。
- **算法如实标注（2026-09-26 更正）**：本期实现是 **AES-256-GCM**（Node 无原生 SM4-GCM），信封
  `payload.cipher` MUST 写实际算法名、MUST NOT 写成 `SM4-GCM`。**国密 SM4-GCM 尚未落地**，
  是对 D8「通信用国密加密」的**临时偏离**（登记在 DECISIONS D8 的落地补注）；收回前任何文档、
  界面与对外表述 MUST NOT 把 C2 信封称为「国密信封 / 全链国密」。换 SM4-GCM 只替换
  `aeadSeal`/`aeadOpen`，AAD 绑定、密钥保管与策略字段不动。
- `export` 本期只允许 `C3_only`；出现其他取值 MUST 被拒。
- 信封 MUST 由数据持有方签名；接收方 MUST 先验签与校验策略，再考虑解密。
- 解析器 MUST 拒绝未定义字段与缺失必填字段。

#### Scenario: 信封跨作业重放
- **WHEN** 把作业 A 的信封用于作业 B（AAD 中的 `job_id`/凭证号不同）
- **THEN** 解密 MUST 失败，且该信封 MUST 被拒绝

#### Scenario: 策略出现非 C3 出口
- **WHEN** 信封 `policy.export` 不是 `C3_only`
- **THEN** 接收方 MUST 拒收该信封

### Requirement: seal 算子
产生 C2 制品的唯一途径 SHALL 是类别为 `local` 的 `seal` 算子（机制型 `system`），它把本节点 C0 封装为数据信封。
- 除 `seal` 之外的算子输出 C2 时，编译与本地复核 MUST 判为 `E_LABEL_VIOLATION`。
- `seal` 的输入 MUST 是本节点的 C0 制品；参数 MUST 指定目标可信空间节点与合约。
- 持有方 MUST NOT 通过 `seal` 送出合约未声明的数据产品切片。

#### Scenario: 非 seal 算子产出 C2
- **WHEN** 某分析算子的输出等级被声明为 C2
- **THEN** 编译 MUST 以 `E_LABEL_VIOLATION` 拒绝

### Requirement: 证明策略与 C2 边校验
合约 SHALL 提供 `attestation_policy{tee, min_tcb, allowed_measurements}`；C2 边的目标节点 MUST 通告匹配的 TEE 能力并满足该策略。
- 合约未给出 `attestation_policy` 时，C2 边 MUST 被拒。
- 目标节点证明已过期、或度量不在允许清单、或 TCB 低于下限时，C2 边 MUST 被拒（`E_CAPABILITY_MISMATCH` 或 `E_ATTESTATION_FAILED`）。
- C1 与 C2 互不可比；同时出现 C1 与 C2 输入时输出判为 C0（既有规则不变）。

#### Scenario: 合约缺少证明策略
- **WHEN** 计划中出现 C2 边，但合约没有 `attestation_policy`
- **THEN** 编译 MUST 拒绝该计划

#### Scenario: 证明过期后再次编译
- **WHEN** 目标节点的证明已过期而计划仍引用该节点作为 C2 目标
- **THEN** 编译 MUST 拒绝，且连接器出口守卫 MUST 拒投

### Requirement: 密钥释放协议
数据密钥的释放 SHALL 由 KMS 依据证明与凭证执行，平台 MUST NOT 出现在释放链路上。
- 释放请求 MUST 包含证明报告、执行凭证与信封 `key_id`。
- KMS MUST 校验证明与策略、凭证有效性与合约状态、以及 `key_id` 与作业片段的对应关系。
- 密钥 MUST 用证明报告中的一次性公钥加密返回，且只存在于该 TEE 实例内存。
- 失败时 MUST 返回明确的错误码（`E_ATTESTATION_FAILED` / `E_MEASUREMENT_NOT_ALLOWED` / `E_TCB_TOO_OLD` / `E_KEY_RELEASE_DENIED`），MUST NOT 静默降级。

#### Scenario: 合约已终止
- **WHEN** 合约在释放请求到达前被终止
- **THEN** KMS MUST 拒绝释放密钥

### Requirement: C2 数据信封的投递与中继
数据持有方 SHALL 通过**平台中继**把 C2 数据信封送到目标可信空间节点（除非该部署另约定专线直连）：
持有方按 `C2EnvelopeSubmit` 提交，平台按 `C2EnvelopeRelay` 转给目标节点。
- 平台在该链路上 MUST 只**转运**：MUST NOT 解封、MUST NOT 参与发布审查、MUST NOT 持有任何解密能力。
  数据密钥 MUST 用**目标节点本次会话的一次性公钥**封装，使平台即使持有密文也无法解开。
- 平台 MUST 逐项检查后才转发：信封由持有方签名、合约在本作业的合约列表里**且声明了证明策略**、
  AAD 的作业与合约与信封自身一致、**密文摘要**与信封声明的摘要一致、目标节点是**本作业的片段节点**、信封未过期。
- 中继 MUST 幂等（同一密钥与目标的重复提交不产生两份投递）；中继审计 MUST 只留句柄与摘要，
  MUST NOT 在中继记录里再存一份密文。
- 目标节点收到中继后 MUST 走完整的节点侧判据（入口守卫 → KMS 释放 → 解封 → 节点内执行 → 发布审查 →
  只出 C3），并以**节点自己的身份密钥**登记 C3 句柄、投递 C3 交付物、上报会话见证。

#### Scenario: 目标不是本作业的片段节点
- **WHEN** 持有方提交的信封目标是一个不在该作业片段里的节点
- **THEN** 平台 MUST 拒绝中继并留痕（不得借中继把 C2 送到计划外的节点）

#### Scenario: 密文摘要与信封声明不符
- **WHEN** 提交的密文体与信封 `payload.digest` 不一致
- **THEN** 平台 MUST 拒绝中继（不解密也要能查出内容被换过）

#### Scenario: 合约未声明证明策略
- **WHEN** 作业里的合约没有 `attestation_policy` 而持有方仍提交 C2 信封
- **THEN** 平台 MUST 拒绝中继

#### Scenario: 节点收到中继后完成会话
- **WHEN** 目标节点长轮询取到一条 `C2EnvelopeRelay`
- **THEN** 节点 MUST 执行节点侧判据，并把 C3 交付物与会话见证（证明 + 释放凭据）以节点身份送回平台

### Requirement: 会话见证的传递与独立核验
节点 SHALL 在每次计算会话后，把「本次证明报告 + KMS 释放凭据」作为**会话见证**上报平台（消息类型 `AttestationReport`），平台 SHALL 原样转发给该作业的数据持有方（消息类型 `AttestationWitness`）。
- 会话见证 MUST 至少包含：`job_id`、`credential_id`、`contract_id`、`key_id`、节点身份、证明报告（含一次性公钥与身份绑定）与 KMS 释放凭据（含 KMS 签名）。
- 上报与转发 MUST 走既有控制面消息通道（出站拉取、信封签名、非重放）；见证本体 MUST 完整随行——**只给摘要不足以让持有方独立核验**。
- 验签用的 KMS 公钥 MUST 来自部署配置或合约，MUST NOT 取自消息本身。
- 平台 MUST NOT 声称自己校验过厂商 quote（那需要厂商证明根）；平台只负责**送到**，判定由 KMS 与持有方各自做出。
- 接收方 MUST 严格解析见证（未知字段、缺字段、非法链型、非法签名形状一律拒），任一校验不过即 MUST 记拒绝并留痕，MUST NOT 静默忽略或降级为「通过」。
- 登记 MUST 以**会话**为单位保留历史（同一节点、同一度量的多次会话各留一条），MUST NOT 相互覆盖。

#### Scenario: 平台把见证转给持有方
- **WHEN** 节点上报一份会话见证
- **THEN** 平台 MUST 登记该见证本体，并把同一份见证转发给该作业的持有方（平台与上报节点自身除外）

#### Scenario: 持有方独立核验失败
- **WHEN** 持有方收到的见证其 KMS 签名无法用部署配置的公钥验证，或证明与本院签下的期望不符
- **THEN** 持有方 MUST 记 `WITNESS_REJECTED` 并留痕，MUST NOT 视为已核验

#### Scenario: 未配置 KMS 公钥
- **WHEN** 部署未配置 KMS 公钥而收到会话见证
- **THEN** 平台与持有方 MUST 一律拒绝登记/拒绝核验（fail-closed）

#### Scenario: 持有方核验结论可见（控制台）
- **WHEN** 申请方查看某作业详情
- **THEN** 平台 MUST 按作业返回「各节点会话见证 + 持有方核验回执」的对齐结果，
  并 MUST 把 **通过 / 未通过（附原因）/ 尚未核验** 三种状态分开呈现；
  「尚未核验」（含节点还没上报见证）MUST NOT 被显示成「核验通过」

### Requirement: C3 交付物随带发布审查清单
出域的 C3 载荷 SHALL 随带**发布审查清单**（`release_manifest`，`mdop.release/1.0`），说明「这次发布经过了什么」。
- 清单 MUST 只带**汇总数**：抑制格数、发布审查阈值、**DP 声明**（如实记录，`mode=epsilon` **不代表已加噪**，见 `trusted-space-node` 的同名说明）、查询预算消耗（数据集 × 快照）。
  **逐格抑制明细** MUST 留在节点本地审查记录与审计回执里，MUST NOT 随 C3 出域。
- 清单 MUST 是**同一种可解析对象**（节点侧单方＝退化情形、平台侧多方汇总），接收方与前端 MUST NOT 按来源分叉解析。
- 平台在合并阶段 MUST 把各持有方的条目**汇总**（抑制数求和、阈值取最严、DP 取最强声明、预算保留逐方列表）。
- 没有清单时 MUST 按原样交付，MUST NOT 补造一份清单（「没有清单」不等于「审查过」）。
- 清单的解析 MUST 严格（未知字段、缺字段、非法版本/单位/负值一律拒），界面 MUST 把「没有清单」「清单非法」「清单合法」三种状态分开呈现。

#### Scenario: 多方清单汇总
- **WHEN** 两院各自出 C3 且都带清单
- **THEN** 平台的合并交付物 MUST 带汇总清单（抑制数求和、阈值取最严、DP 取最强、预算逐方列出）

#### Scenario: 没有清单
- **WHEN** 交付物没有随带清单（非 C2 通道或旧作业）
- **THEN** 交付物 MUST NOT 出现该键，且界面 MUST 如实说明「看不到抑制计数/DP/预算」

#### Scenario: 清单非法
- **WHEN** 载荷里的清单解析不过（未知版本、缺字段等）
- **THEN** 界面 MUST 报「清单非法」并给出原因，MUST NOT 猜测其内容

### Requirement: 查询预算在协议中的位置
C2 作业 SHALL 受查询预算约束：预算以「数据集 × 快照版本」计量，上限在合约中约定，账本以持有方本地为准。
- 预算消耗与拒绝 MUST 随作业回执上报，供审计与结算参照。
- 亚组、切点等重算 MUST 计入预算。

#### Scenario: 预算耗尽的后续查询
- **WHEN** 同一数据集与快照上的累计消耗已达合约上限
- **THEN** 后续查询 MUST 被拒绝，并在作业回执中体现

#### Scenario: 预算消耗与拒绝进回执链
- **WHEN** 一次 C2 阶段完成出口记账（成功），或一次查询因超出预算被拒
- **THEN** 成功路径的 `EXITED` 回执 MUST 带本次消耗（数据集 / 快照 / 单位 / 本次 / 累计 / 上限），
  拒绝路径 MUST 追加一条带错误码的失败回执并标明**未扣减**；两者都 MUST 进签名回执链，
  MUST NOT 只留在日志或内存里（审计与结算的凭据是回执）
