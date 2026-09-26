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
| cp_module_admission | control-plane | 算法模块准入 |
| cp_module_revocation | control-plane | 算法模块准入 |
| cp_attestation_ref | control-plane | 存证 |
| blockchain_attestations | control-plane | 存证 |
| cp_connector_audit_digest | control-plane | 存证 |
| cp_mdop_outbox | control-plane | MDOP 内核 |
| cp_mdop_operator | control-plane | MDOP 内核 |
| cp_mdop_job | control-plane | MDOP 内核 |
| cp_mdop_fragment | control-plane | MDOP 内核 |
| cp_mdop_stage | control-plane | MDOP 内核 |
| cp_mdop_ticket | control-plane | MDOP 内核 |
| cp_mdop_signature_record | control-plane | MDOP 内核 |
| cp_mdop_handle | control-plane | MDOP 内核 |
| cp_mdop_delivery | control-plane | MDOP 内核 |
| cp_mdop_attestation | control-plane | MDOP 内核 |
| cp_mdop_receipt | control-plane | MDOP 内核 |
| cp_mdop_nonce | control-plane | MDOP 内核 |
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
| local_data_source_status | connector-local | 连接器本地 |
| local_mdop_contract | connector-local | MDOP 内核 |
| local_mdop_contract_pending | connector-local | MDOP 内核 |
| local_mdop_operator_whitelist | connector-local | MDOP 内核 |
| local_mdop_revocation_state | connector-local | MDOP 内核 |
| local_mdop_processed_key | connector-local | MDOP 内核 |
| local_mdop_nonce | connector-local | MDOP 内核 |
| local_mdop_artifact | connector-local | MDOP 内核 |
| local_mdop_receipt | connector-local | MDOP 内核 |
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

**数据源声明**（omop-data-source-access，D-CN-6/7）：`fhirSchema.dataSource` = `{type:'omop-cdm', label}`
或 `{type:'file', path}`，旧写法 `localDataPath`/`dataPath` 等同 file。类型唯一（CDM 声明不得再带文件路径），
CDM 声明只许 `type`+`label`——控制面对院内库只知道一个 label，凭据只在连接器侧。发布与更新时校验，
连接器派发用**同一个**解析器（`parseDataSourceDeclaration`）。
**覆盖元数据** `cp_data_product.coverage`：CDM 产品由连接器按 label 上报的 CDM / 词汇表版本、含数据的表
（数量级）与观察期（月粒度），外加新鲜度（`stale` + 原因）；改声明即清旧覆盖。

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

```yaml invariant
id: INV-CAT-02
tables: [cp_data_product]
desc: CDM 覆盖元数据只含统计量（版本标识 + 表的记录数量级 + 月粒度观察期，白名单格式，多一个字段整份拒收），只挂到认证出来的机构自己声明了该 label 的产品上；版本变化而统计未跟上、或数据源最近一次接入校验未通过 → 标待刷新，不以陈旧面目呈现
trigger: 连接器每次接入校验（启动 + 周期复核）后上报 POST /connector/data-sources/:label/coverage
enforcement:
  - ts:packages/database/src/control-plane/data-source-coverage.ts#validateCoverageReport
  - ts:packages/database/src/control-plane/data-source-coverage.ts#mergeCoverage
  - ts:apps/api/src/runtime/catalog/catalog.service.ts#CatalogService
db: none
spec: apps/api/src/runtime/catalog/catalog.service.spec.ts
```

## MDOP 内核（apps/api/src/runtime/digital-contract + apps/connector/src/mdop + packages/mdop）

覆盖表：cp_mdop_outbox（控制面发件箱）· cp_mdop_operator（算子清单）· cp_mdop_job / cp_mdop_stage / cp_mdop_fragment（作业/阶段/片段）· cp_mdop_ticket / cp_mdop_signature_record（凭证与签名记录）· cp_mdop_handle / cp_mdop_delivery（句柄与数据面投递）· cp_mdop_receipt（回执）· cp_mdop_nonce（防重放）· local_mdop_contract / local_mdop_contract_pending（本地合约副本与待确认要约）· local_mdop_operator_whitelist / local_mdop_revocation_state（本地白名单与吊销状态）

