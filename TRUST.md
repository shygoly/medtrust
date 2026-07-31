# TRUST.md — 安全与合规信任契约

> **机器可校验的信任控制点登记册**（安全 ∪ 合规合并：两者登记的是同一批控制点，
> 拆开必漂移）。每个控制点一条 `CTL-x`，四链齐备：`norm`（合规锚点）+ `enforcement`（机制）+
> `spec`（测试）+ `evidence`（审计证据落点）。**写不出 enforcement 的条款进「待接入控制点」表，
> 不入正册**——合规条款没有机制就只是愿望。
> 碰敏感字段 / 闸门 / 国密 / 存证 payload 前，先读对应 CTL 条目；新增敏感字段先登记
> 「敏感字段分级登记」表。校验：`node scripts/check-meta-docs.mjs`
> （control 块格式 + 分级表 ↔ `@EncryptedColumn`/`@Masked` 装饰器双向对拍）。
> 规范锚点轴：TC609-6-2025 系列（可信数据空间）、NDI-TR-2025 系列（数据基础设施）、
> 数据安全法、个人信息保护法、等保 2.0、人类遗传资源条例。
> 读者切片：合规审计员（`compliance` 角色）读本册 + 分级表即可出底稿；开发者按 CTL 条目改闸门。

## 控制点登记册

```yaml control
id: CTL-01
title: 输出闸门同步 fail-closed（小单元格抑制 + KM 尾部截断）
norm: [TC609-6-2025-15 使用控制, 个保法·匿名化, D5, D-UC-2, D-DC-2]
threat: 聚合结果小格重识别（re-identification）；把行级数据伪装成"结果"导出
enforcement:
  - ts:apps/connector/src/domain/output-gate.ts#OutputGate
  - ts:apps/connector/src/domain/km-gate.ts#gateKmCurve
  - py:apps/agent/src/medtrust_agent/output_guard.py
db: none
spec: apps/connector/src/domain/output-gate.spec.ts
evidence: local_audit_log（抑制/拦截留痕，含 contractId+minCell）+ cp_rws_assignment.aggregate（仅过闸产物）
```

```yaml control
id: CTL-14
title: 合约绑定出域闸门策略（预设 + minCell + 制品白名单）
norm: [TC609-6-2025-15 使用控制, D5, D-DC-2]
threat: 闸门参数写在任务侧导致绕过院方授权；或合约仅有自由文本无法强制
enforcement:
  - ts:packages/database/src/control-plane/output-policy.ts#resolveOutputPolicy
  - ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService
  - ts:apps/connector/src/domain/policy-enforcement.ts#PolicyEnforcementPoint
  - ts:apps/connector/src/domain/output-gate.ts#OutputGate
db: cp_digital_contract.outputPolicy
spec: apps/api/src/runtime/digital-contract/output-policy.spec.ts
evidence: 合约哈希含 outputPolicy；assignment.contract 快照带 allowedArtifacts/minCell
```

```yaml control
id: CTL-02
title: 数据不出域——双平面隔离 + 行级数据物理无出口
norm: [TC609-6-2025-01 技术架构, D1, D7]
threat: 中心库退化为数据汇聚；raw 行级数据经任务回执/日志出域
enforcement:
  - ts:packages/database/src/data-sources.ts#ConnectorDataSource
  - ts:apps/connector/src/domain/local-store.ts#RawAccessDeniedError
  - ts:scripts/check-meta-docs.mjs
db: none
spec: apps/connector/src/domain/local-store.spec.ts
evidence: local_audit_log(action=raw-read-blocked) + DOMAIN 覆盖矩阵/FLOWS crosses 红线机检
```

```yaml control
id: CTL-03
title: 摄入即脱敏（直接标识剥离 / 假名化 / 粗化）
norm: [个保法·去标识化, 人类遗传资源条例, NDI-TR-2025-05 数据访问控制]
threat: 本地库落入可直接识别个体的原始行；假名可逆
enforcement:
  - ts:apps/connector/src/domain/deidentifier.ts#Deidentifier
  - py:apps/agent/src/medtrust_agent/dataset.py
db: none
spec: apps/connector/src/domain/deidentifier.spec.ts
evidence: local_record 形态本身（subjectKey 哈希假名 / ageBand 粗化 / clinical 去标识）
```

