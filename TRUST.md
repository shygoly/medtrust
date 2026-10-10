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
  - ts:apps/connector/src/domain/rws-orchestrator.ts#runMergeThenGate
  - ts:apps/connector/src/domain/connector-task-runner.ts#runUngatedForTrustedMerge
db: none
spec: apps/connector/src/domain/output-gate.spec.ts
evidence: local_audit_log（抑制/拦截留痕，含 contractId+minCell；P2 另记 action=merge-then-gate）+ cp_rws_assignment.aggregate（仅过闸产物；ungated 仅同进程、不得作跨域回执）
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
  - ts:apps/api/src/runtime/digital-contract/attestation-ledger.service.ts#AttestationLedgerService
db: none
spec: apps/api/src/runtime/digital-contract/attestation.service.spec.ts
evidence: audit_logs + local_audit_log + 链上区块（cp_attestation_ref.block / txHash）
note: 如实边界——① `cp_attestation_ref` 自 2026-10-07 起才由 AttestationService 在上链成功时写入（此前该表从未被写，存证账本页与审计证据包的「存证指针」一直为空）；历史记录靠启动回填从各域表里补，RBQM 越限与 SecretFlow 的历史回执不在回填范围（DOMAIN INV-ATT-02）。② 账本只证明「平台记得这条哈希在哪笔交易」，**不是**链上状态的独立证明——核验仍须查链。③ 重复哈希返回既有链上记录而非本地回执（DOMAIN INV-ATT-03）；此时回执**不回带本次背书**，因为链上那份是首次存证时的。④ 按哈希查链（sidecar `GET /attestation/<hash>`）在 2026-10-07 的线上 sidecar 上**不存在**（请求落到 `/attest` 处理器，返回 405）——合约完整性校验的「链上回执」一项在 sidecar 重新部署前恒为未确认（fail-closed，不是通过）。
```

```yaml control
id: CTL-09
title: TEE 信任级别如实标注（attestationLevel 贯穿）
norm: [D9, D-RWS-4, D-CN-2, TC609-6-2025-13 安全能力]
threat: 向依赖 attestationLevel 授予信任的任一方声称硬件级机密计算/远程证明，而实际仅软件隔离或仅有 Wasm 沙箱（信任虚标）。依赖方三者，各取不同保证——药企（结果可信 + 算法 IP）、监管（审计级证明）、医院（本方 data-in-use 受保护，据以放行 DP 后结果）
enforcement:
  - ts:packages/database/src/control-plane/index.ts#AttestationLevel
  - ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService
  - ts:apps/connector/src/domain/tee.ts#SoftwareSealedCompute
db: none
spec: apps/api/src/runtime/digital-contract/attestation.service.spec.ts
evidence: cp_attestation_ref/cp_rws_task/cp_fl_prediction_task 的 attestationLevel 列 + 链 payload metadata.attestationLevel（含 algorithm-sandbox 的 metadata.executionIsolation / moduleSm3）+ TeeAttestation.level / isolation（连接器本地审计 `tee-run` 条目）+ 聚合结果内 `execution.isolation`（受结果 SM3 覆盖）
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
note: 本条是"消费方代码在连接器安全执行"这一关切的**第一版**（闭合布尔语法）。运行时隔离自 2026-09-18 起由 CTL-20（零能力 Wasm 沙箱）承担，但**仅覆盖合约固定了模块的分析类型**（当前 = L1.5 失衡检测）；未固定模块的分析仍走内置实现 + 本条的语法校验。Wasmtime 独立进程见待接入 P-CTL-5——届时本条覆盖范围收窄为闸门前的算法结构校验。
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
note: 本条只管**外部**供应商。平台自托管推理端点（AGT-04 / FLOW-AI-04）按 D-AI-2 的三项成立条件算控制面内部，不经本闸；其调用点不可用即 503、不得回落外部供应商——回落即把 aggregate-only 送过本闸，属违规。
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

```yaml control
id: CTL-15
title: 存证/假名哈希禁用伪 SM3（sha256 不得冒充 SM3）
norm: [D8, TC609-6-2025-01 技术架构, 等保2.0 密码应用]
threat: 以 sha256 挂 "SM3:" 前缀冒充国密摘要，污染任务存证指纹与假名，评测时构成主动误导
enforcement:
  - ts:apps/connector/src/domain/sm3.ts#sm3Fingerprint
  - ts:apps/api/src/security/crypto/gm-crypto.service.ts#GMCryptoService
db: none
spec: apps/connector/src/domain/sm3.spec.ts
evidence: connector 全链路无 "SM3:" 前缀挂 sha256（grep 守护）；sm3("abc") 与国密 SM3 已知摘要一致
```

```yaml control
id: CTL-16
title: 连接器接入证书鉴权（SM2 签名+时间戳防重放+吊销检查；token 仅为可关闭降级）
norm: [TC609-6-2025-16 6.2/7.1, D8, 等保2.0 身份鉴别]
threat: 共享 token 泄漏后任意方伪装连接器拉取任务/回传结果；已吊销连接器仍可交互
enforcement:
  - ts:apps/api/src/common/guards/connector-token.guard.ts#ConnectorTokenGuard
  - ts:apps/api/src/runtime/participant-identity/connector-auth.service.ts#ConnectorAuthService
  - ts:apps/connector/src/domain/control-plane-client.ts#ControlPlaneClient
db: cp_certificate（subjectPublicKey/revoked/validUntil）
spec: apps/api/src/runtime/participant-identity/connector-admin.service.spec.ts
evidence: 注册时签发 SM2 证书；请求携带 x-connector-cert-fingerprint/x-connector-timestamp/x-connector-signature；吊销后拉取 401；CONNECTOR_CERT_AUTH_REQUIRED=true 时禁止 token 降级
```

```yaml control
id: CTL-17
title: 审计日志链式哈希防篡改（平台侧与连接器侧同构）
norm: [TC609-6-2025-16 6.10/8.3, 数据安全法·审计追溯, 等保2.0 安全审计]
threat: 审计日志被直接改库后无感知，证据链断裂/被抵赖
enforcement:
  - ts:apps/api/src/audit/audit.service.ts#AuditService
  - ts:apps/api/src/audit/audit.controller.ts#AuditController
  - ts:apps/connector/src/domain/audit.ts#AuditService
db: audit_logs.entry_hash/prev_hash + local_audit_log.entry_hash/prev_hash
spec: apps/connector/src/domain/audit.spec.ts
evidence: 每条日志 entryHash=SM3(prevHash|payload)；GET /audit/integrity 重算链比对，任一条被篡改即报警；连接器侧 digest 周期上报平台对拍 chainOk
```

```yaml control
id: CTL-18
title: 西安节点开放接口防重放与敏感字段 SM2 加密（X-App-Key + 时间窗 + nonce + SM2 字段解密）
norm: [D-ID-2, 等保2.0 身份鉴别, 个保法·敏感个人信息]
threat: 开放接口被重放/伪造调用；SM2 密文字段被明文日志或明文落库
enforcement:
  - ts:apps/api/src/runtime/xian-integration/xian-header.service.ts#XianHeaderService
  - ts:apps/api/src/runtime/xian-integration/xian-open-api.service.ts#XianOpenApiService
  - ts:apps/api/src/security/crypto/gm-crypto.service.ts#GMCryptoService
db: xian_user_links(tenantId,userId) + sso_tickets(ticketHash,usedAt)
spec: apps/api/src/runtime/xian-integration/xian-header.service.spec.ts
evidence: X-Timestamp 5 分钟窗、X-Nonce 去重、SM2 字段密文 Base64 直传；密码不落明文/不入日志，仅 bcrypt 哈希落 users.password_hash
```