MDOP 是国标连接器接口**之上**的编排 profile（D-MDOP-1）：作业与阶段、片段、执行凭证、制品句柄、
审计/销毁回执、算子清单分别落在后续变更的表里；本小节先登记**合约持签**与**本地副本**这两处
数据平面。契约类型定义在 `packages/mdop`（领域中立，`MdopContract` / `ExecutionTicket` /
`ArtifactHandle` / `LocalMdopContract`），运行期实体在 `@medtrust/database`。

### 关系

| 源列 | 目标 | 语义 | 强制点 | 备注 |
|---|---|---|---|---|
| cp_mdop_outbox.receiver | cp_participant.id（URN 形态） | 消息目标节点 | ts:apps/api/src/runtime/digital-contract/mdop-contract.service.ts#MdopContractService | 软引用 |
| cp_digital_contract.mdopTerms.providerPublicKeyKid | cp_certificate.subjectPublicKey 的 SM3 | 持有方身份锚 | ts:apps/api/src/runtime/digital-contract/mdop-contract.service.ts#agree | 验签唯一信任锚 |
| local_mdop_contract.contractId | cp_digital_contract.id | 本地副本 ↔ 控制面合约 | ts:apps/connector/src/mdop/contract-store.ts#usableContract | 副本内容才算数 |

### 状态词汇

| 词汇 | 取值 | 出处 |
|---|---|---|
| MDOP 合约生命期 | `unsigned` → `offered` → `agreed` → `active` / `rejected` / `terminated` | cp_digital_contract.mdopStatus；`unsigned` = 旧合约，不能授权 MDOP 作业 |
| 本地副本状态 | `pending`（已签待副署）/ `active` / `rejected` / `revoked` | local_mdop_contract.status |
| 待确认要约 | `pending` / `confirmed` / `rejected` / `expired` | local_mdop_contract_pending.status；超时视同拒绝 |
| 算子 kind | `wasm`（模块 SM3）/ `oci`（镜像摘要，本期不启用）/ `system`（自带机制，`id@version` + 组件版本） | cp_mdop_operator.kind；承载分析逻辑只许 wasm/oci |
| 算子许可状态 | 白名单命中（本地）/ 未加白 `E_OP_NOT_WHITELISTED` / 已吊销 `E_OP_REVOKED` / 名单未同步 `E_REVOCATION_UNSYNCED` | local_mdop_operator_whitelist + local_mdop_revocation_state |
| 流动等级 | `C0` 本地明文 / `C1` 密态 / `C2` 受控流动 / `C3` 可发布 | packages/mdop 标签格；C0 最严、C3 最宽、C1 与 C2 互不可比 |
| 作业状态机 | `SUBMITTED`→`COMPILED`→`NEGOTIATING`→`TICKETED`→`RUNNING`→`RELEASING`→`SUCCEEDED`；另有 `FAILED`/`ABORTED`/`REJECTED`，终态进 `PURGED` | packages/mdop `JOB_TRANSITIONS`（协议 §8.1） |
| 阶段状态机 | `PENDING`→`READY`→`RUNNING`→`SUCCEEDED`；`RUNNING`↔`RETRYING`；`FAILED` | packages/mdop `STAGE_TRANSITIONS`（协议 §8.2） |
| 证明登记 | 有效（`expires_at` 未到）/ 已过期（编译期一律拒，取最新未过期的一条） | cp_mdop_attestation；`MdopAttestationService#assertUsableForC2` |
| C2 通道 | 拒绝（目标节点未通告 TEE 能力，或证明登记无效/过期/度量或 TCB 超策略 → 编译期拒）/ 可放置（合约声明 `attestation_policy` 且目标节点证明有效） | 协议 §4.2 R4；D-MDOP-6 开关翻转补注（2026-09-26） |
| 封装/解封等级 | 封装 `C0 → C2`（持有方本地）/ 解封 `C2 → C0`（可信空间节点内） | packages/mdop `deriveOutputLabel`（协议 §4.2 R4 补注） |