```yaml control
id: CTL-04
title: 使用控制 PEP——合约四元组每步强制
norm: [TC609-6-2025-15 使用控制, D4, D-DC-1]
threat: 授权后数据被用于合约外目的；撤销后继续使用
enforcement:
  - ts:apps/connector/src/domain/policy-enforcement.ts#PolicyEnforcementPoint
  - ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService
db: none
spec: apps/connector/src/domain/policy-enforcement.spec.ts
evidence: cp_attestation_ref(kind=policy) + FLOW-DC-01 撤销补偿路径 + audit_logs
```

```yaml control
id: CTL-05
title: 国密信任链（SM2 证书 + SM2/SM3 通道）
norm: [等保2.0 密码应用, D8, NDI-TR-2025-03 身份管理]
threat: 伪造连接器身份；通道被窃听/篡改；非国密套件混入信任链
enforcement:
  - ts:apps/api/src/security/crypto/gm-crypto.service.ts#GMCryptoService
  - ts:apps/api/src/runtime/participant-identity/ca.service.ts#CaService
  - ts:apps/api/src/runtime/participant-identity/secure-channel.service.ts#SecureChannelService
db: none
spec: apps/api/src/runtime/participant-identity/secure-channel.service.spec.ts
evidence: cp_certificate（SM2 指纹 + validUntil + revoked）
```

```yaml control
id: CTL-06
title: 列级加密与 API 响应自动脱敏（声明式装饰器）
norm: [个保法·敏感个人信息, 等保2.0 数据保密性]
threat: 敏感字段明文入库 / 明文出 API；手工加密遗漏
enforcement:
  - ts:apps/api/src/security/decorators/encrypted-column.decorator.ts#EncryptedColumn
  - ts:apps/api/src/security/decorators/masked.decorator.ts#Masked
db: none
spec: apps/api/src/security/crypto/encryption.integration.spec.ts
evidence: 敏感字段分级登记表 ↔ 装饰器机检对拍（本册）
```

```yaml control
id: CTL-07
title: 密钥集中管理（Vault，5 分钟缓存）
norm: [等保2.0 密钥管理, D-RWS-3]
threat: 密钥散落文件系统/硬编码；泄露后无法轮转
enforcement:
  - ts:apps/api/src/security/vault/vault.service.ts#VaultService
db: none
spec: apps/api/src/security/vault/vault.service.spec.ts
evidence: Vault 审计日志；已知残留 D-RWS-3-a（sidecar 文件系统私钥 + 硬编码口令，生产前治理）
```

```yaml control
id: CTL-08
title: 全程审计留痕 + 证据上链
norm: [数据安全法·日志留存, 医保试点·全流程日志上链, D6]
threat: 操作不可追溯；审计记录被篡改/抵赖
enforcement:
  - ts:apps/api/src/audit/audit.service.ts#AuditService
  - ts:apps/api/src/audit/audit.interceptor.ts
  - ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService
db: none
spec: apps/api/src/runtime/digital-contract/attestation.service.spec.ts
evidence: audit_logs + local_audit_log + 链上区块（cp_attestation_ref.block / txHash）
```

```yaml control
id: CTL-09
title: TEE 信任级别如实标注（attestationLevel 贯穿）
norm: [D9, D-RWS-4, D-CN-2, TC609-6-2025-13 安全能力]
threat: 向依赖 attestationLevel 授予信任的任一方声称硬件级机密计算/远程证明，而实际仅软件隔离或仅有 Wasm 沙箱（信任虚标）。依赖方三者，各取不同保证——药企（结果可信 + 算法 IP）、监管（审计级证明）、医院（本方 data-in-use 受保护，据以放行 DP 后结果）
enforcement:
  - ts:packages/database/src/control-plane/index.ts#AttestationLevel
  - ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService
  - ts:apps/connector/src/domain/tee.ts#SoftwareTee
db: none
spec: apps/api/src/runtime/digital-contract/attestation.service.spec.ts
evidence: cp_attestation_ref/cp_rws_task/cp_fl_prediction_task 的 attestationLevel 列 + 链 payload metadata.attestationLevel + TeeAttestation.level
note: Wasm 沙箱（D-CN-2）是代码约束、不含远程证明，落地不改变 attestationLevel；算法包签名（P-CTL-6）是模块完整性证明、非执行环境证明。二者均不得表述为 TEE attestation。attestationLevel 三方（药企/监管/医院）均依赖，虚标害及全部；remote attestation 的向远端证明特性因医院是运行方而对药企/监管最吃重，医院放行更多靠自跑的沙箱+闸门+模块签名，attestation 为其 data-in-use 兜底。
```