```yaml control
id: CTL-19
title: RBQM 站点 KRI 聚合小格抑制 + QTL 越限存证（rbqm-central-monitoring）
norm: [新版 GCP 数据治理专章, RBQM 风险导向质量管理, D1, D5, D7]
threat: 站点级质量指标以小样本反推个体；越限事件被事后篡改或抵赖
enforcement:
  - ts:apps/connector/src/domain/kri-aggregator.ts#aggregateKri
  - ts:apps/api/src/runtime/rbqm/rbqm.service.ts#RbqmService
db: cp_kri_observation(suppressed) + cp_qtl_breach(attestationTxHash)
spec: apps/api/src/runtime/rbqm/rbqm.service.spec.ts
evidence: 分母 < 小格抑制硬底 5 → 观测整条 suppressed（计数清零、value=0）；QTL 越限证据 SM3 上链（链降级 0xLOCAL 本地回执），越限入合规告警流可追溯
```

```yaml control
id: CTL-21
title: 连接器信道强制证书认证 + 下发任务验签 + 院内计算后端只受本院连接器调用
norm: [D-CN-4, TC609-6-2025-15 使用控制, TC609-6-2025-13 安全能力, D-UC-2 fail-closed]
threat: 平台主动连进医院（要求入站端口，通道明文无鉴权）；未经签名的任务被代理篡改后由连接器执行；连接器信道退化为静态令牌（代码里还有缺省值）；院外任意调用参与方计算后端
enforcement:
  - ts:apps/api/src/common/guards/connector-token.guard.ts#ConnectorTokenGuard
  - ts:apps/api/src/runtime/participant-identity/connector-auth.service.ts#ConnectorAuthService
  - ts:apps/api/src/runtime/connector-tasks/connector-task-signer.service.ts#ConnectorTaskSigner
  - ts:apps/api/src/runtime/connector-tasks/connector-tasks.controller.ts#ConnectorTasksController
  - ts:apps/api/src/runtime/secretflow-orchestrator/fl-round-queue.service.ts#FlRoundQueueService
  - ts:apps/connector/src/domain/connector-task-signature.ts#verifySignedConnectorTask
  - ts:apps/connector/src/domain/connector-worker.service.ts#ConnectorWorkerService
  - ts:apps/connector/src/domain/fl-round/fl-round-executor.ts#FlRoundExecutor
  - py:apps/agent/src/medtrust_agent/grpc_server.py
db: none
spec: apps/connector/src/domain/connector-task-signature.spec.ts
evidence: 连接器请求必须带平台 CA 签发证书的 SM2 签名（带请求体的上报签名覆盖请求体 SM3）；缺省拒绝令牌降级，令牌仅在显式开关 + 显式令牌值时可用，代码中无缺省令牌；平台对每个下发任务签名（含目标参与方/类型/ID/签发时间/内容），连接器验签 + 检查参与方/时效/taskId 去重，失败记 `task-signature-invalid` 并上报失败；agent gRPC 校验 `x-agent-token`，未配置即拒绝（UNAUTHENTICATED）；控制面已无 agent 远程调用与日志桥（AGENT_GRPC_ROUTING 下线）
note: |
  分阶段上线（D8）：① 控制面库挂卷持久化 → ② 发布新版 API（守持非强制，令牌开关打开，旧连接器照常）→
  ③ 为各院签发证书并配置连接器/agent（长轮询、验签、训练中转、共享凭证）→ ④ 切换强制守卫、删除
  agent 路由配置 → ⑤ 后续变更删除旧 pending 接口。任一步可回滚（回滚镜像或关掉强制开关）。
  前置：控制面 SQLite 未挂卷时重建 API 会重新生成 CA 根密钥，本控制点与 CTL-20 的信任链会整体失效。
  第一版不做国密 TLS（TLCP）与连接器↔agent mTLS：传输层用标准 TLS，国密体现在应用层 SM2/SM3。
```

```yaml control
id: CTL-20
title: 算法模块双重校验 + 零能力 Wasm 执行（fail-closed）
norm: [D-CN-2, TC609-6-2025-15 使用控制, D-UC-2 fail-closed, D4 rws-algorithm-validation]
threat: 连接器上运行的算法模块被替换/篡改后静默执行，或模块夹带网络、文件、进程、系统调用能力去偷取或外传本地原始数据；失败后"悄悄回退到内置实现"使校验形同虚设
enforcement:
  - ts:apps/connector/src/domain/sandbox/module-verifier.ts#verifyModule
  - ts:apps/connector/src/domain/sandbox/sandbox-runner.ts#WasmSandboxRunner
  - ts:apps/connector/src/domain/sandbox/disproportionality-sandbox.ts#bucketsFromSandboxOutput
  - ts:apps/connector/src/domain/policy-enforcement.ts#PolicyEnforcementPoint
  - ts:apps/api/src/runtime/connector-modules/algorithm-module.registry.ts#AlgorithmModuleRegistry
  - ts:apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts#readExecutionAnnotation
  - ts:packages/wasm-algorithms/scripts/check-reproducible.mjs
db: cp_digital_contract(pinnedModules) + cp_rws_assignment(executionIsolation, moduleSm3)
spec: apps/connector/src/domain/sandbox/sandbox.spec.ts
evidence: 运行前两项独立校验（模块 SM3 = 合约固定值；模块 SM2 签名用部署配置固定的平台 CA 公钥验过）→ 零能力实例化检查（导入恰好为 env.memory）→ worker 内运行（env={}、超时 terminate、内存上限先算后拒）→ 输出不变量校验（a+b/c+d/cohortSize）；任一失败记 `sandbox-fail` 审计并判任务失败，**不回退到内置 TS 实现**；成功记 `sandbox-run`（SM3/ABI/耗时/内存页数）；执行隔离如实随结果回传并受结果 SM3 覆盖
note: 与 CTL-09 正交——本控制点管"代码能力受限"，CTL-09 管"执行环境如实标注"。沙箱与连接器同进程：`wasm-sandbox` 不表示进程隔离或保密，V8 逃逸风险由容器加固兜底（deploy/ali29/compose.hardening.yaml）；Wasmtime 独立进程见待接入 P-CTL-5，专用算法签名密钥见 P-CTL-6。
```

```yaml control
id: CTL-22
title: L2 合规预审闸门（合约申请绑定 + 任务准入复核，fail-closed）
norm: [D-CMP-1, D-CMP-2, TC609-6-2025-15 使用控制, D-UC-2 fail-closed]
threat: 合规预审游离在流程外（合约与任务准入都不看它，仅供参考）；申请方自报低风险维度规避裁决；规则签发后收紧而旧合约仍能创建高风险任务；越出预审范围（为比值计数预审的合约被拿去做联邦训练）
enforcement:
  - ts:apps/api/src/capability/l2-compliance/compliance-engine.ts#evaluateCompliance
  - ts:apps/api/src/capability/l2-compliance/compliance.service.ts#ComplianceService
  - ts:apps/api/src/capability/l2-compliance/pre-review-gate.ts#PreReviewGate
  - ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService
  - ts:apps/api/src/runtime/rws-orchestrator/rws-admission.service.ts#RwsAdmissionService
  - ts:apps/api/src/runtime/fl-orchestrator/fl-admission.service.ts#FlAdmissionService
  - ts:apps/api/src/runtime/secretflow-orchestrator/secretflow-admission.service.ts#SecretFlowAdmissionService
db: cp_digital_contract(preReview, preReviewAck) + composition(ownerParticipantId) + compliance_evaluation(dimensions/dimensionSources/dimensionConflicts/rulesDigest)
spec: apps/api/src/capability/l2-compliance/pre-review-gate.spec.ts
evidence: 合约申请必须引用本方预审并按当前规则 + 推导维度重裁决（驳回则拒），裁决快照计入合约哈希、随合约存证上链；需审批的合约医院签发须显式确认并计入哈希；RWS/FL/SecretFlow 三处准入统一 PreReviewGate 复核——快照存在 + 分析类型被 L3/L4 登记覆盖 + 按任务层参与机构数复评（block 拒、manual_review 须合约有医院确认）；维度事实优先并标注 derived/declared；引擎维度上调风险（≥3 机构或含 HGR → high）、各风险等级强制所需保障级（basic<federated<enhanced，block-security-below-required）；无快照旧合约不能创建新任务（fail-closed，不设宽限期）
note: 保障级口径见 D-CMP-1（medium→federated 由已落地的「联邦就地计算 + 输出闸门」满足；high→enhanced 在 CKKS 等 enhanced 协议接入线上前如实驳回）。与连接器侧 PEP（合约强制）并联：本控制点在控制面准入把关，连接器 PEP 在院内执行前再校验一遍。
```