### 不变量

```yaml invariant
id: INV-MDOP-01
tables: [cp_digital_contract, cp_mdop_outbox]
desc: 只有带**持有方签名 + 平台副署**的合约（mdopStatus=active）才能授权 MDOP 作业；没有持有方签名的旧合约以 E_CONTRACT_UNSIGNED 拒绝（fail-closed，无宽限期），仍可服务旧管线。要约发出/接受都落发件箱，签署内容与平台条款逐字节比对，改一个字段即拒
trigger: MDOP 作业编译期合约校验；合约要约与接受
enforcement:
  - ts:apps/api/src/runtime/digital-contract/mdop-contract.service.ts#assertUsableForJob
  - ts:apps/api/src/runtime/digital-contract/mdop-contract.service.ts#offer
  - ts:apps/api/src/runtime/digital-contract/mdop-contract.service.ts#agree
db: cp_digital_contract（mdopTerms / holderSignature / platformCountersignature / mdopStatus）+ cp_mdop_outbox
spec: apps/api/src/runtime/digital-contract/mdop-contract.spec.ts
```

```yaml invariant
id: INV-MDOP-02
tables: [local_mdop_contract, local_mdop_contract_pending]
desc: 连接器复核只依据**本地合约副本**，不采信平台随消息附带的合约内容；本地副本生效前必须验过平台副署（用部署固定的平台节点公钥）；医院本地撤销立即生效，此后引用该合约的片段一律拒，与平台是否已知无关；缺省人工确认，自动确认只能由本地策略文件显式点名并标注 review=auto(policy)
trigger: 收到 ContractOffer / 院内确认 / 院内撤销 / 收到 ContractTerminate
enforcement:
  - ts:apps/connector/src/mdop/contract-store.ts#receiveOffer
  - ts:apps/connector/src/mdop/contract-store.ts#confirm
  - ts:apps/connector/src/mdop/contract-store.ts#applyCountersignature
  - ts:apps/connector/src/mdop/contract-store.ts#usableContract
  - ts:apps/connector/src/mdop/contract-store.ts#revoke
db: local_mdop_contract + local_mdop_contract_pending
spec: apps/connector/src/mdop/contract-store.spec.ts
```

```yaml invariant
id: INV-MDOP-03
tables: [cp_mdop_operator, local_mdop_operator_whitelist, local_mdop_revocation_state]
desc: 算子清单由注册中心密钥签名，连接器用部署固定的注册中心公钥验签（用错密钥的清单一律拒）；清单登记时强制 kind/类别约束、非降密算子输出必须 inherit、wasm 摘要必须来自平台复现构建产物；**本地白名单缺省为空且只能由医院在本地加/减**（平台消息没有写白名单的路径）；吊销名单由平台节点密钥签名、版本单调、落盘，启动后在收到有效名单前拒绝执行任何 wasm 算子
trigger: 算子登记 / 批次下发清单与吊销名单 / 复核与执行前的执行前闸门
enforcement:
  - ts:apps/api/src/mdop/operator-registry.service.ts#register
  - ts:apps/api/src/mdop/revocation.service.ts#signedList
  - ts:apps/connector/src/mdop/operator-whitelist.ts#applyOperatorManifests
  - ts:apps/connector/src/mdop/operator-whitelist.ts#applyRevocationList
  - ts:apps/connector/src/mdop/operator-whitelist.ts#assertExecutable
db: cp_mdop_operator + local_mdop_operator_whitelist + local_mdop_revocation_state
spec: apps/connector/src/mdop/operator-whitelist.spec.ts
```