```yaml control
id: CTL-10
title: 算法定义入站载荷的闭合语法校验（拒绝任意表达式求值）——算法执行受限的第一版
norm: [D4 rws-algorithm-validation, TC609-6-2025-15 使用控制, D-UC-2 fail-closed, D-CN-2 目标态]
threat: 消费方在"识别算法"载荷中夹带内联脚本/函数调用/eval，借连接器在原始数据上执行任意代码（注入面 + 不可预测计算成本）
enforcement:
  - ts:apps/connector/src/domain/algorithm-validation/grammar-validator.ts#validateAlgorithmGrammar
  - ts:apps/connector/src/domain/algorithm-validation/grammar-validator.ts#validateAlgorithmExpression
  - ts:apps/connector/src/domain/algorithm-validation-executor.ts#AlgorithmValidationExecutor
db: none
spec: apps/connector/src/domain/algorithm-validation/grammar-validator.spec.ts
evidence: 仅允许 codeset/and/or/not/window 节点；forbidden key + code-like char 深度扫描在求值前拒绝；负例覆盖内联脚本/函数调用/dynamic eval
note: 本条是"消费方代码在连接器安全执行"这一关切的**第一版**（闭合布尔语法）。目标态是 Wasmtime 能力受限沙箱（D-CN-2），见待接入 P-CTL-5/6——届时 CTL-10 覆盖范围收窄为闸门前的算法结构校验，运行时隔离交给沙箱。
```

```yaml control
id: CTL-11
title: 外部 AI 供应商出域闸——仅 prompt-text 可越信任边界
norm: [D-AI-1, 个保法·委托处理与出境, 数据安全法·数据出境, TC609-6-2025-13 安全能力]
threat: agent 把患者衍生内容（行级数据 / 聚合结果 / 目录真实 schema）送到外部 LLM API；供应商的留存与再训练策略不受本空间治理，出域即不可撤回，且可能构成数据出境
enforcement:
  - ext:FLOWS.md·跨域边与数据分级（crosses=control→external 仅许 payload ∈ {prompt-text, none}）
  - ext:scripts/check-meta-docs.mjs（EXTERNAL_OK 红线，违反 = ERR）
  - ts:apps/api/src/secretflow-assistant/secretflow-assistant.service.ts
db: none
spec: apps/api/src/secretflow-assistant/secretflow-assistant.service.spec.ts
evidence: FLOW-AI-01 逐步声明 crosses/payload；新增调用外部 AI 供应商的 agent 必须在 FLOWS 登记流程，未登记则该边不受红线覆盖（审计时以 FLOWS 在册流程为准）
```

```yaml control
id: CTL-12
title: 合成/注入测试数据溯源标注——结果 MUST NOT 用于监管申报
norm: [D-DATA-1, rws-algorithm-validation §7.3, 个保法·去标识化]
threat: 把 Synthea/注入测试队列的效应量或 Se/Sp 误读为真实流行病学结论或监管申报证据
enforcement:
  - ts:apps/connector/src/domain/local-gold-standard-store.ts#LocalGoldStandardStore
  - ts:apps/connector/src/domain/algorithm-validation-executor.ts#AlgorithmValidationExecutor
  - ts:apps/connector/src/testdata/signal-injection.ts#injectSignal
db: none
spec: apps/connector/src/testdata/injected-ladder-e2e.spec.ts
evidence: ValidationResult.goldStandardProvenance=synthetic；每记录 conditions 含 synthetic-injected；UI/报告须 amber 警告（§7.3 标签契约）
```

