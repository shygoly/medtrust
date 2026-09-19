# DOMAIN.md — MedTrust 领域本体（双平面）

> **机器可校验的领域契约**。改任何实体、TypeORM model、`apps/api/src/runtime/` 服务或
> `apps/connector/src/domain/` / `apps/agent/src/medtrust_agent/` 域逻辑前，
> 先读本文件对应 `##` 小节（**按聚合切片读取，勿全文加载**）。
> 改动涉及表/关系/公式/状态词汇时**必须**同步对应小节，并跑 `node scripts/check-meta-docs.mjs`。
> 本文件同时是 **D-CN-1 的跨语言对齐载体**：`apps/connector`（NestJS，rws-worker 生产：
> L1.5–L3 计算+闸门）与 `apps/agent`（Python，重计算节点：L3 内核/L4 训练）共享的规格
> 以此为准，enforcement 用 `ts:` / `py:` 双前缀登记。
> 表格与 YAML 块的格式契约见「附录：格式契约」。

## 覆盖矩阵

一表一平面（`control-plane` = 中心元数据库，`connector-local` = 参与方本地库）。
**同一张表出现在两个平面即违反 D7**；控制面表出现行级医疗数据即违反 D1。

| 实体表 | 平面 | 小节 |
|---|---|---|
| cp_participant | control-plane | 参与方身份 |
| cp_certificate | control-plane | 参与方身份 |
| cp_ca_keypair | control-plane | 参与方身份 |
| cp_connector_registry | control-plane | 参与方身份 |
| cp_org_certification_application | control-plane | 机构认证 |
| cp_data_product | control-plane | 目录与数据产品 |
| cp_remote_catalog | control-plane | 目录与数据产品 |
| cp_digital_contract | control-plane | 数字合约 |
| cp_rws_task | control-plane | RWS 编排 |
| cp_rws_assignment | control-plane | RWS 编排 |
| cp_fl_prediction_task | control-plane | RWS 编排 |
| cp_fl_prediction_assignment | control-plane | RWS 编排 |
| cp_attestation_ref | control-plane | 存证 |
| blockchain_attestations | control-plane | 存证 |
| cp_connector_audit_digest | control-plane | 存证 |
| cp_settlement_record | control-plane | 结算 |
| cp_settlement_line | control-plane | 结算 |
| cp_federation_trust | control-plane | 跨空间互联 |
| cp_interop_subject | control-plane | 跨空间互联 |
| cp_open_platform_app | control-plane | 空间管理 |
| cp_kri_definition | control-plane | RBQM 监查 |
| cp_kri_observation | control-plane | RBQM 监查 |
| cp_qtl_breach | control-plane | RBQM 监查 |
| cp_space | control-plane | 空间管理 |
| tenants | control-plane | 租户与审计 |
| users | control-plane | 租户与审计 |
| refresh_tokens | control-plane | 租户与审计 |
| audit_logs | control-plane | 租户与审计 |
| auth_captchas | control-plane | 租户与审计 |
| verification_codes | control-plane | 租户与审计 |
| favorites | control-plane | 租户与审计 |
| compute_tasks | control-plane | 遗留隐私计算 |
| tee_computations | control-plane | 遗留隐私计算 |
| mpc_sessions | control-plane | 遗留隐私计算 |
| federated_learning_jobs | control-plane | 遗留隐私计算 |
| flower_servers | control-plane | Flower 联邦学习 |
| flower_tasks | control-plane | Flower 联邦学习 |
| flower_results | control-plane | Flower 联邦学习 |
| flower_audit_logs | control-plane | Flower 联邦学习 |
| l1_scenario | control-plane | 能力分级体系 |
| l2_anonymization_degree | control-plane | 能力分级体系 |
| l2_approval_rule | control-plane | 能力分级体系 |
| l2_block_rule | control-plane | 能力分级体系 |
| l2_guardrail | control-plane | 能力分级体系 |
| l2_risk_policy | control-plane | 能力分级体系 |
| l2_security_capability | control-plane | 能力分级体系 |
| l3_model | control-plane | 能力分级体系 |
| l4_algorithm | control-plane | 能力分级体系 |
| l5_operator | control-plane | 能力分级体系 |
| l6_protocol | control-plane | 能力分级体系 |
| l7_infrastructure | control-plane | 能力分级体系 |
| compliance_evaluation | control-plane | 能力分级体系 |
| composition | control-plane | 能力分级体系 |
| local_record | connector-local | 连接器本地 |
| local_audit_log | connector-local | 连接器本地 |
| local_gold_standard | connector-local | 连接器本地 |
| xian_user_links | control-plane | 租户与审计 |
| sso_tickets | control-plane | 租户与审计 |

## 空间管理（apps/api/src/runtime/space）

覆盖表：cp_space, cp_open_platform_app

cp_open_platform_app 为开放平台应用（P2-6）：只存 appKey 的 SHA-256 哈希，密钥仅在创建时明文返回一次；供西安节点等外部系统调用本空间开放 API 时校验。

### 关系

| 源列 | 目标 | 语义 | 强制点 | 备注 |
|---|---|---|---|---|
| cp_data_product.homeSpace | cp_space.id | 产品所属空间 | ts:apps/api/src/runtime/space/space.service.ts#SpaceService | 软引用；seed 空间 id 与 demo-scenario SPACE_ID 一致 |
| cp_ca_keypair.spaceId | cp_space.id | 中心 CA 根密钥按空间 | ts:apps/api/src/runtime/participant-identity/ca.service.ts#CaService | 软引用 |

### 不变量

```yaml invariant
id: INV-SPACE-01
tables: [cp_space]
desc: 空间的创建/删除仅限 operator 角色；空间 id 唯一且非空；默认空间（id 与 demo-scenario SPACE_ID 一致）开机幂等种子，目录/合约引用真实空间 id
trigger: SpaceController 创建 / 删除空间
enforcement:
  - ts:apps/api/src/runtime/space/space.service.ts#SpaceService
db: none
spec: apps/api/src/runtime/space/space.service.spec.ts
```

## 参与方身份（apps/api/src/runtime/participant-identity）

覆盖表：cp_participant, cp_certificate, cp_ca_keypair, cp_connector_registry

### 关系