```yaml control
id: CTL-23
title: 存证按贡献方带连接器 SM2 背书（可脱离平台独立归因）
norm: [D-RWS-5, D-RWS-4 如实标注, TC609-6-2025-15 存证, D-UC-2 fail-closed]
threat: 链上只有平台锚的一个合并哈希，平台可单方面伪造/篡改某院贡献而读链者无从分辨；连接器签名只在 ingress 验一次即弃，离开平台后无任何可独立核验的归因证据
enforcement:
  - ts:apps/connector/src/domain/result-endorsement.ts#signResultEndorsement
  - ts:apps/api/src/runtime/rws-orchestrator/result-endorsement.ts#collectEndorsements
  - ts:apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts#RwsOrchestratorService
  - ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService
  - ts:apps/api/src/runtime/endorsement-verification/endorsement-verification.controller.ts#EndorsementVerificationController
  - ts:scripts/verify-endorsement.mjs
db: cp_rws_assignment(resultSm3, connectorResultSig, connectorCertFingerprint) + cp_certificate(caSignature)
spec: apps/api/src/runtime/rws-orchestrator/result-endorsement.spec.ts
evidence: 连接器对 resultSm3 做结果级 SM2 签名（域分离载荷 `medtrust.result-endorsement.v1:<sm3>`）；平台只用**守卫认证过的那张证书**验签（不认请求体自报指纹）、只认**平台自己算出的**结果摘要，验不过即拒该院贡献且不入库；背书先持久化再锚链（链不可达不丢，可补锚）；上链 payload = 合并 resultHash + 各院 `{participantId, resultSm3, sig, certFingerprint}`，按 participantId 排序使 payload 不依赖回传顺序；`GET /attestation/trust-anchor` 公开 CA 公钥与载荷口径、`GET /attestation/certificates` 公开证书目录（含 CA 签名），`scripts/verify-endorsement.mjs` 离线两步核验（CA 公钥验证书链 → 连接器公钥验背书），篡改 resultSm3/签名或平台自签冒充均核验失败
note: 如实边界（D-RWS-5）——本控制点让**已锚的**记录可独立归因到医院，**不**解决「平台遗漏/不锚某条记录」，也**不**改变链仍为平台单节点运营这一事实（多节点共识 / 医院背书节点见待接入 P-CTL-4）。`attestationLevel` 仍恒 software（CTL-09 不变）。迁移期默认渐进（无背书记告警不破任务，有背书必须验过），`RWS_ENDORSEMENT_REQUIRED=true` 切 fail-closed。
```

```yaml control
id: CTL-24
title: 第三方算法模块准入五道闸（源码-only + 复现构建 + 沙箱动态测试 + 影子 + 吊销）
norm: [D-CN-5, D-CN-2, TC609-6-2025-15 使用控制, D-UC-2 fail-closed]
threat: 第三方把不透明二进制/不可复现的算法塞进院内执行（医院同意的到底是哪一份代码无法指认）；**借编译期执行逃过所有运行期闸门**（build.rs / proc-macro / .cargo runner / asc transform 都在编译时以宿主权限运行，闸 1 只看产物、闸 3 只看运行期）；借合法输出通道外泄（行序编码、超额精度、canary 复原）；资源 DoS 拖垮连接器；在测试集上乖、真实数据上变脸；出事后撤不掉（已分发模块继续跑）
enforcement:
  - ts:packages/wasm-algorithms/src/source-gate.ts#sourceGate
  - ts:packages/wasm-algorithms/src/static-gate.ts#staticGate
  - ts:packages/wasm-algorithms/src/admission.ts#validatePinnedModuleClause
  - ts:packages/wasm-algorithms/src/revocation.ts#assertNotRevoked
  - ts:packages/wasm-algorithms/src/output-schema.ts#assertLowEntropyOutput
  - ts:packages/wasm-algorithms/scripts/admission.mjs
  - ts:apps/api/src/runtime/connector-modules/module-admission.service.ts#ModuleAdmissionService
  - ts:apps/connector/src/domain/sandbox/module-verifier.ts#verifyModule
  - ts:apps/connector/src/domain/policy-enforcement.ts#PolicyEnforcementPoint
db: cp_module_admission + cp_module_revocation + cp_digital_contract(pinnedModules 含 tier/review) + cp_rws_assignment(executionIsolation, moduleSm3)
spec: apps/connector/src/domain/sandbox/admission-gates.spec.ts
evidence: **闸 0 源码预检**在编译之前排除编译期执行点（拒 build.rs / [package].build / [build-dependencies] / 非空依赖 / proc-macro crate / .cargo 配置 / [workspace] / asconfig transform / package.json scripts / 夹带 node_modules），负例验证 build.rs **从未被执行**；编译在**隔离构建器容器**内进行（`--network=none --read-only --cap-drop=ALL` 非 root 无凭据，入口丢弃提交方夹带的 target//.cargo 强制从零重编译），控制面**不装编译器、不挂 docker.sock**；准入只两层（A 平台自研 / B 第三方源码），**不设 Tier C**——合约固定的 SM3 必须由平台在锁定工具链（rust-toolchain.toml / 仓内 asc 版本）里断网 hermetic 复现产出，两个独立构建器 SM3 不一致即拒，故不透明二进制结构性无法入册；闸 1 静态白名单纯结构化判定（只许 env.memory 导入、导出固定、拒 start/tag/GC/表/共享内存/memory64、字节数与内存页数上限、解析不动即拒），平台侧与连接器侧共用同一份实现；闸 3 在真沙箱里对拍独立参考实现逐字段一致、N 次 + 跨 runner 输出逐字节一致、超时/内存上限确实触发且只判任务失败、最小整数列投影（原始标识不进模块）、行序不变性差分、低熵输出 schema（拒尾数噪声/越界/可变长/信息量超限）、canary 不可复原、malformed 输入优雅失败；闸 4 影子只算不发、不干净即拒不晋级、状态机不得跳闸；闸 5 每次运行验 SM2 + SM3 == 合约固定值 + 零导入实例化 + 吊销名单（随长轮询下发、版本单调递增防回放、命中即清缓存），PEP 执行前再查一次，吊销即拒且**不回退到内置实现**
note: **信任边界**——控制面只读字节、不执行任何被提交内容：构建在独立环境完成（`packages/wasm-algorithms/BUILDER.md`），控制面收 ≥2 份产物后**自己**重算 SM3、自己比对复现一致性、自己跑闸 1、再签名（`attestBuild`）；不采信提交方声称的 SM3。控制面自行编译的旧接口缺省禁用（`MODULE_LOCAL_BUILD_ALLOWED`，仅本地 demo）。容器化构建与宿主构建实测逐字节一致（SM3 不因切隔离而变）。如实边界——运行时引擎是 **V8 + worker_threads**，资源上限用超时 terminate + 内存上限。**fuel（确定性指令预算）按决策不做**（D-CN-5 落地补注 2026-09-20）：裁决用墙钟、跨院可能不一致，但不一致只导致偶发任务失败（fail-closed 方向），算法正确性由闸 2 可复现源码 + 闸 3.1 参考实现对拍保证；Wasmtime 的另一项收益「进程隔离防引擎逃逸」仍留在待接入 P-CTL-5。`allowSimd: false` 本闸会**如实报错说它管不了**而不是假装禁掉（结构化判定无法在不做 opcode 扫描时判 SIMD）；OS 层 seccomp profile（deploy/ali29/seccomp-connector.json + compose.seccomp.yaml）**已实测**（2026-09-20，Linux 6.10.14 x86_64）：Node 启动、worker_threads + 零导入 Wasm 实例化 + run、死循环 terminate、连接器真实 entrypoint 与出站轮询全通、0 EPERM，并以「去掉 getrandom 即崩」反证内核真在执行；残留差异是 ali29 内核版本不同，首次上机仍须看一遍日志。断外网仍由 compose.hardening.yaml 的 internal 网络承担（连接器自身要出站，socket 不能禁）。与 CTL-20 的关系：CTL-20 管「平台自研模块的双重校验 + 零能力执行」，本控制点把同一套机制打开给第三方并补上准入/影子/吊销。
```

