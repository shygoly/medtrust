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
   控制面：`apps/api/src/security/crypto/`、`apps/api/src/blockchain/services/vault-key.service.ts`、
   `apps/api/src/blockchain/adapters/chain.adapter.ts`（其余经 `GMCryptoService`，收敛 = TD-5）。
   连接器平面（独立 app，无 GMCryptoService）：`apps/connector/src/domain/sm3.ts`（唯一 SM3 入口，
   其余连接器代码经此 helper，不得直引 sm-crypto）。守护：grep（v2 自动化）。
2. **闸门阈值禁裸写**：小单元格/KM 判断一律引用 `DEFAULT_MIN_CELL` / `DEFAULT_MIN_AT_RISK`
   （DOMAIN·派生公式），业务代码新出现裸 `< 5` 单元格判断即违规。
2b. **未过闸聚合禁出网（merge-then-gate）**：`runUngatedForTrustedMerge` / 明文 ungated 计数仅允许同进程可信编排；
   经 `connector→control` 的 assignment 回执与跨域边仍须 OutputGate 产物（CTL-01）。跨网对等用 HE/`runEncrypted`
   或安全聚合，禁止把 ungated 当生产 egress。
3. **控制面禁行级医疗字段**：cp_* 实体与跨域 DTO 不得新增患者可识别字段（姓名/证件/联系方式/
   生日/地址/诊断明细）。守护：DOMAIN 覆盖矩阵 + 本册分级表 + FLOWS crosses 红线三重机检。
4. **TEE 表述红线（D-RWS-4 / CTL-09）**：`attestationLevel` 已贯穿（实体列 + 回执 + 链 payload +
   `TeeAttestation.level`），当前值恒 `software`；值为 `software` 时任何 UI/合约/对外文档**不得
   声称硬件级机密计算**。海光 CSV 远程证明接入前，代码出现 `'hardware'` 赋值即违规（grep 守护，v2）。

## 待接入控制点（有条款，机制未落地——不入正册）

| # | 缺口 | 规范/决策锚点 | 现状 | 接入点 |
|---|---|---|---|---|
| ~~P-CTL-1~~ | ~~attestationLevel 字段贯穿~~ | D9 / D-RWS-4 | **已落地（2026-07-21）→ 移入正册 CTL-09** | — |
| P-CTL-2 | TEE 硬件远程证明（海光 CSV） | D9 | SoftwareTee 为同进程软件实现：无隔离、无远程证明，seal/run 仅保持硬件飞地调用契约；每次运行的 software 级证明（分析函数源码 SM3 度量，`isolation=none`）写入连接器本地审计 `tee-run` | tee.ts 可插拔抽象换硬件实现 |
| P-CTL-3 | DP ε 预算账本 | D5（"DP + 小单元格抑制"） | `outputPolicy.dp` 已预留但恒 `mode=none`；闸门现为合约 minCell + 小单元格/KM 截断，**无 ε 加噪/记账** | output-gate 消费 epsilon + 预算账本 |
| P-CTL-4 | sidecar 密钥治理 + 多节点共识 | D-RWS-3-a / D-RWS-3-b | 文件系统私钥 + 硬编码口令 + solo 单节点 | fly-services/chain-sdk 入 Vault + 多节点 |
| P-CTL-5 | Wasmtime 独立进程运行算法（fuel 计量 + 更强隔离） | D-CN-2 | **第一版已落地（2026-09-18）**：V8 WebAssembly + worker 线程、只允许 `env.memory` 导入、超时/内存上限、失败不回退 → 见正册 CTL-20；**但仍是同进程沙箱，非 Wasmtime 独立进程**（未固定模块的分析仍走内置 TS + 闭合语法 CTL-10） | Wasmtime 运行时（`SandboxRunner` 抽象不变）+ 受限 host 接口（query_omop 只回聚合） |
| P-CTL-6 | 专用算法签名密钥（与 CA 根密钥分离）+ 算法包静态审计 | D-CN-2 | **第一版已落地（2026-09-18）**：模块 SM3（AssemblyScript 锁定版本可复现构建，产物与清单入库）+ 平台 CA SM2 签名双重校验、合约固定 SM3 → 见正册 CTL-20；**签名密钥仍是 CA 根密钥**，且未做模块字节的静态审计（反编译/能力扫描） | CA 签发专用算法签名密钥 + 连接器侧 storeAttestation 前静态审计 |
| P-CTL-7 | 第三方算法模块准入闸（源码-only 两层准入 + 五道闸 + 吊销） | D-CN-5 | **仅规格（openspec third-party-wasm-module-admission，未实现）**：Rust/AS 源码-only（平台复现构建产出 SM3，不接受不透明二进制/不设 Tier C）；五道闸（静态白名单 / 复现构建+签名 / 沙箱动态测试含防外泄 / 影子发布 / 运行时兜底+OS 隔离+吊销）尚未接线 | 五道闸接到 PEP + 合约固定模块链路（含准入层级 A/B + 审查背书）+ 吊销分发；落地后升级正册 CTL 并收编 P-CTL-5/6（Wasmtime + 静态审计） |

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