| 源列 | 目标 | 语义 | 强制点 | 备注 |
|---|---|---|---|---|
| cp_certificate.participantId | cp_participant.id | 证书归属参与方 | ts:apps/api/src/runtime/participant-identity/participant-registry.service.ts#ParticipantRegistryService | SQLite 无 FK，软引用由服务层维护 |
| cp_connector_registry.participantId | cp_participant.id | 连接器归属参与方 | ts:apps/api/src/runtime/participant-identity/participant-registry.service.ts#ParticipantRegistryService | 同上；wsSessionId 记 WS 会话映射 |
| cp_ca_keypair.spaceId | —（按空间单例） | 中心 CA 的 SM2 根密钥对 | ts:apps/api/src/runtime/participant-identity/ca.service.ts#CaService | 开机加载而非每次重生，否则重启使已签发证书全部失效 |

角色语义：`provider` = 数据提供方（医院）/ `consumer` = 数据使用方（药企/研究院）/
`operator` = 平台运营/监管（只读监督）。前端另有 `compliance` 展示角色（DESIGN.md §8），不入本表。

### 不变量

```yaml invariant
id: INV-ID-01
tables: [cp_participant]
desc: 任务准入要求参与方双认证齐备（subjectVerified 主体认证 + dataVerified 数据资源认证）且角色匹配，未过则抛 AdmissionDeniedError
trigger: 任务提交 / 目录上架等准入动作
enforcement:
  - ts:apps/api/src/runtime/participant-identity/participant-registry.service.ts#AdmissionDeniedError
db: none
spec: apps/api/src/runtime/participant-identity/participant-registry.service.spec.ts
```

```yaml invariant
id: INV-CERT-01
tables: [cp_certificate]
desc: 安全通道建立必须校验对端 SM2 证书未过期（validUntil）且未吊销（revoked=false）；吊销采用拉模式传播（D-ID-1），revoked 后下一次校验即拒
trigger: 连接器↔中心 / 连接器↔连接器建立安全通道
enforcement:
  - ts:apps/api/src/runtime/participant-identity/secure-channel.service.ts#SecureChannelService
db: none
spec: apps/api/src/runtime/participant-identity/secure-channel.service.spec.ts
```

## 机构认证（apps/api/src/runtime/organization）

覆盖表：cp_org_certification_application

状态机：`draft → submitted → approved / rejected`；`rejected` 可修改重提；`approved` 后不可编辑，需变更联系运营方。

```yaml
entity: cp_org_certification_application
plane: control-plane
field_notes:
  - userId: 与 users 表松散关联(跨库,无 FK),一个用户最多一条申请(唯一索引)
  - licenseImages/logoKey: 只存对象存储 key,不落盘本地文件(P1-6)
  - caPublicKey/caCertFingerprint: 用户本地生成 SM2 密钥对后仅上报公钥/指纹,私钥永不上传
  - capitalWanYuan: numeric,单位万元;uscc: 18 位统一社会信用代码
trigger: 用户中心「账号与身份」三步流程(填写基本信息 → 完善认证信息 → 完成机构入驻)
enforcement:
  - ts:apps/api/src/runtime/organization/organization.service.ts#OrganizationService
db: control-plane
spec: apps/api/src/runtime/organization/organization.service.spec.ts
```

## 目录与数据产品（apps/api/src/runtime/catalog）

覆盖表：cp_data_product, cp_remote_catalog

`cp_data_product.productType`（`data` / `service`）区分数据产品目录与数据服务目录（TC609 P0-2）；
服务目录复用发布/申请/合约全链路，仅在目录层按类型过滤。
`cp_data_product.classificationTag` 为 NDI-TR-2025-06 结构化分级标签（级别+类别编码+标签版本，
TC609 P1-8）；`status`（`active` / `archived`）实现目录生命周期（更新/下架，TC609 P1-1）。

### 关系

| 源列 | 目标 | 语义 | 强制点 | 备注 |
|---|---|---|---|---|
| cp_data_product.providerId | cp_participant.id | 产品所属提供方 | ts:apps/api/src/runtime/catalog/catalog.service.ts#CatalogService | 软引用 |
| cp_data_product.urn | —（全局唯一） | 全局标识 urn:tds:<space>:<product> | ts:apps/api/src/runtime/catalog/catalog.service.ts#CatalogService | D11；unique 索引 |
| cp_remote_catalog.spaceId | cp_federation_trust.spaceId | 远端产品所属空间 | ts:apps/api/src/runtime/federation/federation.service.ts#FederationService | 只读缓存，原始数据绝不进入 |

### 不变量

```yaml invariant
id: INV-CAT-01
tables: [cp_data_product]
desc: 目录只登记元数据（fhirSchema 结构 / recordCount 计数），绝不汇聚原始数据；确权 rightsConfirmed 与结构化分级 classificationTag 是任务准入的门槛字段；archived 产品不可新申请
trigger: CatalogService 上架 / 更新数据产品
enforcement:
  - ts:apps/api/src/runtime/catalog/catalog.service.ts#CatalogService
db: none
spec: apps/api/src/runtime/catalog/catalog.service.spec.ts
```

## 数字合约（apps/api/src/runtime/digital-contract）

覆盖表：cp_digital_contract

### 关系

| 源列 | 目标 | 语义 | 强制点 | 备注 |
|---|---|---|---|---|
| cp_digital_contract.dataProductId | cp_data_product.id | 授权标的 | ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService | 软引用 |
| cp_digital_contract.providerId / consumerId | cp_participant.id | 缔约双方 | ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService | 软引用 |

约束四元组：`purpose`（目的限定）/ `retention`（留存，如 阅后即焚）/ `output`（出域预设展示标签，如 聚合 + 模型参数）/ `validUntil`（有效期）。结构化闸门字段 `outputPolicy`（preset / allowedArtifacts / minCell / dp）随合约持久化并快照进 assignment；PEP 与 OutputGate 以 `outputPolicy` 为准（见 INV-PEP-01、D-DC-2）。`dp.mode` 第一期固定 `none`（真实 ε 账本见 TRUST P-CTL-3）。

### 不变量