```yaml invariant
id: INV-MDOP-04
tables: [cp_mdop_job, cp_mdop_stage, cp_mdop_fragment]
desc: 逻辑计划只能引用已注册算子且不得携带可执行代码；编译按「数据就近（ds://<node> 为输入的阶段必须落在该节点）→ 单节点依赖跟随 → 多节点依赖落平台合并」放置，显式 at 与数据所在节点冲突报 E_LABEL_VIOLATION 并指出越界的边；逐条边做标签/能力校验（C0 不出节点、C3 目标须在合约接收方列表、C1/C2 本期无能力即拒）；降密参数不得弱于合约发布条件；片段按节点切分且每份只含本节点阶段内容 + 全部边界边，plan_hash = SM3(JCS({作业头, fragments})) 可被任一节点独立重算；任一失败作业进 REJECTED
trigger: 作业提交与编译
enforcement:
  - ts:apps/api/src/mdop/mdop-jobs.service.ts#submit
  - ts:apps/api/src/mdop/mdop-jobs.service.ts#compile
  - ts:packages/mdop/src/label/lattice.ts#validateEdge
  - ts:apps/api/src/mdop/mdop-jobs.service.ts#splitFragments
db: cp_mdop_job + cp_mdop_stage + cp_mdop_fragment
spec: apps/api/src/mdop/mdop-jobs.spec.ts
```

```yaml invariant
id: INV-MDOP-05
tables: [cp_mdop_ticket, cp_mdop_signature_record, cp_mdop_stage]
desc: 片段要约每节点一份（只含本方片段 + 全量片段哈希表，看不到他院片段内容），凭证核心在要约时冻结且各持有方签的就是它；持有方接受签名用**其登记证书公钥**验（核心 + 本节点快照一起签）；任一持有方拒绝或复核超时 → 作业立即 REJECTED、通知其他节点作废、且**不发任何 StageDispatch**；全部接受后由平台节点密钥加签组成凭证并下发；调度用显式迁移表（非法迁移拒绝并记审计），StageDispatch 带凭证编号与幂等键 job:stage:attempt，可重试错误按 30/60/120 秒退避最多 3 次，失败向作业传播
trigger: 凭证要约 / 接受 / 拒绝 / 超时；阶段调度与状态上报
enforcement:
  - ts:apps/api/src/mdop/mdop-ticket.service.ts#offerTickets
  - ts:apps/api/src/mdop/mdop-ticket.service.ts#accept
  - ts:apps/api/src/mdop/mdop-ticket.service.ts#reject
  - ts:apps/api/src/mdop/mdop-scheduler.service.ts#dispatchReadyStages
  - ts:apps/api/src/mdop/mdop-scheduler.service.ts#onStageStatus
db: cp_mdop_ticket + cp_mdop_signature_record + cp_mdop_stage
spec: apps/api/src/mdop/mdop-ticket-scheduler.spec.ts
```

```yaml invariant
id: INV-MDOP-06
tables: [cp_mdop_receipt, cp_mdop_job]
desc: 作业进入 SUCCEEDED/FAILED/ABORTED 后向所有持有中间制品的节点发 PurgeOrder（平台的 C3 交付物不销毁）；收齐全部有效 PurgeReceipt 才进 PURGED，缺回执按原幂等键重发（连接器返回同一回执）；审计回执逐节点成链，平台校验 prev_receipt_hash 连续性，断链被拒收并指出位置；链头在作业终态与每 30 分钟经存证服务锚定，链不可达时记「待上链」进补偿队列，MUST NOT 伪造交易号
trigger: 作业终态销毁；审计回执上报与链头锚定
enforcement:
  - ts:apps/api/src/mdop/mdop-purge.service.ts#orchestratePurge
  - ts:apps/api/src/mdop/mdop-purge.service.ts#onPurgeReceipt
  - ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#ingestAuditReceipt
  - ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#verifyChain
  - ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#anchorChainHead
db: cp_mdop_receipt + cp_mdop_job
spec: apps/api/src/mdop/mdop-purge-receipts.spec.ts
```