```yaml control
id: CTL-13
title: FL 权重交付与药企本地推理——单患者特征不得经控制面
norm: [D-CN-1, 个保法·最小必要]
threat: 药企推理时把患者特征回传到 API/连接器，形成绕过「数据不出域」的平行通道
enforcement:
  - ts:apps/api/src/runtime/fl-orchestrator/fl-orchestrator.service.ts#FlOrchestratorService
  - ts:apps/web/src/app/(console)/space/infer/[taskId]/page.tsx
  - ts:apps/web/src/lib/fl-local-infer.ts
db: none
spec: apps/api/src/compute-task/dto/fl-run-result.spec.ts
evidence: GET weight-bundle 仅交 theta/intercept；打分在浏览器完成；UI 明示特征不上送
```

## 敏感字段分级登记

分级：**直接标识** / **准标识** / **假名** / **去标识临床**。出域许可：**永不** / **仅聚合（过闸门）** /
**仅哈希**。机制含 `@EncryptedColumn`/`@Masked` 的行与代码装饰器**双向机检**：装饰器出现而
未登记 = 红；登记而装饰器不存在 = 红（示例文件 `.example.` 除外）。

| 字段 | 位置 | 分级 | 机制 | 出域许可 |
|---|---|---|---|---|
| 患者姓名 | `apps/api/src/common/dto/patient.dto.ts#name` | 直接标识 | @Masked("name") | 永不 |
| 患者手机号 | `apps/api/src/common/dto/patient.dto.ts#phoneNumber` | 直接标识 | @Masked("phone") | 永不 |
| 患者身份证 | `apps/api/src/common/dto/patient.dto.ts#idCard` | 直接标识 | @Masked("idCard") | 永不 |
| 患者邮箱 | `apps/api/src/common/dto/patient.dto.ts#email` | 直接标识 | @Masked("email") | 永不 |
| 病历·患者姓名 | `apps/api/src/common/dto/medical-record.dto.ts#patientName` | 直接标识 | @Masked("name") | 永不 |
| 病历·医生姓名 | `apps/api/src/common/dto/medical-record.dto.ts#doctorName` | 直接标识 | @Masked("name") | 永不 |
| 用户邮箱 | `apps/api/src/common/dto/user.dto.ts#email` | 直接标识 | @Masked("email") | 永不 |
| 用户姓名 | `apps/api/src/common/dto/user.dto.ts#fullName` | 直接标识 | @Masked("name") | 永不 |
| 用户手机号 | `apps/api/src/common/dto/user.dto.ts#phoneNumber` | 直接标识 | @Masked("phone") | 永不 |
| 本地主体假名 | `packages/database/src/connector/index.ts#subjectKey` | 假名 | 摄入哈希（CTL-03） | 永不（仅本地关联用） |
| 本地年龄段 | `packages/database/src/connector/index.ts#ageBand` | 准标识 | 摄入粗化（CTL-03） | 仅聚合（过闸门） |
| 本地临床字段 | `packages/database/src/connector/index.ts#clinical` | 去标识临床 | 摄入脱敏（CTL-03） | 仅聚合（过闸门） |
| 金标准·主体假名 | `packages/database/src/connector/index.ts#subjectKey`（local_gold_standard） | 假名 | 仅存连接器本地库（CTL-03 同源假名） | 永不（仅本地与算法输出对拍用） |
| 金标准·判定结论 | `packages/database/src/connector/index.ts#judgment` | 去标识临床（敏感度等同临床诊断） | 仅存连接器本地库（永不出域） | 永不（跨域只出 2×2 混淆矩阵计数） |
| 金标准·诊断依据 | `packages/database/src/connector/index.ts#criteriaText` | 去标识临床 | 仅存连接器本地库 | 永不（§2.6 要求报告的是结论，非依据原文） |

新增敏感字段流程：先在本表登记（定分级 + 机制 + 出域许可）→ 加装饰器/脱敏逻辑 → 跑校验。
示例参考：`packages/database/src/entities/patient.entity.example.ts`（不参与对拍）。

## 红线清单

1. **`sm-crypto` 引用白名单**（现状即白名单，新增出现即违规）：
   `apps/api/src/security/crypto/`、`apps/api/src/blockchain/services/vault-key.service.ts`、
   `apps/api/src/blockchain/adapters/chain.adapter.ts`。其余代码一律经 `GMCryptoService`。
   收敛方向（blockchain 两处直引改走安全中枢）= TD-5。守护：grep（v2 自动化）。