```yaml invariant
id: INV-DC-01
tables: [cp_digital_contract]
desc: 合约生成即算 SM3 哈希用于上链存证；revoke 立即生效（fail-closed，D-DC-1）并触发在途任务补偿中止，不存在"完成当前批"宽限
trigger: ContractService 创建 / revoke
enforcement:
  - ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService
db: none
spec: apps/api/src/runtime/digital-contract/contract.service.spec.ts
```

```yaml invariant
id: INV-PEP-01
tables: [cp_digital_contract]
desc: 连接器每个计算 step 前 PEP 校验合约（active 状态 / 目的 / 有效期 / outputPolicy.allowedArtifacts 与 allowedLevels），违规抛 PolicyViolation；revoked 后下一次校验即拒；OutputGate 消费合约 minCell（下限 DEFAULT_MIN_CELL=5）
trigger: 连接器执行任务的每一步
enforcement:
  - ts:apps/connector/src/domain/policy-enforcement.ts#PolicyEnforcementPoint
db: none
spec: apps/connector/src/domain/policy-enforcement.spec.ts
```

## RWS 编排（apps/api/src/runtime/rws-orchestrator + fl-orchestrator）

覆盖表：cp_rws_task, cp_rws_assignment, cp_fl_prediction_task, cp_fl_prediction_assignment

### 关系

| 源列 | 目标 | 语义 | 强制点 | 备注 |
|---|---|---|---|---|
| cp_rws_assignment.taskId | cp_rws_task.taskId | 分派归属任务 | typeorm | @ManyToOne，onDelete CASCADE |
| cp_fl_prediction_assignment.taskId | cp_fl_prediction_task.taskId | FL 分派归属任务 | typeorm | 同上 |
| cp_rws_task.contractIds | cp_digital_contract.id | 任务依据的合约集 | ts:apps/api/src/runtime/rws-orchestrator/rws-admission.service.ts#RwsAdmissionService | simple-json 数组，准入时校验 |
| cp_rws_assignment.providerId | cp_participant.id | 分派目标医院 | ts:apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts#RwsOrchestratorService | 软引用 |

字段红线：`cp_rws_assignment.aggregate` / `cp_rws_task.merged` **只允许聚合结果**（计数/效应量/曲线），
出现行级字段即违反 D1（闸门保证见 INV-GATE-01）。

### 不变量

```yaml invariant
id: INV-RWS-01
tables: [cp_rws_task, cp_rws_assignment]
desc: task.status=completed 要求全部 assignment completed；partial = 部分 provider 失败/被撤但仍出剩余聚合（补偿语义，配合 D-DC-1）；merged 由各 assignment.aggregate 合并而来，只存聚合
trigger: RwsOrchestratorService 收敛任务状态
enforcement:
  - ts:apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts#RwsOrchestratorService
db: none
spec: apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.spec.ts
```

## 存证（apps/api/src/runtime/digital-contract + apps/api/src/blockchain）

覆盖表：cp_attestation_ref, blockchain_attestations, cp_connector_audit_digest

### 关系

| 源列 | 目标 | 语义 | 强制点 | 备注 |
|---|---|---|---|---|
| cp_attestation_ref.taskId | cp_rws_task.taskId | 证据归属任务 | ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService | kind ∈ policy \| task \| output |
| cp_connector_audit_digest.participantId | cp_participant.id | 审计摘要归属连接器参与方 | ts:apps/api/src/runtime/connector-audit/connector-audit.service.ts#ConnectorAuditService | 链式 prevHash 对拍 → chainOk |

### 不变量

```yaml invariant
id: INV-ATT-01
tables: [cp_attestation_ref, blockchain_attestations]
desc: 上链 payload 只含哈希/指纹/时间戳/块高（任务定义哈希、策略哈希、输入指纹 inputFingerprint、输出哈希 outputHash），永不含行级数据或聚合明细（D6）；payload 与回执携带 attestationLevel 如实标注 TEE 等级（CTL-09）
trigger: AttestationService 写链（经 ChainMaker sidecar，D-RWS-3）
enforcement:
  - ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService
db: none
spec: apps/api/src/runtime/digital-contract/attestation.service.spec.ts
```

## 结算（apps/api/src/runtime/settlement）

覆盖表：cp_settlement_record, cp_settlement_line

### 关系

| 源列 | 目标 | 语义 | 强制点 | 备注 |
|---|---|---|---|---|
| cp_settlement_line.recordId | cp_settlement_record.id | 分账行归属台账 | typeorm | @ManyToOne，onDelete CASCADE，eager |
| cp_settlement_record.taskRef | cp_attestation_ref.txHash | 台账锚定任务存证哈希 | ts:apps/api/src/runtime/settlement/settlement.service.ts#SettlementService | 保证结算可追溯（D12） |

### 不变量

```yaml invariant
id: INV-SETTLE-01
tables: [cp_settlement_record, cp_settlement_line]
desc: 台账 append-only（更正用新条目，不改旧行）；分账 amount = total × contribution / contributionTotal；contribution 取自任务真实产出的 cohortSize（D-VS-1），绝不可由 consumer 单方提交
trigger: 任务完成后 SettlementService 生成台账
enforcement:
  - ts:apps/api/src/runtime/settlement/settlement.service.ts#SettlementService
  - ts:apps/connector/src/domain/settlement.ts#SettlementService
db: none
spec: apps/api/src/runtime/settlement/settlement.service.spec.ts
```

## RBQM 监查（apps/api/src/runtime/rbqm）

覆盖表：cp_kri_definition, cp_kri_observation, cp_qtl_breach

风险导向质量管理（RBQM）的质量信号层（rbqm-central-monitoring）。三张表全部是**聚合/元数据**，与结算台账同性质，永不落个体行级数据（D1/D7）。

- **cp_kri_definition** — KRI（关键风险指标）定义。`riskTier`（routine|elevated|intensive）与 `thresholds`（分层阈值数组 `[{level, op, value}]`）共同表达 CSDR「分类分层」；`direction`（higher_worse|lower_worse）决定越限比较方向。系统不内置 KRI 优劣排序，分层是配置不是硬编码。
- **cp_kri_observation** — 站点级 KRI 观测。连接器在院内把本地明细算成聚合三元组 `{numerator, denominator, value}`，经输出闸门小格抑制（硬底 5，`suppressed=true` 时计数清零）后仅回传此结构 + 元数据（站点/周期/KRI code）；`sourceDigest` 为连接器聚合结果的 SM3 摘要。
- **cp_qtl_breach** — QTL（质量容差限）越限记录。观测入库即按 KRI 分层阈值判定，命中最严重层级则记录，证据摘要经 AttestationService 上链（不可达降级 `0xLOCAL:` 本地回执）；进入合规告警流。