```yaml control
id: CTL-25
title: 院内数据库接入 = 医院视图层 + 双权限域受限账号（医院可单方面掐断的第零道闸）+ 连接器独占句柄
norm: [D-CN-6, D-CN-7, D-UC-2 fail-closed, TC609-6-2025-15 使用控制]
threat: 连接器（及其上跑的算法 / agent）读到直接标识或医院不愿开放的人群；平台承诺一旦被绕过，医院没有自己的刹车；连接器账号权限过宽（超级用户 / BYPASSRLS / 能读底表）让视图形同虚设；接入没配好时静默改读文件数据，医院以为跑的是库里的数据；库凭据随配置或载荷流进控制面；第二个执行体另开连接绕过闸门；results 中间表在医院库里无限堆积
enforcement:
  - ts:apps/connector/src/domain/data-source/cdm-access-gate.ts#CdmAccessGate
  - ts:apps/connector/src/domain/data-source/cdm-data-source-registry.ts#CdmDataSourceRegistry
  - ts:apps/connector/src/domain/data-source/data-source-config.ts#parseDataSourceConfig
  - ts:apps/connector/src/domain/data-source/cdm-executor.ts#CdmExecutor
  - ts:apps/connector/src/domain/data-source/cdm-results-scratch.ts#CdmResultsScratch
  - ts:apps/connector/src/domain/data-product-local-source.ts#DataProductLocalSource
  - ts:packages/database/src/control-plane/data-source-declaration.ts#parseDataSourceDeclaration
  - ts:packages/database/src/control-plane/data-source-coverage.ts#validateCoverageReport
  - ts:apps/connector/src/domain/fl-round/fl-round-executor.ts#FlRoundExecutor
  - py:apps/agent/src/medtrust_agent/config.py
  - py:apps/agent/src/medtrust_agent/training_slice.py
db: local_data_source_status + cp_data_product(fhirSchema.dataSource, coverage)
spec: apps/connector/src/domain/data-source/cdm-access-gate.spec.ts
evidence: **第零道闸在医院手里**：底表 schema 不对连接器授权，视图同名同结构、去直接标识、可行级过滤，全部由医院 DBA 建、随时可 REVOKE——REVOKE 之后连接器下一条查询即被数据库拒绝（真实 PostgreSQL 实测），周期复核随即判不可用，**无需平台任何配合**。连接器侧接入校验（启动 + 周期复核，fail-closed）在真实 PostgreSQL 上逐类负例验证：超级用户 / BYPASSRLS / 可建角色或库 → 账号属性域；允许 schema 之外任何关系可读（判据 = schema USAGE **且** 表 SELECT，避免把 PG≤14 默认 public USAGE 误判）→ 最小权限域并按 schema 点名；缺视图 / 视图存在但无 SELECT → 视图只读域；视图多出规范外列（如身份证号）或含规范内标识列 `person_source_value`（ETL 惯例即病案号）→ 视图契约域；视图可写 → 视图只读域；`results` 不能建表或建了删不掉 → results 可写域（**纯只读账号判为契约不满足**）；`cdm_source` 读不到或声明版本不符 → 元数据域。未过即不可用，取用只走 `requireAvailable()`，**不回退到文件数据**；CDM 类型数据产品派发不读任何文件（声明解析器拒绝「CDM + 文件路径」的歧义声明）。凭据：配置里只有环境变量引用 `passwordEnv`，明文口令字段 / 带口令连接串拒收，执行器不挂 env 字段（序列化回归测试），审计与上报只含摘要；控制面数据产品声明只允许 `{type, label}`，带连接信息即 400。单一入口：Wasm 导入面恒为一块有上限内存（数据查询类导入实例化前即拒）；agent 启动时发现数据源凭据变量即拒绝启动、依赖里不得有数据库驱动；联邦训练 agent **不再自读文件**（旧路径含姓名 / 生日、绕过去标识），只收连接器按合约的数据产品投影的训练切片（切片外字段拒收、无切片本轮失败、spec 带 dataPath 在控制面与 agent 两处都拒），agent 镜像不再内置任何患者文件。results 中间表按 `mt_<UTC 分钟>_<任务 SM3 前缀>_<用途>` 命名，任务结束即删，孤儿表随复核兜底清理，只碰本账号拥有且符合命名约定的表。覆盖元数据只报数量级与月粒度跨度，收发两端同一个白名单校验器
note: 如实边界——① 视图是**医院的**机制：连接器只能校验它在结构与权限上合规，**不能**证明行级过滤逻辑正确，也识别不了用规范列名承载标识的情形（`person_source_value` 之外的 `*_source_value` 是否夹带标识靠医院按手册审查）。② 视图性能：合成千万行级基准下带行级过滤的视图照常走索引、选择性查询慢 1.25–1.5×（`apps/connector/scripts/omop-view-benchmark.sh`）；**真实分布与目标院硬件未验证**（omop-data-source-access 8.4），不得对外声称已在真实数据上验证。③ 本版不开放 CDM 上的分析派发（omop-data-source-access D8）：投影下推机制已与文件路径逐字节对拍，但队列 / 时间窗语义属 Circe 变更。④ 训练切片的标签口径（`esrd-proxy@1`）是演示终点「24 个月内 ESRD」的**代理**（任一诊断落在肾病词表），不是经验证的临床终点；特征取 7 项数值观测，现有演示数据不含观测值，特征全为 0。⑤ 方言只实现 PostgreSQL，国产库另立变更。
```

```yaml control
id: CTL-26
title: 参与方密钥自持 + 平台三钥分离（CA 根钥 / 平台节点密钥 / 注册中心密钥，SM4 密文落库）
norm: [TC609-6-2025-15 使用控制, 等保 2.0 密码技术应用, D8, D-MDOP-3, MDOP v0.2 §7.1]
threat: 平台代生成或持有参与方私钥（平台即成信任根，可伪造任何一方的签名）；一把 CA 根钥同时签证书、任务与算法模块（一次泄露等于全链失守）；平台私钥明文落库（读一次库即得密钥）；用错用途的密钥签出的对象被接受（用途边界形同虚设）；私钥文件权限过宽被同机其他账号读取
enforcement:
  - ts:apps/api/src/runtime/participant-identity/platform-key-store.ts#assertKekAvailable
  - ts:apps/api/src/runtime/participant-identity/platform-key-store.ts#encryptStoredKey
  - ts:apps/api/src/runtime/participant-identity/platform-key-store.ts#migratePlaintextKey
  - ts:apps/api/src/runtime/participant-identity/ca.service.ts#keyStorageReport
  - ts:apps/api/src/runtime/participant-identity/ca.service.ts#signWith
  - ts:apps/api/src/runtime/participant-identity/connector-admin.service.ts#register
  - ts:apps/connector/src/domain/connector-key.ts#assertKeyFileMode
  - ts:apps/connector/src/domain/platform-keys.ts#verifyByPurpose
db: cp_ca_keypair（CA 根钥 / 平台节点密钥 / 注册中心密钥，三把私钥均为 SM4 密文 enc:v1:<iv>:<cipher>）
spec: apps/api/src/runtime/participant-identity/platform-keys.spec.ts
evidence: **参与方密钥自持**——连接器用 `scripts/keygen.mjs` 在本地生成密钥对（私钥文件 0600，组/其他可读即拒绝加载），注册**只提交公钥**；`ConnectorAdminService.register` 对空公钥直接 400，注册响应结构里没有私钥字段（用例断言 `JSON.stringify(r)` 不含 `privateKey`，且 `generateSM2KeyPair` 从未被调用）。**平台三钥分离**——`CaService` 只按用途取钥：证书走 `certificate`、任务信封/凭证/吊销名单/合约副署走 `platform-node`、算子清单与算法模块走 `registry`；用例逐条证明「任务签名用平台节点公钥验得过、用 CA 根钥/注册中心公钥验不过」「模块签名只认注册中心公钥」「拿 CA 根钥签的信封被按用途拒绝」。**加密落库**——三把私钥以 SM4-CBC 信封加密后写入 `cp_ca_keypair`，KEK 来自 `PLATFORM_KEK`（非 32 hex 口令按 SM3 派生）；生产环境缺 KEK 直接拒绝启动，开发环境回落固定 KEK 并显式告警；历史明文 CA 私钥在启动时**原地迁移**为密文（用例断言迁移后列不再是明文、且证书链照常可用）；用错 KEK 读不出私钥、明文列一律拒绝按私钥使用。**连接器按用途验签**——`verifyByPurpose` 把三把公钥分别绑定到 `certificate` / `platform-node` / `registry`，任一用途未配置即 fail-closed。跨端演练见 `apps/connector/src/domain/sm2-switch-drill.spec.ts`
note: 如实边界——① 三把公钥由平台运营，`GET /api/v1/attestation/trust-anchor` 一并发布，连接器必须固定到部署配置而不是从任务通道取（否则控制面被攻破可连公钥一起换）；② 本控制点不改变「链为平台单节点运营」这一事实（见 D-RWS-4 与 P-CTL-4）；③ 参与方密钥自持只保证「平台拿不到本院私钥」，不保证院内私钥保管本身安全（主机被攻破即等同私钥泄露），由院内主机加固与密钥管理承担
```