```yaml invariant
id: INV-MDOP-07
tables: [local_mdop_artifact, local_mdop_processed_key, local_mdop_nonce, local_mdop_receipt]
desc: 连接器的每一步只依据**本地输入**（本地合约副本、本地白名单、已验签的算子清单）做七项复核，任一项不过就只回错误码拒绝；执行前必须过凭证校验（本方签名含快照、平台签名、有效期、片段哈希）并重算数据快照，快照变了报 E_SNAPSHOT_CHANGED；同一 job:stage:attempt 重复到达返回原结果不重算；制品只在本节点本地库，句柄上报不含数据，非 C3 句柄不得带 stats；数据面出口只投 C3 且目标必须在本地合约接收方列表里（第三道 C0 拦截，与编译/复核结论无关）；TTL 到期自主销毁、收到 PurgeOrder 立即销毁并回签名回执，销毁后按句柄读取必失败
trigger: 收到 PlanFragmentOffer / StageDispatch / PurgeOrder；TTL 到期
enforcement:
  - ts:apps/connector/src/mdop/mdop-review.ts#review
  - ts:apps/connector/src/mdop/mdop-node.service.ts#onStageDispatch
  - ts:apps/connector/src/mdop/mdop-local-store.ts#putArtifact
  - ts:apps/connector/src/mdop/mdop-egress.ts#decide
db: local_mdop_artifact + local_mdop_processed_key + local_mdop_nonce + local_mdop_receipt
spec: apps/connector/src/mdop/mdop-node.spec.ts
```

```yaml invariant
id: INV-MDOP-08
tables: [cp_mdop_job, cp_mdop_delivery]
desc: L1.5 失衡检测在 MDOP 通道下按固定四算子链路执行（source.dataset → rws.disproportionality(wasm 沙箱) → declassify.small_cell(输出闸门读合约 minCell) → merge.disproportionality（平台侧，只吃 C3））；DAG 逐字段对拍：同一数据、未触发小单元格抑制时，MDOP 通道与旧通道的四格表与 PRR/ROR/IC 完全一致（平台合并复用既有 mergeDisproportionalityAggregates，不另写一份口径）；平台合并结果作为 C3 交付物留存且不参与销毁
trigger: L1.5 MDOP 作业执行与平台合并
enforcement:
  - ts:apps/connector/src/mdop/operators/l15.ts#registerL15Operators
  - ts:apps/connector/src/mdop/operators/wire-l15.ts#L15OperatorWiring
  - ts:apps/api/src/mdop/operators/merge-disproportionality.ts#mergeProportionality
  - ts:apps/api/src/mdop/mdop-merge.service.ts#mergeIfReady
db: cp_mdop_delivery（C3 载荷与合并结果）+ cp_mdop_handle
spec: apps/connector/src/mdop/operators/l15.spec.ts
```

```yaml invariant
id: INV-TEE-01
tables: [cp_mdop_attestation]
desc: 平台**不自己校验硬件 quote**（没有 DCAP/厂商证明服务，也不该把信任建在自己身上）：证明登记只接受「部署配置白名单内的校验方（KMS / 证明服务）已验过」的摘要，校验方标识与度量白名单**全部来自部署配置**，MUST NOT 来自随请求带来的字段；登记一次会话一条、历史保留（覆盖写会让「当时什么度量、谁验的」查不到）；证明为短有效期，取「最新且未过期」的一条用于放置 C2 阶段，过期即拒；链不可达时锚定留空，MUST NOT 伪造交易号
trigger: 节点证明登记；编译期放置 C2 阶段与凭证冻结
enforcement:
  - ts:apps/api/src/mdop/mdop-attestation.service.ts#MdopAttestationService
  - ts:apps/api/src/mdop/mdop-attestation.service.ts#assertUsableForC2
  - ts:packages/mdop/src/attestation/provider.ts#resolveMeasurementWhitelist
db: cp_mdop_attestation
spec: apps/api/src/mdop/mdop-attestation.spec.ts
```