派生：`value = numerator / denominator`（比例，0–1）；`severity = max(命中的 thresholds.level)`（critical > warning）。

## 跨空间互联（apps/api/src/runtime/federation）

覆盖表：cp_federation_trust, cp_interop_subject

信任清单 = 本空间信任的其他空间 CA 公钥集合（D11 / D-ID-1：静态清单 + 拉模式吊销）。
远端目录缓存见「目录与数据产品」的 cp_remote_catalog。跨空间任务的计算仍在源连接器本地完成。
cp_interop_subject = 丝路数港区域节点同步的注册主体缓存（P2-2）；participantId 映射到 cp_participant.id，
主体权威信息用于机构认证「从丝路数港带入」，不替代本空间 CA 密码学身份。

## 租户与审计（apps/api/src/auth + tenant + audit）

覆盖表：tenants, users, refresh_tokens, audit_logs, auth_captchas, verification_codes, favorites

多租户底座与审计日志，先于联邦化存在，继续服役。users.tenantId → tenants（软引用）；
refresh_tokens 归属 users；auth_captchas 为登录图形验证码（P0-3，答案只存哈希、一次性）；
verification_codes 为邮箱/短信验证码（P0-6/P1-2/P1-8，答案只存哈希、一次性、短时有效）；
favorites 为用户收藏（P1-11，与 users 同库，productId 松散关联 cp_data_product）。
敏感字段的加密/脱敏登记见 TRUST.md 分级表。

## 遗留隐私计算（apps/api/src/compute-task + privacy）

覆盖表：compute_tasks, tee_computations, mpc_sessions, federated_learning_jobs

中心化时期的计算任务与隐私计算会话实体。`compute_tasks.requestId` 是已删除的
`access-request` 的残迹列（无关系）；新任务走 RWS 编排聚合（cp_rws_task 族），
本族不再扩展。

## Flower 联邦学习（apps/api/src/flower）

覆盖表：flower_servers, flower_tasks, flower_results, flower_audit_logs

外部 Flower FL 服务的会话/结果实体，由 flower 模块自注册。L4 联邦预测的新路径走
cp_fl_prediction_task 族 + `apps/agent` fed_trainer，本族维持现状。

## 能力分级体系（packages/database/src/capability）

覆盖表：l1_scenario, l2_anonymization_degree, l2_approval_rule, l2_block_rule, l2_guardrail, l2_risk_policy, l2_security_capability, l3_model, l4_algorithm, l5_operator, l6_protocol, l7_infrastructure, compliance_evaluation, composition

七层能力目录（L1 场景 → L7 基础设施）+ 合规评估 + 能力组合，`capability` 模块的
声明式配置库（seeder 灌种子数据）。纯元数据，无行级医疗数据。

## 连接器本地（apps/connector/src/domain + apps/agent/src/medtrust_agent）

覆盖表：local_record, local_audit_log, local_gold_standard

**这三张表只存在于参与方本地库（ConnectorDataSource），是全仓唯一可含（脱敏后）
行级数据的地方。** local_record.subjectKey 是哈希假名，绝不是真实患者标识；
ageBand 是 birthDate 的粗化段。local_gold_standard 承载算法验证用的金标准标注
（rws-algorithm-validation D1）——判定结论敏感度等同临床诊断，**永不出域**；
跨域载荷只含 2×2 混淆矩阵计数（TP/FP/TN/FN）。

### 不变量

```yaml invariant
id: INV-PLANE-01
tables: [local_record, local_audit_log]
desc: 连接器本地实体只经 ConnectorDataSource 注册，绝不进入控制面 DataSource；控制面任何实体不得新增行级医疗字段（D1/D7）
trigger: 新增/修改实体注册
enforcement:
  - ts:packages/database/src/data-sources.ts#ConnectorDataSource
db: none
spec: TODO
```

```yaml invariant
id: INV-DEID-01
tables: [local_record]
desc: 摄入即脱敏：直接标识符剥离、patientId → subjectKey 哈希假名、birthDate → ageBand 粗化；原始源行永不落库
trigger: 连接器摄入（FHIR/Synthea 数据源）
enforcement:
  - ts:apps/connector/src/domain/deidentifier.ts#Deidentifier
  - py:apps/agent/src/medtrust_agent/dataset.py
db: none
spec: apps/connector/src/domain/deidentifier.spec.ts
```

```yaml invariant
id: INV-RAW-01
tables: [local_record, local_audit_log]
desc: 外部主体读原始行一律拒绝（RawAccessDeniedError）且必须留痕 local_audit_log(action=raw-read-blocked)；本地审计对拦截事件强制记录
trigger: LocalStore 任何读访问
enforcement:
  - ts:apps/connector/src/domain/local-store.ts#RawAccessDeniedError
db: none
spec: apps/connector/src/domain/local-store.spec.ts
```

```yaml invariant
id: INV-GATE-01
tables: [local_record, cp_rws_assignment]
desc: 任何出域结果必过输出闸门，同步 fail-closed（D-UC-2）：L1.5–L3 在 worker（ts）侧——小单元格 n<5 抑制（DEFAULT_MIN_CELL）、L2 小分层抑制后重算效应量、L3 KM 尾部 atRisk<5 截断（DEFAULT_MIN_AT_RISK），任一失败抛 OutputBlocked；L4/SecretFlow 模型工件在 agent（py）侧过安全信封白名单（build_safe_result）；抑制/拦截必须留审计痕
trigger: 连接器任务执行完成、结果回传前
enforcement:
  - ts:apps/connector/src/domain/output-gate.ts#OutputGate
  - ts:apps/connector/src/domain/km-gate.ts#gateKmCurve
  - py:apps/agent/src/medtrust_agent/output_guard.py
db: none
spec: apps/connector/src/domain/output-gate.spec.ts
```