```yaml control
id: CTL-27
title: MDOP 本地七项复核 + 执行前凭证校验 + C0 出节点守卫（三道独立拦截）
norm: [D-MDOP-1, D-MDOP-4, D-MDOP-5, D-MDOP-6, TC609-6-2025-15 使用控制, MDOP v0.2 §7.4/§7.5/§9]
threat: 平台改了片段仍要本院执行（本院被迫运行没审过的计划）；平台用别家密钥伪造本院的接受签名；复核时看的是平台随消息附带的合约文本（被改过的条款也能过）；白名单由平台代为决定（等于平台能决定本院跑什么代码）；执行时数据已换了一批（结论与复核时的数据对不上却照样发布）；行级制品被当成"看起来是聚合"而发出去（C0 出节点）
enforcement:
  - ts:apps/connector/src/mdop/mdop-review.ts#MdopReviewService
  - ts:packages/mdop/src/ticket/verify.ts#verifyTicketForExecution
  - ts:apps/connector/src/mdop/mdop-node.service.ts#onStageDispatch
  - ts:apps/connector/src/mdop/mdop-egress.ts#MdopEgressGuard
db: local_mdop_contract + local_mdop_operator_whitelist + local_mdop_revocation_state + local_mdop_artifact
spec: apps/connector/src/mdop/mdop-node.spec.ts
evidence: **三道拦截互不替代**。① 复核期：`MdopReviewService.review` 只用**本地输入**（本地合约副本、本地白名单、用部署固定注册中心公钥验过的算子清单），逐项给出固定错误码 —— 用途与本地合约不符 `E_PURPOSE_MISMATCH`、本地没有该合约副本 `E_CONTRACT_UNSIGNED`、合约过期/撤销 `E_CONTRACT_EXPIRED`、本方子图重算标签与声明不符 `E_LABEL_VIOLATION`、边界边目标不在合约接收方列表 `E_CAPABILITY_MISMATCH`、算子未加白/已吊销 `E_OP_NOT_WHITELISTED`/`E_OP_REVOKED`、片段哈希或 `plan_hash` 对不上 `E_TICKET_INVALID`；**拒签只回错误码与一句说明**，不回传本地策略原文。② 执行前：`verifyTicketForExecution` 校验「本院签名的凭证核心与数据快照（用本院公钥）+ 平台签名（用部署固定的平台节点公钥）+ 有效期 + 片段哈希」，并用**与复核时同一组入参**重算数据快照，不一致即 `E_SNAPSHOT_CHANGED`；平台或第三方改一个字节、或用他钥伪造本院接受 → 拒绝执行。③ 出节点：`MdopEgressGuard` 与编译、复核的结论**无关地**只放行 C3，且目标必须在本地合约接收方列表里。用例覆盖：平台改片段 → `E_TICKET_INVALID`；他钥伪造接受签名 → 执行器拒绝；用错密钥的信封 → `E_AUTH_INVALID`；C0 制品出节点 → 拒绝；C3 目标不在接收方列表 → 拒绝
note: 如实边界——① **他院签名只可审计、不可防伪**：本院只能验证「本院自己签过这份计划」，无法证明别院真的用其私钥签了它（那需要对方的私钥或远程证明）。别院签名的价值在于事后审计与责任归属，不作为本院放行的依据。② 复核读的是**本地合约副本**，平台随消息附带的合约内容一律不采信；副本本身的可信度由 CTL-26（参与方密钥自持 + 平台副署用部署固定的平台节点公钥验）承担。③ 本期 C1/C2 与可信空间节点在协议里保留、硬件 TEE 到位前**编译期即拒**（D-MDOP-6），所以"能力匹配"目前只可能落在 plain/wasm 环境上，不得据此声称具备机密计算能力。④ 连接器的已复核片段与凭证目前**只在内存**，重启后靠平台按至少一次投递重发要约与凭证来恢复（重放要约会重新走一遍七项复核，失败即拒，仍 fail-closed）；本地持久化留待后续变更。
```

```yaml control
id: CTL-28
title: MDOP 终态销毁（收齐回执才算销毁）+ 审计回执链 + 链头锚定（链不可达不伪造交易号）
norm: [D-MDOP-1, D-MDOP-6, TC609-6-2025-15 使用控制, MDOP v0.2 §8.5/§10.3]
threat: 作业跑完中间制品（含 C0 行级数据）在院内无限留存；平台宣称"已销毁"但没有可核验的回执；连接器漏报或篡改审计事件而平台看不出来；链不可达时伪造一个交易号充数（监管与三方核验据此得出错误结论）
enforcement:
  - ts:apps/api/src/mdop/mdop-purge.service.ts#orchestratePurge
  - ts:apps/api/src/mdop/mdop-purge.service.ts#onPurgeReceipt
  - ts:apps/connector/src/mdop/mdop-local-store.ts#putArtifact
  - ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#ingestAuditReceipt
  - ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#verifyChain
  - ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#anchorChainHead
db: cp_mdop_receipt + cp_mdop_job + local_mdop_artifact + local_mdop_receipt
spec: apps/api/src/mdop/mdop-purge-receipts.spec.ts
evidence: **销毁**——作业进 `SUCCEEDED`/`FAILED`/`ABORTED` 后，平台给每个持有中间制品的节点发 `PurgeOrder`（平台的 C3 交付物是交付物，不销毁）；连接器删本地制品行并按**本院私钥**签 `PurgeReceipt` 回传；平台**收齐全部节点回执**才把作业置 `PURGED`，缺回执按原幂等键重发（连接器返回同一回执）。用例：`PurgeOrder` 后按句柄读取必失败；重复指令返回同一回执；TTL 到期自主销毁并出 `ttl` 回执。**回执链**——连接器每个事件（复核接受/拒绝、阶段成功/失败、销毁）出一条签名回执，`prev_receipt_hash` 指向该节点上一条的哈希；平台 `ingestAuditReceipt` 逐节点校验连续性，断链**拒收并指出是在第几条断的**（用例构造断链并断言被检出、且被拒），离线工具 `apps/connector/scripts/verify-receipt-chain.mjs` 用同一判据复算。**锚定**——链头在作业终态时与每 30 分钟经 `AttestationService` 锚定上链（见 CTL-06 的存证适配器），链不可达时记 `pending` 进补偿队列并**返回 `pending` 而不是交易号**；真实演练中两院链头分别上链到 block 23/24（DEPLOY.md §4.2 有作业号与交易号）
note: 如实边界——① 「销毁」的证明强度止于**回执**：平台无法证明连接器真的删了数据，只能验证回执是本院的签名且与下发的句柄集一致；院内主机与存储层的删除可验证性属另一课题（安全删除/介质擦除）。② 回执链是**按节点**的链，平台逐节点校验连续性，不做跨节点的全局排序（各节点时钟与到达顺序不同）。③ 锚定只把**链头哈希**上链，链上不含任何患者衍生内容。④ 连接器的审计回执上报目前是**尽力而为**（周期重试，失败只告警）——回执链一旦断链，平台会拒收后续回执并留痕，不会静默通过。
```

