# 深度需求 · 02 接入与身份层

> 日期: 2026-06-29 · 框架: zai-deepreq 9 维 · 覆盖域: `data-space-connector` / `participant-identity`
> 层定位: 数据空间的**信任根与接入边界**——谁能进(SM2 CA 准入)、数据如何留在域内(连接器守卫)、通信如何可信(国密安全信道)。
> 锚点: NDI-TR-2025-05(接入连接器标准能力)、NDI-TR-2025-03(身份管理与接入)、D8(国密信任链);并对齐 Fly.io 上 connector-a/b(真 Python agent)与 `apps/connector`(自包含 demo,不接控制面)的**双连接器现实**。

---

## A. data-space-connector(接入连接器 — 本地重节点)

> **关键现实区分**: 仓库里有**两套**"连接器":
> - `apps/connector`(NestJS):完整域服务 demo,**不接入实时控制面**(自包含 `demo`/`demo:e2e`)。
> - `apps/agent`(Python,Fly 上 connector-a/b):**真正接入控制面**的参与方节点(orchestrator 经 `AGENT_GRPC_URL` gRPC 派发,gRPC 5024 + WS 5023)。
> 二者职责重叠但部署形态不同 → 决策点 D-CN-1(★)。

### A1 对象与数据来源
- **对象**: 部署在医院/药企内网的本地节点,持有脱敏后的本地数据 + 本地审计。
- **数据来源**: `fhir-gateway` 拉取院内 FHIR → `deidentifier` 脱敏 → `local-store` 落本地库(数据不出域守卫)。Fly 现状: `apps/agent` 用合成数据(无真实 FHIR 接入)。

### A2 触发(NDI-TR-2025-05 标准能力逐项)
连接器 5 项 + 标准能力,每项的触发与现状:
| 标准能力 | 触发 | Fly 现状 |
|---|---|---|
| 身份认证 | 接入控制面前 SM2 证书校验 | ✅ 真实 |
| 网络接入 | **主动外联**(不开放入站),`task-puller`/gRPC 长连 | ⚠️ gRPC 真连;主动外联模式建立 |
| 数据交付 | 收到派发任务 → 本地执行 → 回传聚合 | ⚠️ 进程内/gRPC 通;真实院间传输待接 |
| 数据访问控制 | 每次计算 → 不出域守卫 + PEP + 输出闸门 | ✅ |
| 数字合约管理(连接器侧) | 合约下发 → `ContractView` 缓存 | ✅ |
| 数据资源/产品管理 | ingest / 发布数据产品 | ⚠️ 实体未全 |
| 日志 | 本地审计 `LocalAuditLog` + 上链摘要 | ⚠️ 本地真;上链 mock |
| 运行状态上报 | 周期心跳/健康上报控制面 | ✖️ 未实现 → 决策点 D-CN-2 |

### A3 执行 / 通道
- **派发**: orchestrator → gRPC(`SubmitFLTask`)→ agent `TaskRunner` 本地执行;日志经 WS(`/ws/secretflow`)流式回传(`AgentLogBridge` fan-out)。
- **不出域守卫**: `local-store` 物理约束——原始行级无对外接口;只有过 `output-gate` 的聚合可出。
- **降级**: `NodeCapabilityService` 评估节点(TEE/算力)→ `teeu_full`/`pyu_only`。

### A4 回收 / 记录
- 回传 = 聚合/信号/参数 delta(经 `output_guard` 塑形,fail-close on forbidden keys)。本地审计 `LocalAuditLog` 记每次 ingest/execute/output。

### A5 状态机
- **连接器生命周期**: `registered → active → (suspended | cert-expired | revoked)`。证书过期/吊销立即阻断任务交互(已测 2.6)。生命周期/状态管理待补(design 标 ⚠️)。
- **单任务执行**: 见 01-A5 实例级。

### A6 统计
- 连接器在线率、任务执行成功率 = `成功/派发`、平均执行时延、本地数据规模(`cohortSize`)、输出闸门拦截次数。

### A7 边界 / 异常
1. **入站攻击面**: 设计为主动外联、不开放入站端口 → 降低院内暴露。Fly 上 connector-a/b 用 TCP 探针 + `--strategy immediate`(健康轮询假失败问题)。
2. **证书过期/吊销**: 立即阻断(已测)。
3. **节点掉线/超时**: orchestrator drop + 贡献惩罚(见 01-A7-4)。
4. **两套连接器混淆**: `apps/connector` 不接控制面,真实接入是 `apps/agent` → 须文档/部署明确(D-CN-1)。
5. **真实院侧部署信任成本**: 第一版容器化 + 模拟数据,真实院内部署后置(design Risks)。
6. **运行状态上报缺失**: 控制面无法感知连接器异常 → D-CN-2。