## 跨聚合级联与不变量

跨聚合写路径全景（详细定义见各聚合小节的 invariant 块）：

| 触发 | 级联 | invariant / 决策 |
|---|---|---|
| 合约 revoke | 在途 assignment 注入 COMPENSATE，立即中止 | INV-DC-01 / INV-PEP-01 / D-DC-1 |
| 证书 revoked | 安全通道下一次校验即拒 | INV-CERT-01 / D-ID-1 |
| 全部 assignment 终态 | task 收敛 completed / partial / failed | INV-RWS-01 |
| 任务完成出域 | 异步存证上链 + 结算台账（fail-open + 补偿队列） | INV-ATT-01 / INV-SETTLE-01 / D-UC-2 |
| raw-read 尝试 | 拒绝 + local_audit_log 留痕 | INV-RAW-01 |
| 闸门抑制 | 抑制计数留审计痕，结果继续或整体阻断 | INV-GATE-01 |

## 派生公式与单位约定

- **L1.5 失衡信号（四格表）**：a=目标药×目标事件，b=目标药×其他事件，c=其他药×目标事件，
  d=其他药×其他事件。PRR = [a/(a+b)] / [c/(c+d)]；ROR = (a·d)/(b·c)。
  本地建表 ts:apps/connector/src/domain/rws-executor.ts#disproportionalityTables；
  中心合并 ts:apps/api/src/runtime/rws-orchestrator/disproportionality.ts（跨院四格表按格相加后重算）。
- **L2 比较效果 Meta**：分层四格表 → 效应量+SE（ts:apps/connector/src/domain/comparative-effect.ts#effectEstimateFromStratifiedTables），
  中心随机效应合并（DerSimonian-Laird，ts:apps/api/src/runtime/rws-orchestrator/meta-analysis.ts#MetaAnalysisService）。
- **L3 因果推断**：倾向评分匹配/IPTW（py:apps/agent/src/medtrust_agent/psm_iptw.py）→
  Cox HR + KM 曲线（py:apps/agent/src/medtrust_agent/cox_km.py）；ts 侧经
  apps/connector/src/domain/causal/causal-executor.ts 委托 agent；中心合并
  apps/api/src/runtime/rws-orchestrator/causal-effect-merge.ts。
- **L4 联邦预测**：各方本地训练、只交换模型更新（py:apps/agent/src/medtrust_agent/fed_trainer.py），
  中心编排 apps/api/src/runtime/fl-orchestrator/fl-orchestrator.service.ts。
- **L0 算法验证（rws-algorithm-validation）**：识别算法在本地与金标准逐主体比对，产出 2×2 混淆矩阵
  （TP/FP/TN/FN），是本能力**唯一**的跨域载荷（与 L1.5 四格表结构同构但语义不同——L1.5 是暴露×结局，
  L0 是分类器判定×金标准）。准确性指标定义的**唯一出处**：
  - **灵敏度** Se = TP/(TP+FN)
  - **特异度** Sp = TN/(TN+FP)
  - **阳性预测值** PPV = TP/(TP+FP)
  - **阴性预测值** NPV = TN/(TN+FN)
  - **95% 置信区间** = Wilson score interval（z=1.959963984540054）；小样本与极端比例下稳健，
    高特异度（Sp→1）时上界不越界（Wald 会越界，故不取）。
  本地计算 ts:apps/connector/src/domain/algorithm-validation/stats.ts#wilsonScoreInterval；
  闸门联动 ts:apps/connector/src/domain/output-gate.ts#passValidation（任一格 < DEFAULT_MIN_CELL 则
  四指标全部 fail-closed）；中心**不做 meta 合并**，按 providerId 分列
  （ts:apps/api/src/runtime/rws-orchestrator/l0-validation-merge.ts）。
- **闸门阈值**：小单元格默认 / 下限 `DEFAULT_MIN_CELL = 5`（apps/connector/src/domain/output-gate.ts）；合约 `outputPolicy.minCell`（5–20）可上调，由 OutputGate / passValidation 读取；
  KM 尾部 `DEFAULT_MIN_AT_RISK = 5`（apps/connector/src/domain/km-gate.ts）。业务代码禁止
  另写裸 5，一律引用常量。py 侧 output_guard.py 是 **L4/SecretFlow 安全信封白名单闸**
  （build_safe_result，拦非白名单工件），不是 n<5 聚合闸——n<5 闸门在 worker（ts）侧。
- **RWS 研究设计时间窗**（对齐药监《RWD 支持药品安全性主动监测的研究设计和分析指导原则》
  征求意见稿 §2.6–2.7）：载体是 `TteSpec`（ts:apps/connector/src/domain/types.ts#TteSpec），
  即目标试验模拟（Target Trial Emulation）框架的部分实现。字段 ↔ 规范要素对应：
  - **零时刻（time zero）** = `timeZeroRule`：进入队列的时点规则，随访自此计时。
  - **宽限期（grace period）** = `graceDays`：两次处方之间允许的最大间隔；
    处方时间 + 宽限期 = 暴露期（用于处理因检查等原因推迟用药）。
  - **洗脱期 / 回顾期（washout / lookback）** = `washoutDays`：识别"新用药者"所需的
    既往未用药时长；新用药设计据此控制幸存者偏倚与现用药者偏倚。
  - **删失（censoring）** = `outcome.censoring` ∈ {`administrative`（研究截止）,
    `loss_to_followup`（失访）}。
  - **纳排** = `inclusion[]` / `exclusion[]`：当前为自由文本；操作性定义载体已由 L0 的
    `IdentificationAlgorithm`（ts:apps/connector/src/domain/types.ts#IdentificationAlgorithm）提供，
    但 `inclusion[]`/`exclusion[]` 字段本身**未强制引用算法**——两种形式并存，自由文本仍被接受
    （何时转强制见 rws-study-protocol-spec change）。
  规范要求但当前无字段承载的要素：诱导期（induction）、滞后期（lag）、随访窗口上下界
  （规范定义为"介于最短与最长诱导期之间"）、流行病学设计类型（队列 / 巢式病例对照 /
  病例交叉等）及其选型理由。上述缺口登记于待建的 `EVIDENCE.md`（研究效度契约），
  本节只做定义与量纲的唯一出处。