```yaml invariant
id: INV-TEE-02
tables: [cp_mdop_attestation, cp_mdop_ticket]
desc: **软件实现不得作为 C2 目标**：`level=software` 或 `isolation=none` 的执行环境在任何政策下都被拒（哪怕合约三链全开、信任根齐全），软件实现只能用于开发测试床；C2 只能由 `seal` 类算子产生——普通算子**从非 C2 输入算出 C2** 一律 `E_LABEL_VIOLATION`（纯 C2 输入按 R1 传递仍允许），封装只收 C0、解封只收 C2；凭证里冻结的是**稳定的执行环境期望**（链型 / 度量 / 最低可信基），逐次会话的 quote 摘要属于 KMS 释放凭据，两者在执行前与实际证明一并核对，任一不符 fail-closed
trigger: C2 目标的编译期与执行前判定；封装/解封算子的等级推导
enforcement:
  - ts:packages/mdop/src/attestation/provider.ts#verifyAttestationForC2
  - ts:packages/mdop/src/attestation/execution.ts#verifyC2Execution
  - ts:packages/mdop/src/label/lattice.ts#deriveOutputLabel
db: cp_mdop_ticket（attestation 期望）+ cp_mdop_attestation（会话证明）
spec: packages/mdop/src/attestation/provider.spec.ts
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
desc: 连接器每个计算 step 前 PEP 校验合约（active 状态 / 目的 / 有效期 / outputPolicy.allowedArtifacts 与 allowedLevels / 任务声明的数据产品须恰为合约授权的 dataProductId——数据来源由合约定、任务 spec 不得另指），违规抛 PolicyViolation 并留痕；revoked 后下一次校验即拒；OutputGate 消费合约 minCell（下限 DEFAULT_MIN_CELL=5）
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

## 算法模块准入（packages/wasm-algorithms + apps/api/src/runtime/connector-modules）

覆盖表：cp_module_admission, cp_module_revocation

第三方算法模块的准入与吊销（D-CN-5 / P-CTL-7 → CTL-24）。**源码不入库**：
保密审查通道（NDA）下只存 `sourceRef` 与摘要，对医院公开的只有「模块 SM3 + 平台审查背书」。

### 关系

| 源列 | 目标 | 语义 | 强制点 | 备注 |
|---|---|---|---|---|
| cp_module_admission.sm3 | cp_module_revocation.sm3 | 已入册模块被吊销 | ts:apps/api/src/runtime/connector-modules/module-admission.service.ts#ModuleAdmissionService | 吊销即把准入记录置 revoked（终态） |
| cp_digital_contract.pinnedModules[*].sm3 | cp_module_admission.sm3 | 合约固定的模块必须已入册 | ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService | 条款含准入层级 + 审查背书，整体计入合约哈希 |

### 不变量

```yaml invariant
id: INV-ADMIT-01
tables: [cp_module_admission]
desc: 合约固定的模块 SM3 MUST 由平台从提交源码在锁定工具链里复现产出（两个独立构建器同一 SM3），复现不出即不予签名、不得入册——不透明第三方二进制结构性无法准入（不设 Tier C，D-CN-5）
trigger: 触发复现构建（ModuleAdmissionService.triggerBuild → scripts/admit-cli.mjs）
enforcement:
  - ts:packages/wasm-algorithms/scripts/admission.mjs
  - ts:apps/api/src/runtime/connector-modules/module-admission.service.ts#ModuleAdmissionService
db: cp_module_admission(sm3, toolchain, reproducibleBuildRef)
spec: packages/wasm-algorithms/scripts/admission.test.mjs
```

```yaml invariant
id: INV-ADMIT-04
tables: [cp_module_admission]
desc: 控制面 MUST NOT 编译被提交的源码（build.rs / proc-macro / asc transform 是编译期执行点），也 MUST NOT 为此挂载 docker.sock；编译在独立隔离环境完成，控制面只接收 ≥2 份构建产物字节，并**自行**重算 SM3、比对复现一致性、运行闸 1 静态白名单后方可签名——提交方声称的 SM3 一律不采信
trigger: POST /module-admission/submissions/:id/attest-build
enforcement:
  - ts:apps/api/src/runtime/connector-modules/module-admission.service.ts#ModuleAdmissionService
  - ts:packages/wasm-algorithms/src/source-gate.ts#sourceGate