2. **闸门阈值禁裸写**：小单元格/KM 判断一律引用 `DEFAULT_MIN_CELL` / `DEFAULT_MIN_AT_RISK`
   （DOMAIN·派生公式），业务代码新出现裸 `< 5` 单元格判断即违规。
3. **控制面禁行级医疗字段**：cp_* 实体与跨域 DTO 不得新增患者可识别字段（姓名/证件/联系方式/
   生日/地址/诊断明细）。守护：DOMAIN 覆盖矩阵 + 本册分级表 + FLOWS crosses 红线三重机检。
4. **TEE 表述红线（D-RWS-4 / CTL-09）**：`attestationLevel` 已贯穿（实体列 + 回执 + 链 payload +
   `TeeAttestation.level`），当前值恒 `software`；值为 `software` 时任何 UI/合约/对外文档**不得
   声称硬件级机密计算**。海光 CSV 远程证明接入前，代码出现 `'hardware'` 赋值即违规（grep 守护，v2）。

## 待接入控制点（有条款，机制未落地——不入正册）

| # | 缺口 | 规范/决策锚点 | 现状 | 接入点 |
|---|---|---|---|---|
| ~~P-CTL-1~~ | ~~attestationLevel 字段贯穿~~ | D9 / D-RWS-4 | **已落地（2026-07-21）→ 移入正册 CTL-09** | — |
| P-CTL-2 | TEE 硬件远程证明（海光 CSV） | D9 | SoftwareTee 进程隔离 + 内存加密模拟 | tee.ts 可插拔抽象换硬件实现 |
| P-CTL-3 | DP ε 预算账本 | D5（"DP + 小单元格抑制"） | `outputPolicy.dp` 已预留但恒 `mode=none`；闸门现为合约 minCell + 小单元格/KM 截断，**无 ε 加噪/记账** | output-gate 消费 epsilon + 预算账本 |
| P-CTL-4 | sidecar 密钥治理 + 多节点共识 | D-RWS-3-a / D-RWS-3-b | 文件系统私钥 + 硬编码口令 + solo 单节点 | fly-services/chain-sdk 入 Vault + 多节点 |
| P-CTL-5 | Wasm 能力受限沙箱运行算法（无网络/文件/进程/系统调用，仅受限接口） | D-CN-2 | 执行 = 原生 TS + 闭合语法（CTL-10）；隔离 = SoftwareTee（AES），**非 Wasmtime** | 引入 Wasmtime 运行时 + 受限 host 接口（query_omop 只回聚合） |
| P-CTL-6 | 算法包 .wasm 静态审计 + 签名校验 | D-CN-2 | 无 .wasm 包、无独立包签名；现依赖 assignment 合约快照 + 通道签名 | 算法仓库签名 + 连接器侧 storeAttestation 前静态审计 |

## 威胁模型摘要（三边拓扑 → 控制点）

| 边 | Top 威胁 | 控制点 |
|---|---|---|
| 控制面 | 越权任务提交；合约外用途；元数据库混入行级数据 | CTL-04 / CTL-02 / INV-ID-01 |
| 连接器 | 原始数据被当"结果"导出；小格重识别；假名可逆 | CTL-01 / CTL-14 / CTL-02 / CTL-03 |
| 链与通道 | 身份伪造；通道窃听；存证抵赖；sidecar 密钥泄露 | CTL-05 / CTL-08 / P-CTL-4 |

## 附录：格式契约

1. **control 块**：围栏 info-string 恰为 `yaml control`。字段：`id`（唯一，`CTL-<NN>`）、
   `title`、`norm`（数组）、`threat`、`enforcement`（token 列表，语法同 DOMAIN 附录）、
   `db`、`spec`、`evidence`。
2. **分级表**：`## 敏感字段分级登记` 下的表，5 列，第 2 列为反引号包裹的 `路径#字段`。
   机制列含 `@EncryptedColumn`/`@Masked` 的行与代码装饰器双向对拍；其余行校验路径与字段存在。
3. 装饰器扫描范围：`packages/database/src` + `apps/api/src`（`.example.` 文件除外）。