- **统计方法值域与选型**（规范 §3.3 表3 / 附1）：`CausalMethod`
  （ts:apps/connector/src/domain/types.ts）是因果方法值域的**唯一出处**，当前
  = `psm | iptw | cox`；新增方法必须同步该类型与下表。

  | 数据 / 混杂情形 | 规范建议方法 | 本仓实现 |
  |---|---|---|
  | 多协变量、可观测混杂 | 倾向评分（匹配 / 加权 / 分层 / 入模） | `psm`·`iptw`（py:apps/agent/src/medtrust_agent/psm_iptw.py） |
  | 生存结局 | Cox 比例风险回归 | `cox`（py:apps/agent/src/medtrust_agent/cox_km.py） |
  | 罕见结局 | Poisson / 负二项回归 | 未实现 |
  | 高维且共线交互的混杂 | 机器学习 | 未实现（L4 FedAvg 是联邦预测，非混杂控制用途） |
  | 时间依赖性混杂 | G 方法（G-formula / MSM / SNM）、风险集匹配 | 未实现 |
  | 未观测混杂 | 工具变量法；E-value 等敏感性分析 | 未实现 |

  倾向评分**仅能处理可观测混杂**，残余混杂需另做敏感性分析（规范附1·2）——
  故 L3 结论的适用边界以此为准，不得表述为"已控制全部混杂"。
- **分账公式**：amount_i = total × contribution_i / contributionTotal；contribution = 该院
  cohortSize（人数，整数）。任何计价模型（按任务/按记录/订阅）都按此占比分（D12/D-VS-1）。
- **单位与格式**：金额 real + currency 列；时间列 datetime，时区 Asia/Shanghai；validUntil 为
  ISO 字符串；哈希展示格式见 DESIGN.md §6（SM3: 前6…后6）。

## 状态词汇表

- cp_rws_task.status / cp_fl_prediction_task.status（`RwsOrchestrationStatus` / `FlOrchestrationStatus`）：
  `pending / running / completed / partial / failed`。**partial 是本域特有终态**：部分 provider
  失败或被撤，剩余聚合仍出（补偿语义，INV-RWS-01）。定义于 packages/database/src/control-plane/index.ts。
- cp_rws_assignment.status / cp_fl_prediction_assignment.status：`pending / running / completed / failed`。
- cp_rws_assignment.executionIsolation（algorithm-sandbox / D-CN-2，`ExecutionIsolation`）：
  `none / wasm-sandbox`。**与该院这次实际执行路径一致，缺省 none**（旧版连接器回传不带标注时按 none）。
  与 attestationLevel **正交**：executionIsolation 说"算法代码能力是否受限"，attestationLevel 说
  "执行环境有没有硬件远程证明"；沙箱落地不改变 attestationLevel（CTL-09）。
  标注来源 = 聚合结果内 `aggregate.execution.isolation`（受结果 SM3 覆盖），入库时枚举校验，
  非法值 400 拒绝。`cp_rws_assignment.moduleSm3` = 该院实际用的模块 SM3（wasm-sandbox 时必填）。
  **任务级取最弱**：任一医院 none → 任务级 executionIsolation = none（`weakestExecutionIsolation`）。
- cp_digital_contract.status（`ContractStatus`）：`draft / active / expired / revoked`；revoked 立即生效（D-DC-1）。
- cp_digital_contract.pinnedModules（algorithm-sandbox「固定算法模块」条款，simple-json）：
  形如 `{ "<分析类型>": "<模块 SM3>" }`，表示数据提供方同意**仅以该份模块代码**执行该分析类型。
  计入合约哈希（canonical 的 `pinnedModules` 字段，键排序 + SM3 小写归一化）→ 改动只能新建合约，
  不得修改已存证合约；值必须在平台算法模块注册表内且分析类型与模块登记一致。
  合约固定了模块时，派发记录携带 `module: { analysisType, sm3 }`，PEP 校验一致后才执行。
- cp_digital_contract.preReview（合规预审裁决快照，simple-json，可为空；D-CMP-2）：申请合约时按
  **当前** L2 规则 + 事实推导维度重裁决后写入，结构 `{ compositionId, evaluationId, verdict, overallRisk,
  required, dimensions, dimensionSources, dimensionConflicts, rulesDigest, evaluatedAt }`。
  **跨库按值引用**：预审（composition）与裁决（compliance_evaluation）在主库、合约在控制面 SQLite，
  同属 control-plane 平面但为两个物理库，合约按值保存快照、**不建跨库外键**——主库记录事后被删改，
  快照仍能说明签发时的依据。计入合约哈希（canonical 的 `preReview` 字段）→ 改动即验哈希失败。
  无快照的旧合约 = 未预审：可查看/撤销，但**不能创建新任务**（fail-closed，不设宽限期，D-CMP-2）。
- cp_digital_contract.preReviewAck（需审批确认，simple-json，可为空）：预审裁决为 `manual_review` 时
  医院签发须提交 `{ by, reason, at }`（by = 签发医院 participantId）；裁决为 `auto_approve` 时不接受该入参。
  一并计入合约哈希。
- 风险维度来源（`preReview.dimensionSources` 的值，`DimensionSource`）：`derived | declared`
  = **由系统事实推导 / 由申请方自报**。事实优先：能推导的维度（数据敏感度 ← 数据产品分级标签、
  是否含人类遗传资源 ← 类别对照、参与机构数 ← 任务实际涉及医院数）一律用推导值并标 `derived`；
  无事实来源的（如跨境）用自报值标 `declared`。自报值比推导值风险低时记入 `preReview.dimensionConflicts`
  （疑似低报，给出警告）。
- composition.ownerParticipantId（预审归属，可为空）：创建预审的数据使用方 participantId，软引用
  cp_participant.id（跨库、按值）；合约申请校验"预审属于该药企"据此判定，引用他人预审即拒。
- compute_tasks.status（`ComputeTaskStatus`，遗留族）：`pending / running / completed / failed / cancelled`
  （packages/database/src/entities/compute-task.entity.ts）。