```yaml control
id: CTL-29
title: 服务计算托管语料物理销毁与回执链强制
norm: [TC609-6-2025-15 使用控制, D-SC-1, D-MDOP-6]
threat: 服务计算托管语料在合约到期或撤销后继续留在节点磁盘被非法调用；节点宣称已销毁但缺少防篡改签名回执
enforcement:
  - ts:apps/connector/src/mdop/node/corpus-store.ts#CorpusStore
db: local_corpus_store + cp_digital_contract
spec: apps/connector/src/mdop/node/corpus-store.spec.ts
evidence: 语料以 C2 密态信封存盘，合约到期或收到 PurgeCorpusOrder 时对内存与载荷执行覆盖擦除（shred/zero-fill）；节点签发带有 SM2 签名的 CorpusPurgedReceipt；重复指令幂等返回同一份回执
note: 控制面永不沉淀明细数据或密钥，仅转运密文信封与记录元数据；销毁回执由节点自签并上报。
```

```yaml control
id: CTL-30
title: 合约服务协议参数空间边界校验与注入阻断（fail-closed）
norm: [TC609-6-2025-15 使用控制, D-SC-2]
threat: 消费方在高频服务查询中提交未声明的高维参数或注入谓词，对特定亚组发起差分探测嗅探个体隐私
enforcement:
  - ts:apps/connector/src/mdop/node/pipeline-executor.ts#ServicePipelineExecutor
  - ts:packages/mdop/src/schema/service-protocol.ts#parseServiceProtocolSpec
db: cp_digital_contract(mdopTerms.serviceProtocol)
spec: apps/connector/src/mdop/node/pipeline-executor.spec.ts
evidence: 查询执行前严格对拍合约 parameter_space：过滤列必须在 allowed_filter_columns 白名单内、查询时间跨度不得超出 max_time_window_days、分组字段必须在 allowed_grouping_columns 内、命中 prohibited_predicates 立即以 E_LABEL_VIOLATION 阻断（fail-closed）
note: 算子只能是经复现构建与白名单登记的零能力 wasm 算子，中间步骤强制标记 C0_internal 并在飞地内存驻留。
```

```yaml control
id: CTL-31
title: 累积差分隐私预算账本跨会话强制与防重放
norm: [TC609-6-2025-15 使用控制, D-SC-2]
threat: 消费方发起多次小量查询，各次看似合规但累加预算耗尽，或利用高频重放请求拖垮节点
enforcement:
  - ts:apps/connector/src/mdop/node/budget-ledger.ts#NodeQueryBudgetLedger
db: node_budget_ledger
spec: apps/connector/src/mdop/node/budget-ledger.spec.ts
evidence: 节点在解密前先判 assertServiceBudgetWithin（超限即拒且不扣减，不产生副作用）；严格检验总调用次数 <= max_queries、总累计 ε <= total_epsilon；小时速率超出 rate_limit_per_hour 时若开启 circuit_breaker_enabled 则自动触发合约级熔断（tripCircuitBreaker），后续查询一律拒绝
note: 与单任务预算账本并联，服务计算采用合约维度跨会话累计；熔断状态需经管理员人工核实并显式重置。
```

## 敏感字段分级登记

> **分册（D-SPD-1 / P11.4）**：医疗包敏感字段（患者标识 / 本地假名与临床 / 金标准）在
> [PACK-TRUST-med.md](PACK-TRUST-med.md)；本表只留**基座共用**字段（用户账号类）。
> 控制点编号（CTL-*）与红线清单不按册拆，仍是全空间唯一。

分级：**直接标识** / **准标识** / **假名** / **去标识临床**。出域许可：**永不** / **仅聚合（过闸门）** /
**仅哈希**。机制含 `@EncryptedColumn`/`@Masked` 的行与代码装饰器**双向机检**：装饰器出现而
未登记 = 红；登记而装饰器不存在 = 红（示例文件 `.example.` 除外）。

| 字段 | 位置 | 分级 | 机制 | 出域许可 |
|---|---|---|---|---|
| 用户邮箱 | `apps/api/src/common/dto/user.dto.ts#email` | 直接标识 | @Masked("email") | 永不 |
| 用户姓名 | `apps/api/src/common/dto/user.dto.ts#fullName` | 直接标识 | @Masked("name") | 永不 |
| 用户手机号 | `apps/api/src/common/dto/user.dto.ts#phoneNumber` | 直接标识 | @Masked("phone") | 永不 |

新增敏感字段流程：先在本表登记（定分级 + 机制 + 出域许可）→ 加装饰器/脱敏逻辑 → 跑校验。
示例参考：`packages/database/src/entities/patient.entity.example.ts`（不参与对拍）。

## 红线清单

1. **`sm-crypto` 引用白名单**（现状即白名单，新增出现即违规）：
   控制面：`apps/api/src/security/crypto/`、`apps/api/src/blockchain/adapters/chain.adapter.ts`
   （其余经 `GMCryptoService`，收敛 = TD-5）。
   连接器平面（独立 app，无 GMCryptoService）：`apps/connector/src/domain/sm3.ts`（唯一 SM3 入口，
   其余连接器代码经此 helper，不得直引 sm-crypto）。
   MDOP 共享包：`packages/mdop/src/crypto/`（连接器侧使用的国密原语；共享包不可能依赖 apps/api 的 Nest 服务）。
   构建期工具：`packages/wasm-algorithms/scripts/`（不在任何运行时信任路径上）。
   **守护已落地（v2 → 实机检，`node scripts/check-crypto-imports.mjs`，已挂进 `pnpm test`，含 6 条负例自检）**：
   未登记直引即红；**在册偏离还清后仍留在名单里也判红**（防名单变成永久豁免）；名单条目路径不存在判红。
   实测现状（2026-09-26）：直引 9 个文件 = 白名单 6 + 在册偏离 3。
   **在册偏离**（契约字面之外的控制面直引：已登记、待偿还，**不是**合规）：
   `apps/api/src/common/canonical-json.ts`（纯函数工具、拿不到注入的服务，需先定形）、
   `apps/api/src/runtime/participant-identity/platform-key-store.ts`、
   `apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts`（后两处改走 `GMCryptoService.sm3` 即可还清）。
   —— **更正说明（2026-09-26）**：本条此前写「守护：grep（v2 自动化）」，但**那个守护从未被写出来**
   （仓内无 grep 脚本、无 ESLint 规则、无钩子），且白名单自 2026-09 起即与代码不符
   （`packages/mdop/src/crypto/` 与 `wasm-algorithms/scripts/` 从未被列入）。故本轮一并补上实机检，
   并把字面之外的直引如实登记为在册偏离——与红线 4「v2 → 实机检」同一处置。
2. **闸门阈值禁裸写**：小单元格/KM 判断一律引用 `DEFAULT_MIN_CELL` / `DEFAULT_MIN_AT_RISK`
   （DOMAIN·派生公式），业务代码新出现裸 `< 5` 单元格判断即违规。
2b. **未过闸聚合禁出网（merge-then-gate）**：`runUngatedForTrustedMerge` / 明文 ungated 计数仅允许同进程可信编排；
   经 `connector→control` 的 assignment 回执与跨域边仍须 OutputGate 产物（CTL-01）。跨网对等用 HE/`runEncrypted`
   或安全聚合，禁止把 ungated 当生产 egress。
3. **控制面禁行级医疗字段**：cp_* 实体与跨域 DTO 不得新增患者可识别字段（姓名/证件/联系方式/
   生日/地址/诊断明细）。守护：DOMAIN 覆盖矩阵 + 本册分级表 + FLOWS crosses 红线三重机检。