db: cp_module_admission(sm3, toolchain, staticGate, reproducibleBuildRef)
spec: apps/api/src/runtime/connector-modules/module-admission.spec.ts
```

```yaml invariant
id: INV-ADMIT-02
tables: [cp_module_admission]
desc: 准入状态只能按 submitted → built → tested → shadow → canary → active 顺序晋级，不得跳闸；影子比对不干净 MUST NOT 晋级；rejected / revoked 为终态
trigger: 任一晋级动作
enforcement:
  - ts:packages/wasm-algorithms/src/admission.ts#canPromote
  - ts:apps/api/src/runtime/connector-modules/module-admission.service.ts#ModuleAdmissionService
db: cp_module_admission(status)
spec: apps/api/src/runtime/connector-modules/module-admission.spec.ts
```

```yaml invariant
id: INV-ADMIT-03
tables: [cp_module_revocation]
desc: 吊销名单版本单调递增；连接器只接受版本更高的名单（回放旧名单不得把吊销「撤销」掉），收下即清掉被吊销模块的本地缓存；PEP 执行前命中即拒且 MUST NOT 回退到内置实现
trigger: 平台吊销模块 / 连接器长轮询收到名单
enforcement:
  - ts:packages/wasm-algorithms/src/revocation.ts#mergeRevocationList
  - ts:apps/connector/src/domain/sandbox/module-client.ts#ConnectorModuleClient
  - ts:apps/connector/src/domain/policy-enforcement.ts#PolicyEnforcementPoint
db: cp_module_revocation(sm3, listVersion)
spec: apps/connector/src/domain/sandbox/revocation.spec.ts
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

覆盖表：local_record, local_audit_log, local_gold_standard, local_data_source_status

**前三张表只存在于参与方本地库（ConnectorDataSource），是全仓唯一可含（脱敏后）
行级数据的地方。** local_data_source_status 只记院内 CDM 数据源最近一次接入校验的结论
（是否通过、分权限域的检查项、CDM / 词汇表版本），**永不存凭据**（D-CN-6）。 local_record.subjectKey 是哈希假名，绝不是真实患者标识；
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

```yaml invariant
id: INV-DS-01
tables: [local_data_source_status, cp_data_product]
desc: 院内数据只经连接器进程访问（D-CN-6）——库连接与凭据只在连接器侧配置（配置项白名单、只存 passwordEnv 引用），控制面声明只有 label；Wasm 模块零数据接口；联邦训练 agent 不持凭据（发现即拒绝启动）、不读文件，只收连接器按合约的数据产品投影的训练切片（schema + 数值特征 + 0/1 标签，切片外字段拒收，spec 带 dataPath 即拒）
trigger: 连接器 / agent 启动；数据产品发布与更新；算法模块实例化；联邦训练轮次
enforcement:
  - ts:apps/connector/src/domain/data-source/data-source-config.ts#parseDataSourceConfig
  - ts:packages/database/src/control-plane/data-source-declaration.ts#parseDataSourceDeclaration
  - ts:apps/connector/src/domain/sandbox/module-verifier.ts#verifyModule
  - ts:apps/connector/src/domain/fl-round/fl-round-executor.ts#FlRoundExecutor
  - ts:apps/connector/src/domain/fl-round/training-slice.ts#buildTrainingSlice
  - py:apps/agent/src/medtrust_agent/config.py
  - py:apps/agent/src/medtrust_agent/training_slice.py
db: none
spec: apps/connector/src/domain/data-source/import-surface.spec.ts
```