- 前端展示词汇与上同源：apps/web/src/types/task-status.types.ts（色值迁移中，TD-2）；
  状态→颜色唯一映射以 DESIGN.md §2 为准，**partial 上屏前须先在 DESIGN §2 登记**。
- cp_certificate：无 status 列，`revoked` 布尔 + `validUntil` 时间双闸；无独立 CRL 实体（D-ID-1）。
- cp_connector_registry.healthStatus：`online` / `offline` / `unknown`（默认 `unknown`）。`online` 由心跳写入；`listRegistry`/`GET /connectors/status` 在 `lastSeen` 超过 `CONNECTOR_OFFLINE_MS`（默认 60s）时计算为 `offline`。`lastHeartbeat`（simple-json）存版本/任务状态/资源水位。
- cp_attestation_ref.kind：`policy / task / output` 三类证据。
- l1_scenario / l3_model … l7_infrastructure.status（能力层 `CapabilityObject`）：`active / draft / deprecated`
  = **已落地（编排可选）/ 目录已登记但平台未落地（不可选）/ 已退役（不可选）**，fail-closed：非 active 一律不可编排。
  依据写 `metadata.impl`；种子由叠加层 `packages/database/src/capability/seed-data/landing.ts`（逐项代码核实）写入，
  与忠实转写行业分类学的 `taxonomy.ts` 解耦；运营方在 `/space/atlas/<layer>` 维护，新建对象默认 `draft`。
- cp_rws_task.protocolVersion（rws-study-protocol-spec §1.2）：整数，初始 1，每次实质性修订递增。
  `frozenAt` 时间戳标记首次派发的冻结时刻——pullPending 首次将任务从 pending 切到 running 时
  写入（幂等，re-dispatch 不覆盖）。冻结后冻结集字段（designType / rationale / tte 全部子字段 /
  matchingCovariates / allowedArtifacts / SAP / missingness / sensitivityAnalyses）不可变，变更须
  经 POST /rws/tasks/:id/revise 开新版本 + 必填 `revisionReason`（详见 EVD-07/08）。非冻结字段
  （标题、目标参与方列表）派发后仍可改，不产生新版本。`protocolWarnings`（simple-json 字符串
  数组）承载准入告警（缺失值未声明、结局-暴露独立性未校验等可选要素），由
  `computeProtocolWarnings` 在提交/修订时产出。

## 术语表

- **平面（plane）**：实体归属的信任域。control-plane = 中心元数据库；connector-local = 参与方本地库。
- **出域**：任何数据从连接器本地库越过信任边界（回传中心/上链/跨空间）。合法出域物只有三种：
  任务回执聚合、证据哈希、密文/模型更新。
- **聚合结果**：计数、效应量+SE、匹配后 HR/ATE、KM 曲线（截断后）、模型更新——不含任何行级字段。
- **四格表**：药物警戒 2×2 列联表（a/b/c/d），L1.5 唯一跨域载荷。
- **attestationLevel**：TEE 信任级别（`software`|`hardware`，当前恒 software，D9/D-RWS-4/CTL-09）。贯穿 cp_attestation_ref / cp_rws_task / cp_fl_prediction_task 列、AttestationReceipt 回执、链 payload metadata 与 TeeAttestation.level；类型唯一出处 packages/database/src/control-plane/index.ts。
- **executionIsolation**：执行隔离标注（`none`|`wasm-sandbox`，D-CN-2/CTL-20），与 attestationLevel
  **正交**。`wasm-sandbox` = 算法模块在零能力 Wasm 沙箱内运行（只导入宿主提供的有上限内存，
  无网络/文件/进程/系统调用），**不表示进程隔离、更不表示 TEE**；`none` = 连接器内置实现
  （软件、同进程）。写在聚合结果内部 `aggregate.execution`（受结果 SM3 覆盖），控制面按医院
  入库（cp_rws_assignment.executionIsolation / moduleSm3），任务级取最弱，并写入存证元数据。
  类型唯一出处 packages/database/src/control-plane/index.ts。
- **数字合约 vs 链上合约**：数字合约 = cp_digital_contract 承载的授权四元组（TC609 语义）；
  链上合约 = ChainMaker 上的 MedicalDataAttestation 存证合约（D6）。两词禁止混用。
- **数据产品**：连接器对外提供的一等对象（元数据/质量/用法），URN 格式 `urn:tds:<space>:<product>`（D11）。
- **双认证**：主体认证 subjectVerified + 数据资源认证 dataVerified，准入门槛（INV-ID-01）。
- **贡献度（contribution）**：结算口径 = 任务真实 cohortSize（D-VS-1），编排器产出，不可自报。
- **subjectKey**：本地记录的哈希假名主体键，永不等于真实患者标识（INV-DEID-01）。
- **ageBand**：出生日期粗化后的年龄段，去标识手段之一。
- **OMOP CDM**：Observational Medical Outcomes Partnership 通用数据模型，真实世界数据事实标准。
  **目标态**（D-CN-3）：连接器数据访问接口层暴露 OMOP CDM 只读/脱敏视图，受限接口
  `query_omop(sql)` 只回聚合。**当前态**：connector-local 用 `LocalRecord.clinical`
  （`Record<string,unknown>` 自由 JSON），尚未映射到 CDM——改本地数据模型前以此为准。

方法学术语（对齐药监《RWD 支持药品安全性主动监测的研究设计和分析指导原则》征求意见稿；
承载对象见「派生公式与单位约定·RWS 研究设计时间窗」）：

- **两层定义**：任何研究人群与关键变量都须分两层——**概念性定义**（基于医学知识界定变量涉及
  哪些数据元素）→ **操作性定义**（转化为可执行的提取规则：编码 / 算法 + 评估时间窗）。
  同一概念性定义在不同数据源下操作性定义可能不同，故**算法准确性必须随结果报告**。
- **目标试验模拟（TTE, Target Trial Emulation）**：不是一种研究设计类型，而是设计框架——
  把观察性研究按"若做一个随机试验会怎么设计"逐要素对齐，以控制不死时间偏倚等。
  本仓载体 = `TteSpec`。
- **新用药设计（New User Design）** / **现用药设计（Prevalent User Design）**：前者仅纳入
  研究起始时首次用药（或经洗脱期）的患者，控制幸存者偏倚；后者纳入已用药一段时间者，
  可能引入信息偏倚。本仓经 `washoutDays` 表达前者。