4. **TEE 表述红线（D-RWS-4 / CTL-09）**：`attestationLevel` 已贯穿（实体列 + 回执 + 链 payload +
   `TeeAttestation.level`），当前值恒 `software`；值为 `software` 时任何 UI/合约/对外文档**不得
   声称硬件级机密计算**。
   **守护已落地（v2 → 实机检，`node scripts/check-tee-claims.mjs`，挂进 `pnpm test`）**，三条：
   ① **`attestationLevel` 不得写成 `hardware`**（仓库内任何位置，含测试）——它是医院/agent 执行环境的
   自述口径，硬件远程证明真正接入并跑通演练前恒 `software`，改口径要改受控来源而不是在业务代码里写字面量；
   ② **`level: 'hardware'` 只许出现在证明契约**（`packages/mdop/src/attestation/**`）与测试夹具里——
   可信空间节点的硬件结论只能由证明提供者产出（`mapVendorQuote`），别处写它就是在没有厂商证明根的地方虚构；
   ③ **`isolation: 'hardware-enclave'` 只许出现在证明契约、节点组件与测试夹具里**——医院侧执行环境
   没有硬件飞地。三条都只认赋值写法，类型联合与「判定是不是硬件级」的比较不误伤（负例自检 8 条）。

## 待接入控制点（有条款，机制未落地——不入正册）

| # | 缺口 | 规范/决策锚点 | 现状 | 接入点 |
|---|---|---|---|---|
| ~~P-CTL-1~~ | ~~attestationLevel 字段贯穿~~ | D9 / D-RWS-4 | **已落地（2026-07-21）→ 移入正册 CTL-09** | — |
| P-CTL-2 | TEE 硬件远程证明（海光 CSV） | D9 | SoftwareSealedCompute 为同进程软件实现：无隔离、无远程证明，seal/run 仅保持硬件飞地调用契约；每次运行的 software 级证明（分析函数源码 SM3 度量，`isolation=none`）写入连接器本地审计 `tee-run` | tee.ts 可插拔抽象换硬件实现 |
| P-CTL-3 | DP ε 预算账本 | D5（"DP + 小单元格抑制"） | `outputPolicy.dp` 已预留但恒 `mode=none`；闸门现为合约 minCell + 小单元格/KM 截断，**无 ε 加噪/记账** | output-gate 消费 epsilon + 预算账本 |
| P-CTL-4 | sidecar 密钥治理 + 多节点共识 | D-RWS-3-a / D-RWS-3-b / D-RWS-5 | 文件系统私钥 + 硬编码口令 + solo 单节点。**L1「可独立归因」已落地（2026-09-20，openspec connector-endorsement-on-chain）**：RWS 存证 payload 按贡献方带连接器对 `resultSm3` 的 SM2 背书，第三方凭平台 CA 公钥可脱离平台核验某院背书（`GET /attestation/trust-anchor` + `scripts/verify-endorsement.mjs`）→ 见正册 CTL-23；**L2 多节点共识 / 医院背书节点未落地**，链仍单节点平台运营，「平台遗漏/不锚某条记录」仍无对抗手段 | fly-services/chain-sdk 入 Vault + 多节点（L2）；医院背书节点（L3） |
| P-CTL-5 | Wasmtime 独立进程运行算法（**进程隔离**；fuel 已按决策放弃） | D-CN-2 / D-CN-5 | **第一版已落地（2026-09-18）**：V8 WebAssembly + worker 线程、只允许 `env.memory` 导入、超时/内存上限、失败不回退 → 见正册 CTL-20；**但仍是同进程沙箱**（未固定模块的分析仍走内置 TS + 闭合语法 CTL-10）。**诉求已收窄**：原两项收益里「fuel 确定性资源裁决」2026-09-20 决定不追求（见 D-CN-5 落地补注 + CTL-24 note），仅余「独立进程隔离防引擎逃逸」；该风险当前由 OS 层兜底（cap_drop/只读 FS/internal 网络 + seccomp overlay）承担。代价侧事实：Node 无可用 Wasmtime 绑定（官方包 npm 不存在，社区包停在 0.0.2/2023-05），须改写为 Rust 独立执行进程 | Rust 独立执行进程（stdio/socket 喂投影、收计数；`SandboxRunner` 抽象不变）|
| P-CTL-6 | 专用算法签名密钥（与 CA 根密钥分离）+ 算法包静态审计 | D-CN-2 | **第一版已落地（2026-09-18）**：模块 SM3（AssemblyScript 锁定版本可复现构建，产物与清单入库）+ 平台 SM2 签名双重校验、合约固定 SM3 → 见正册 CTL-20。**签名密钥已由「注册中心密钥」承接**（mdop-kernel / D-MDOP-3 三钥分离：算子清单与算法模块统一走 `registry`，不再是 CA 根密钥；见正册 CTL-26）。仍未做模块字节的静态审计（反编译/能力扫描） | 连接器侧 storeAttestation 前静态审计（签名密钥已就位） |
| P-CTL-7 | 第三方算法模块准入闸（源码-only 两层准入 + 五道闸 + 吊销） | D-CN-5 | **五道闸已落地（2026-09-20，openspec third-party-wasm-module-admission）→ 见正册 CTL-24**：源码-only（Rust/AssemblyScript，平台锁定工具链双构建器复现出 SM3，复现不出即无法入册 → 不透明二进制结构性排除）、闸 1 静态白名单（平台侧与连接器侧**同一份实现** @medtrust/wasm-algorithms）、闸 3 沙箱动态测试（一致性/确定性/资源/防外泄/模糊）、闸 4 影子发布状态机（不得跳闸）、闸 5 吊销名单（随长轮询下发、版本单调、PEP 执行前拒）。**按决策不做**：Wasmtime fuel（确定性资源裁决）——见 D-CN-5 落地补注；资源上限本身在（超时 + 内存）。seccomp profile 已在本机 Linux 容器实测通过（沙箱全路径 + 真实 entrypoint，0 EPERM；反证 profile 生效）；**仍未落地**：独立进程隔离归 P-CTL-5 | ali29 首次上机核对日志后并入常规部署命令；进程隔离见 P-CTL-5 |
| P-CTL-8 | 可信空间节点（C2）的硬件远程证明与密钥释放 | D-MDOP-6 / **D-TEE-1 / D-TEE-2 / D-TEE-3 / D-TEE-4** / MDOP v0.2 §4.5、§9.3、§9.4 | **协议核心、节点运行时与可部署节点组件已落地；判定开关已翻转（2026-09-26）；硬件与真实 KMS 未落地，C2 在任何真实部署里仍为零**：协议已写好 C2 的完整语义（信封 + 使用策略 + `attestation_policy` + 证明绑定密钥释放），放置判定改判为「**目标节点的证明登记有效、且与合约证明策略相符**」（`MdopJobsService#assertC2Target` / `MdopAttestationService#assertUsableForC2` / `packages/mdop` 的 `label/lattice.ts#validateEdge` C2 分支，均有正反例用例）；数据持有方连接器能力通告的 `tee` 字段恒 `null`（**设计意图**：持有方不是可信空间节点，通告 TEE 的是节点自己）。**方向已定、开关已翻转**：2026-09-25 立变更 `openspec/changes/tee-confidential-node`，D-MDOP-6 补注登记了开启方向与三条硬前提并于 **2026-09-26 登记开关翻转**（翻转的是判定方式、不是能力），D-TEE-1/D-TEE-2 定下运营方与密钥释放权分离、节点内强制预算与发布审查，D-TEE-3 定证明链条件式默认，D-TEE-4 定首个场景为跨院队列交集。**已落地的 enforcement（有符号、有用例，但不足以转正册）**：出口守卫 `apps/connector/src/mdop/mdop-egress.ts`、节点入口/出口守卫与发布审查/预算/回执/销毁 `apps/connector/src/mdop/node/*`、会话装配 `node-session.ts`、KMS 释放判据 `packages/mdop/src/attestation/release.ts`、凭据核对 `attestation/kms.ts`、**会话见证的独立核验**（协议核 `attestation/witness.ts#verifySessionWitness`、平台 `MdopAttestationService#ingestWitness`、持有方 `apps/connector/src/mdop/node/witness-verify.ts#NodeWitnessVerifier`，均有用例）、**可部署节点组件** `apps/connector/src/tee-node/`（证明提供者接缝 `providers.ts#createAttestationProvider`、能力通告 `providers.ts#nodeCapabilityAdvertisement`（真跑一次证明得出，配置写着 `tdx` 也骗不过编译器）、证明探针 `attestation-probe.ts`、注册与心跳 `registration.ts`、运维 store `operator-store.ts`、常驻运行时 `runtime.ts`，均有 spec）。**仍缺的 enforcement**：真实证明链与真实 KMS 客户端（现为可插拔接缝 + 本机演练实现）、真实厂商信任根实现。**因此本条不转正册**（本册开篇规则：写不出 enforcement 的条款只是愿望）。**如实边界**：这条通道落地后也 MUST NOT 表述为「数据没有出医院」——它换的是信任锚（CPU 厂商证明根 + 代码度量 + 可信空间运营方 + KMS 释放策略），合规定性变成**委托处理/数据出域**（见 REGULATORY REG-08），且内存访问模式侧信道不在 TDX/SEV-SNP 防护范围内。运营方归属是前置条件：药企自建节点时医院常不接受，通常须中立第三方或监管侧运营、密钥释放权留在持有方或共管 | ①硬件（海光 CSV / TDX / SEV-SNP）与 DCAP 证明链（**云上默认形态可在线取 collateral**：TDX 走 PCCS / Intel PCS；CSV 走厂商证明服务 / 自托管 trustee；SEV-SNP 走 AMD KDS。**离线/受限网络路径仅在节点部署于院内时才是前置**，路径已明确：TDX 走 PCCS 私有化或预取 collateral 完全离线校验；CSV 走自托管 trustee `attestation-service` + RVPS；SEV-SNP 走缓存 VCEK→ASK→ARK；该形态下残余项＝collateral 新鲜度策略与厂商根获取程序）；②KMS 释放策略（quote 校验 + 度量白名单 + TCB 下限 + 证明过期即拒）；③`cp_mdop_attestation` 登记与链上锚定；④出口守卫扩展为「C3 或（C2 且目标经证明）」+ 本地复核独立校验证明；⑤查询预算 + DP + 发布审查**在节点内由被测代码强制**。**转正条件**：真实证明代理与真实 KMS 落地并跑通 §9.2/§9.3 演练（enforcement 符号与 spec 路径已齐——节点证明代理 `apps/connector/src/tee-node/providers.ts#nodeCapabilityAdvertisement`、KMS 策略引擎 `packages/mdop/src/attestation/release.ts#evaluateKeyRelease`、出口守卫 `apps/connector/src/mdop/mdop-egress.ts`；缺的是真实实现与硬件），方可移入正册 CTL-29 | 