### A8 权限 / 审计
- 连接器身份 = SM2 证书(中心 CA 签发);仅持证连接器可接入。本地审计独立于控制面审计(数据库已拆,D7)。

### A9 数据模型
- **连接器本地 schema**(`ConnectorDataSource`):本地脱敏数据 + `LocalAuditLog`。
- **控制面侧**:连接器注册记录(证书指纹/状态/能力 profile)。物理隔离强制"中心无原始数据"。

---

## B. participant-identity(参与方身份 — SM2 CA / 双认证 / 分级分类)

### B1 对象与数据来源
- **对象**: 参与方(机构 + 其连接器)的身份证书与准入授权。来源 = 控制面 CA 签发 + 准入门禁登记。

### B2 触发
| 模式 | 条件 | 落点 |
|---|---|---|
| 证书签发 | 参与方注册 → CA 签 SM2 证书 | `CaService.issue` ✅ |
| 证书校验 | 每次接入/任务交互前 | `CaService.verify`(拒已吊销/过期,已测) |
| 吊销 | operator 吊销 → CRL | `CaService.revoke` ✅ |
| 连接器注册 | 凭 CA 证书注册连接器 | `ParticipantRegistry.registerConnector`(接受 CA 签发,拒非签发,已测 2.2) |
| 准入门禁 | 任务交互前双认证+权属+分级分类 | `ParticipantRegistryService` admission gates |

### B3 执行 / 安全信道
- **安全信道**(`SecureChannelService`,对齐 D8): SM2 加密 + SM3 完整性 + 签名。已测:round-trip 密封消息、丢弃被篡改消息(digest 改动)、拒错误签名方。
- **双认证**: 机构身份 + 连接器证书双重校验(对齐官方"双认证")。

### B4 回收 / 记录
- 证书生命周期事件 + 准入裁决全程审计;吊销列表(CRL)维护。

### B5 状态机
- **证书**: `issued → valid → (revoked | expired)`。
- **准入**: `applied → admitted → (suspended | denied)`;`AdmissionDeniedError` 携拒因。

### B6 统计
- 在册参与方/连接器数、证书签发/吊销量、准入拒绝率与拒因分布、证书临期预警数。

### B7 边界 / 异常
1. **吊销后交互**: 立即拒(已测 2.6)。
2. **过期证书**: 拒(已测)。
3. **分级分类缺失**: 数据/任务未分级 → admission 拒(对齐分级分类门禁)。
4. **跨空间证书互认**: 本空间信任清单(其他空间 CA 集合)→ 见 space-interconnect(03 邻域 / design D11)。决策点 D-ID-1(★):信任清单维护与撤销传播。
5. **身份登记接口对齐**: NDI-TR-2025-03 身份登记/认证接口待对齐(design 标 ⚠️)→ D-ID-2。
6. **CA 私钥安全**: CA 签发私钥须 Vault 托管;Fly 上 vault dev 模式 → 生产前换正式 Vault。

### B8 权限 / 审计
- CA 签发/吊销 = `operator`;准入裁决记审计;复用平台 RBAC。

### B9 数据模型
- `Certificate`(SM2 公钥/指纹/有效期/状态/吊销时间)、`ParticipantAdmission`(机构/连接器/权属/分级/准入状态)、信任清单(跨空间 CA 集合)。CA 私钥 → Vault。

---

## 本文新增待决策点

| # | 决策点 | 影响 | ★架构 |
|---|---|---|---|
| D-CN-1 | 两套连接器收敛:`apps/connector`(NestJS demo)与 `apps/agent`(Python 接入节点)职责边界 / 是否合并 | 部署拓扑、代码所有权、维护成本 | ★ |
| D-CN-2 | 连接器运行状态上报(NDI-TR-2025-05 必备能力)的协议与频率 | 控制面可观测、健康判定 | |
| D-ID-1 | 跨空间信任清单的维护方式与吊销传播(CA 互认) | 联邦信任边界 | ★ |
| D-ID-2 | 身份登记/认证接口对齐 NDI-TR-2025-03 的范围与时序 | 合规符合性、互联互通 | |

## 调研来源
- 国标: NDI-TR-2025-05《接入连接器技术要求》、NDI-TR-2025-03《用户身份管理和接入规范》、NDI-TR-2025-02《互联互通基本要求》(见 design.md 链接)
- 连接器安全/主权(主动外联、PEP、不出域): [IDS Usage Control / Dataspace Connector](https://international-data-spaces-association.github.io/DataspaceConnector/Documentation/v5/UsageControl)
- Fly.io 双连接器现实(connector-a/b 真 agent、apps/connector 自包含 demo、TCP 探针/immediate 策略): 本仓库部署记忆