- **不死时间偏倚（Immortal Time Bias）**：研究开始到真正暴露之间患者必须存活的时段，
  若被错误计入暴露时间则效应估计失真。零时刻规则（`timeZeroRule`）是主要防线。
- **错分偏倚（Misclassification Bias）**：暴露 / 结局 / 协变量被划入错误类别。常规诊疗数据
  非为研究而生，错分更常见；对策是算法验证研究 + 定量偏倚分析 + 敏感性分析。
  本仓对①已落地：算法验证研究 = L0（`analysisType: algorithm-validation`，EVD-05），
  产出 Se/Sp/PPV/NPV + 95%CI；②③仍缺口（P-EVD-6）。
- **金标准（Gold Standard）**：变量识别算法准确性评估的参照——某变量定义在个体上的"真实"
  判定结论。来自人工病历审阅（登记库 / 专病库 / 本研究审阅），敏感度等同临床诊断，
  **永不出域**；本仓载体 = `local_gold_standard`（connector-local 平面，D1）。
  本系统**不产生**金标准，只消费医院侧已有的标注。
- **混淆矩阵（Confusion Matrix）**：算法判定 × 金标准的 2×2 计数表（TP/FP/TN/FN），
  L0 唯一跨域载荷；语义上不同于 L1.5 暴露×结局的四格表（`a/b/c/d`）。
- **操作性定义载体（IdentificationAlgorithm）**：变量的操作性定义在系统中的结构化载体——
  编码集（`CodeSet`：编码系统 + 版本 + 编码列表 + 取值来源 + 诊断顺序四要素）+ 闭合布尔
  组合规则（AND/OR/NOT + 时间窗）+ 算法版本号。**禁止通用表达式求值**（D4 / CTL-10）。
- **残余混杂**：数据库未采集因而无法被倾向评分等方法调整的混杂；只能靠工具变量、
  E-value、阴性对照等间接评估。
- **DAG（有向无环图）**：用于区分混杂因素 / 中介变量 / 效应修饰因子 / 碰撞变量的图形工具，
  指导协变量选择。本仓当前无 DAG 结构承载（协变量以 `matchingCovariates` 平铺表达）。
- **结局定义独立于暴露**：药品暴露状态不得作为结局定义的组成部分（规范 §2.7.4 硬要求）。
  本仓经 `outcomeAlgorithm` × `exposureAlgorithm`/`comparatorAlgorithm` 编码集交集校验强制
  （结构化路径 fail-closed；自由文本路径降级警告，见 EVD-06）。

rws-study-protocol-spec 术语（方案先行 / 预先设定）：

- **SAP（Statistical Analysis Plan，统计分析计划）**：研究开始前预先制订的分析方案
  （规范 §3.1）。本仓载体 `RwsAnalysis.sap`（`SapPlan`：显著性水平、检验效能、样本量假设、
  多重性校正方式）。Phase 1 形状校验；Phase 2 按层级（D4）转必填。
- **多重性 α 校正（Multiplicity Adjustment）**：涉及多亚组或多药-事件组合比较时对显著性
  阈值的校正（Bonferroni / Holm / BH-FDR 等），控制族系错误率（规范 §3.1）。判定不按层级
  而按"是否多重比较"——L1.5 扫多组合同样须声明（见 EVD-09）。
- **缺失机制（Missingness Mechanism）**：MCAR（完全随机）/ MAR（随机）/ MNAR（非随机）
  三类假设（规范 §3.4）。决定填补方法的适用性，故 `MissingnessDeclaration` 要求机制与
  填补策略配对声明（见 EVD-11）。
- **敏感性分析（Sensitivity Analysis）**：用不同假设 / 方法定义重复主分析以检验结论稳健性
  （规范 §3.5）。本仓 `SensitivityAnalysisDeclaration`（id + description）；声明项必须全部
  随主分析回传，缺项阻断出具（见 EVD-10，Phase 2/3 启用对账）。
- **绝对风险 vs 相对风险**：相对风险（OR/HR/RR）在低基线下严重误导（规范 §3.1 要求同时
  报告）；本仓 `EffectEstimatePayload.absoluteRisk`（riskDifference + CI + baselineRate）
  由过闸后 {a,b,c,d} 站点聚合计数派生，MUST NOT 由个体数据推算。

## 附录：格式契约

check-meta-docs.mjs 按以下契约解析本文件，破坏契约会导致校验失败：

1. **覆盖矩阵**：`## 覆盖矩阵` 下第一张表，表头恰为 `| 实体表 | 平面 | 小节 |`。
   必须且仅收录 `packages/database/src/**` 全部 `@Entity`（文件名含 `.example.` 的示例实体除外；
   未命名 `@Entity()` 按类名 snake_case 折算）。平面只许 `control-plane` | `connector-local`，
   一表恰好一行；每个「小节」必须存在对应 `## ` 标题。
2. **invariant 块**：围栏 info-string 恰为 `yaml invariant`。字段：`id`（唯一，
   `INV-<AREA>-<NN>` 或 `INV-<AREA>-GAP-<NN>`）、`tables`（数组）、`desc`、`trigger`、
   `enforcement`（token 列表）、`db`（约束名或 none）、`spec`（相对仓库根的 spec 路径；
   `TODO` = 待补，校验降级为 warning）。
3. **enforcement / actor token 语法**：`ts:<路径>#<符号>`（路径存在 + 符号可检索）|
   `py:<路径>[#<符号>]`（v1 只查路径存在，P-3）| `ui:<路径>` | `db-fk:<约束名>`（SQLite +
   synchronize 环境暂不校验，控制面迁 Postgres 后升级）| `typeorm` | `ext:<说明>` |
   `none`（备注必须给理由）。路径一律相对仓库根。
4. **关系表**：表头 `| 源列 | 目标 | 语义 | 强制点 | 备注 |`，v1 不做机器校验（列存在性
   校验待 v2），但强制点应使用上述 token 语法。
5. 解析空转兜底（MS-8）：覆盖矩阵或任一聚合小节解析为 0 行 = 格式契约破坏 = 红（防"表格被改成散文后静默通过"）。