> **P-CTL-8 落地进展（2026-09-25 补）**：可信空间节点已成为**一等参与方**，不只是在节点内跑一次算好的阶段——
> 平台发来的五类消息都有处置判据：要约（`tee-node/fragment-review.ts#reviewFragmentForNode` 的九项本地复核 →
> **节点自己签名接受**，平台收齐全部片段签名才签发凭证）、凭证（当场校验含执行环境快照比对）、
> C2 信封（按已复核片段里的入边绑定到阶段，`node-messages.ts#bindRelayToStage`）、阶段派发
> （信封与派发两个来源会合，齐了才执行）、销毁指令（销毁制品并回签名回执，链上 `PURGED`）。
> 节点侧快照的语义（执行环境快照而非数据快照）登记为 **D-TEE-5**。
>
> **2026-09-26 补：判定开关已翻转（D-MDOP-6 翻转补注）**——C2 边不再「一律拒」，改判「目标节点的
> 证明登记有效且与合约证明策略相符」；**软件实现不得作为 C2 目标**由三处独立保证（背书只收硬件链型
> `packages/mdop/src/attestation/push.ts`、能力通告取自真跑证明、连接器恒通告 `tee: null`）。
> 因为没有任何硬件节点时没有任何节点会通告 `tee{kind}`，**C2 在任何真实部署里仍为零**，
> **这不改变本条的转正结论**：真实证明代理与真实 KMS 客户端仍未落地，因此 P-CTL-8 继续留在待接入表。
>
> **同日另补：collateral 新鲜度（D-TEE-3 残余项 ①）从文字要求变成机制。** 真实信任根
> （`TrustedRootWithCollateral`）**必须**声明「必须随带的材料种类 + 离线刷新窗口」，校验器由
> `createHardwareAttestationVerifier` 产出：缺料 / 已过期 / 超出刷新窗口 / 时间倒挂一律拒
> （`E_ATTESTATION_FAILED`，KMS 不释放密钥）。因此「接了真实链却忘了判材料时效」不再是一个
> 可以悄悄发生的缺口——它变成**装配不出来**。
>
> **2026-10-07 补：节点内算子链路的四处加固（提交前代码评审的遗留项，均有正反例用例）。**
> ① **阶段阈值不得弱于合约**：单阶段出口路径的发布阈值取「合约 `publication.minCell` 与阶段参数的较大值」
> （`tee-node/node-messages.ts` 的 `minCellOf`，与降密算子同一条规矩；此前是阶段参数优先）。
> ② **编码白名单 fail-closed**：平台模板、持有方封存投影、节点执行器三层都不再把无效白名单当成「不过滤」——
> 封存投影里白名单**必填**（`apps/connector/src/mdop/operators/seal.ts`），缺失 / 为空 / 非数组 / 夹着非字符串即封存失败。
> ③ **失败说明不带数据**：节点在明文上跑算子的唯一入口（`tee-node/wasm-runner.ts#createNodeWasmRunner`）
> 把非协议错误换成固定文案，原文（可能带行值或审查前计数）只进**节点本地日志**；发布审查的拒放说明同口径。
> ④ **出域层键闭合语法**：分层键 `<年龄段>|<性别>` 的判据收在 `packages/mdop/src/schema/stratum-key.ts`，
> 模板（`strataKeys` 参数）、封存投影（行上的 `ageBand` / `sex`）、节点（参数 + 算子结果里的每个层键，
> 先于发布审查）共用同一份——持有方行里的自由文本不能再借层键进 C3。
> **如实边界**：语法挡的是自由文本，不挡「用合规取值的组合编码信息」（年龄段是任意数字区间）；
> 那一类仍靠小单元格抑制与查询预算。持有方连接器自己的阶段失败说明（`mdop-node.service.ts`）不在本次范围。

## 威胁模型摘要（三边拓扑 → 控制点）

| 边 | Top 威胁 | 控制点 |
|---|---|---|
| 控制面 | 越权任务提交；合约外用途；元数据库混入行级数据 | CTL-04 / CTL-02 / INV-ID-01 |
| 连接器 | 原始数据被当"结果"导出；小格重识别；假名可逆；院内库账号过宽 / 视图漏标识 / 静默改读文件 | CTL-01 / CTL-14 / CTL-02 / CTL-03 / CTL-25 |
| 链与通道 | 身份伪造；通道窃听；存证抵赖；sidecar 密钥泄露 | CTL-05 / CTL-08 / P-CTL-4 |
| 可信空间节点（C2，待接入） | 运营方越权读内存 / 控制引导与固件；伪造或复用证明；度量被换版；TCB 过旧；用查询预算绕过出域闸反推个体；把「密文出域」说成「数据没出医院」 | P-CTL-8（+ D-TEE-1 / D-TEE-2，待接入） |

## 附录：格式契约

1. **control 块**：围栏 info-string 恰为 `yaml control`。字段：`id`（唯一，`CTL-<NN>`）、
   `title`、`norm`（数组）、`threat`、`enforcement`（token 列表，语法同 DOMAIN 附录）、
   `db`、`spec`、`evidence`。
2. **分级表**：`## 敏感字段分级登记` 下的表，5 列，第 2 列为反引号包裹的 `路径#字段`。
   机制列含 `@EncryptedColumn`/`@Masked` 的行与代码装饰器双向对拍；其余行校验路径与字段存在。
3. 装饰器扫描范围：`packages/database/src` + `apps/api/src`（`.example.` 文件除外）。