```yaml invariant
id: INV-DS-02
tables: [local_data_source_status]
desc: CDM 数据源接入 fail-closed（D-CN-7）——连接器账号恰为「CDM 视图只读 + results 可写」双权限域（纯只读 / 超级用户 / BYPASSRLS / 底表可达 / 视图含标识或可写 / 元数据不可读 任一即不可用），取用只走 requireAvailable()；不可用时任务失败，MUST NOT 改用文件数据；CDM 类型产品派发不读任何文件
trigger: 连接器启动与周期复核（CONNECTOR_CDM_REVERIFY_MS）；任务按数据产品取数
enforcement:
  - ts:apps/connector/src/domain/data-source/cdm-access-gate.ts#CdmAccessGate
  - ts:apps/connector/src/domain/data-source/cdm-data-source-registry.ts#CdmDataSourceRegistry
  - ts:apps/connector/src/domain/data-product-local-source.ts#DataProductLocalSource
db: none
spec: apps/connector/src/domain/data-source/cdm-access-gate.spec.ts
```

```yaml invariant
id: INV-DS-03
tables: [local_data_source_status]
desc: CDM 取数把列裁剪与行过滤下推进 SQL（不全量拉取），产出与文件路径同一个投影构造器的载荷（受控数据下逐字节一致）；results 中间表按任务标识命名、任务结束即删、孤儿表兜底清理，只碰本账号拥有且符合命名约定的表
trigger: CDM 取数；任务结束；每次接入复核
enforcement:
  - ts:apps/connector/src/domain/data-source/cdm-projection.ts#projectDisproportionalityFromCdm
  - ts:apps/connector/src/domain/sandbox/disproportionality-sandbox.ts#buildDisproportionalityProjection
  - ts:apps/connector/src/domain/data-source/cdm-results-scratch.ts#CdmResultsScratch
db: none
spec: apps/connector/src/domain/data-source/cdm-projection.spec.ts
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
  **院内库接入**（D-CN-7，omop-data-source-access）：连接器经医院视图层直连 CDM v5.4 库，
  列裁剪与行过滤下推进 SQL；**模块不获得查询接口**（D-CN-3 的 `query_omop` 目标态已由 D-CN-6
  取代）。本版只交付机制，CDM 上的分析派发未开放（队列 / 时间窗语义属 Circe 变更）。
  **文件数据源**仍用 `LocalRecord.clinical`（`Record<string,unknown>` 自由 JSON），未映射到 CDM；
  两条路径在投影载荷处汇合。
- **视图层（CDM 视图）**：医院 DBA 在底表之上建的同名同结构视图，去直接标识、可行级过滤；
  连接器只能读它。是医院可单方面 REVOKE 的第零道闸（CTL-25）。
- **双权限域**：连接器账号恰好拥有的两类权限——CDM 视图只读、`results` schema 可建表可写。
  「纯只读」不满足契约（队列定义要写 cohort 表）。
- **数据源声明 / label**：数据产品在 `fhirSchema.dataSource` 里声明数据从哪来；CDM 声明只有一个
  label，是控制面与连接器侧配置的唯一关联键（凭据只在连接器侧）。
- **训练切片（training slice）**：连接器按合约的数据产品为联邦训练轮次投影出的最小数据——
  口径标识 `schema`（如 `esrd-proxy@1`）+ 固定顺序的数值特征 + 0/1 标签，随 RunLocalRound 请求交给
  本院 agent；特征与标签口径由连接器定义，agent 只做结构校验（INV-DS-01）。
- **覆盖元数据**：CDM 数据产品由连接器从库内统计产出的版本 + 表数量级 + 月粒度观察期，
  是该院自报的事实，不是平台的数据质量背书（INV-CAT-02）。
- **准入层级（admission tier）**：第三方算法模块的准入分层（D-CN-5）。A = 平台自研源码；
  B = 第三方交源码、平台复现构建 + 审查。**不设 Tier C**：不透明第三方二进制不准入（模块 SM3
  须由平台从源码复现产出，复现不出即无法固定）。记入合约固定模块条款、计入合约哈希。
- **审查背书（review attestation）**：平台对第三方模块源码完成审查 + 复现构建后的签名背书
  （D-CN-5/P-CTL-7）。对医院只公开「模块 SM3 + 背书」，源码可 NDA 保密不公开；与准入层级
  一并写入合约固定模块条款、计入合约哈希。

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
