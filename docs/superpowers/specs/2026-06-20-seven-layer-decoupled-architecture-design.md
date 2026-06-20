# 设计规格：MedTrust 七层解耦架构 + 系统对象库

- 状态：待评审 / 待实现
- 日期：2026-06-20
- 关联知识源：`/Users/mac/Sync/knowledge/医疗数据治理/可信数据空间/`
  - `隐私计算七层架构总览.md`、`隐私计算分类学-JSON.md`、`MedTrust技术选型七层映射.md`、各 `L1-L7` 层文档
- 关联代码：`apps/api`、`apps/web`、`packages/database`

---

## 1. 背景与根因

MedTrust 当前存在两条彼此正交的轴，目前只建好第一条：

- **运行时控制面（已建）**：`catalog`(数据产品) / `digital-contract`(PEP 授权) / `participant-identity`(SM2 CA) / `secretflow-orchestrator`(FSM 运行) / `connector`(本地节点)。任务用 `SecretFlowTaskSpec`，把**模型、算法、隐私揉在一个扁平 spec 里**。
- **七层能力 / 治理模型（未建）**：技术选型七层分类学**只存在于 knowledge 的 markdown**。代码里没有任何 registry、没有 `risk_level` 逻辑、没有合规引擎；模型 / 算法只是 assistant prompt 里的**硬编码默认值**（`meditron-7b` / `lora`）。

**根因**：缺的不是运行时，而是一套**声明式的"能力 + 治理"模型**。因此"七层解耦"的本质是新增并抽出第二条轴，而非推翻已经能跑的第一条轴。

## 2. 目标与范围

**目标（做）**：

1. 把技术选型七层分类学从 markdown 落为**数据库支撑的系统对象**（每层一类对象）。
2. 把 `apps/api/src` 重组为 `capability / composition / runtime` **三域**。
3. `compute task` 升级为引用各层对象的**显式跨层组合**，由 L2 合规引擎校验产出裁决（verdict）。
4. 七层对象同时服务三用途：**合规门控、任务设计 / 组合、知识库后台**。

**非目标（不做）**：

- 不改 connector 的"数据不出域"机制。
- 不重写 `privacy/*`、`blockchain` 内部实现——仅登记为可插拔 handler。
- 不动 `auth / audit / tenant / health` 等平台横切件。

## 3. 架构设计方法（解耦范式 = 分层能力注册表 + 策略注入）

1. **每层 = 一类同构"系统对象"的注册表**：统一约定列（`id / key / layer / name / version / status / metadata`）+ 层内强类型字段。是**数据，不是代码**。
2. **依赖向下声明为数据（一张 DAG）**：L3 模型 → `typicalAlgorithmKeys`(L4) → `underlyingOperatorKeys`(L5) → `supportedProtocolKeys`(L6) → 基础设施(L7)。组合与校验靠**遍历图**，换任一节点不改代码。
3. **L1 场景 = 意图入口**：声明 `compliance_risk_level` + 推荐（非约束）的模型 / 算法。
4. **L2 合规 ≠ 能力注册表，而是规则注册表**（guardrail + risk_policy + block_rule + approval_rule）。它**不执行任何计算**，只"读 L1 风险 + 读组合 → 产出 required 约束 + verdict"。是"通则 + 判例"。**这是从 6 层升到 7 层的唯一理由。**
5. **一个任务 = 跨层组合（每层选 ≥1 对象）+ 一次合规评估结果**。双重校验：**结构**（DAG 自洽）+ **治理**（L2 verdict）。
6. **解耦验收**（对齐文档"架构灵活性"表）：改策略 → 只动 L2 数据、不改码；加模型 → 只加 L3 一行；TEE 换 MPC → 只动 L6、L2 自动满足。

## 4. 物理模块结构（三域重组）

```
apps/api/src/
  capability/                  # 声明式七层注册表 + L2 引擎（新建主体）
    shared/                    #   SystemObject 共享约定、LayerKind 枚举、DAG 解析器、key 校验
    l1-scenario/               #   场景注册表（声明 risk_level + 推荐 model/algorithm keys）
    l2-compliance/             #   ★ 规则注册表(4 表) + ComplianceEngine（不执行计算，只裁决）
    l3-model/  l4-algorithm/  l5-operator/  l6-protocol/  l7-infrastructure/
  composition/                 # 任务 = 跨层组合 + 评估结果（compute-task 演进至此）
  runtime/                     # 执行面，消费一个 composition
    orchestrator/  ← secretflow-orchestrator
    contract/      ← digital-contract（usage-control / PEP，与 L2 verdict 并联把关）
    identity/      ← participant-identity（SM2 CA）
    catalog/       ← catalog（数据产品，喂给 L1 场景）
    settlement/  federation/
  # —— 原位不动 ——
  privacy/{fl,mpc,tee}, flower, blockchain, security/{crypto,vault}
        ↑ 登记为 L6/L7 注册表对象的 handlerKey 指向的实现
  auth, audit, tenant, health, fhir, common   # 平台横切件
```

**关键原则**：注册表是**单一事实源**。`privacy / blockchain / crypto` 不搬家——L6 的 `TEE-SGX` 对象用 `handlerKey` 指向 `privacy/tee`，L7 的 `FISCO BCOS` 指向 `blockchain`。换实现只改 handler 绑定，不动注册表；加能力只加一行，不碰代码。

## 5. 数据模型（每层一张强类型表）

每层一张表，跨层依赖用**类型化的 key 数组**（引用下层稳定 `key`，app 层校验存在性），而非通用边表——以此达成"强类型 + DAG 即数据"。

### 5.1 能力层共享约定列（L1、L3-L7 都包含）

`id`(uuid) · `key`(层内唯一稳定标识，如 `'meditron-7b'`) · `layer` · `name` · `version` · `status`(`active|deprecated|draft`) · `metadata`(json) · `basedOn?` · `createdAt`

### 5.2 能力层表

```ts
l1_scenario        { …base, riskLevel:'low'|'medium'|'high', criteria,
                     typicalModelKeys[], typicalAlgorithmKeys[] }
l3_model           { …base, category, trainingAlgorithmKeys[], complianceNote }
l4_algorithm       { …base, category, underlyingOperatorKeys[], compliancePrivacyModels[] }
l5_operator        { …base, opType, supportedProtocolKeys[],
                     complianceDriven:bool, triggeredBy? }
l6_protocol        { …base, family, securityAssumption,
                     securityCapabilityLevel:'basic'|'enhanced', handlerKey? }
l7_infrastructure  { …base, infraType, vendor, complianceNote, handlerKey? }
```

### 5.3 L2 规则层（6 张结构化表，供引擎读取，**完整覆盖**分类学 `Compliance_Guardrails` 的 5 个 `type`）

源 JSON 的 `Compliance_Guardrails` 共 5 类、11 条：`Privacy Model`×3、`Cryptographic Model`×1、`Risk Assessment`×3、`Anonymization Assessment`×2、`Security Assessment`×2。下表逐一归位，**无遗漏**——`required.anonymization` / `required.securityCapability` 的取值语义也是**种子数据而非代码硬编码**（贯彻 §3"数据不是代码"）。

```ts
// Privacy Model + Cryptographic Model（4 条）
l2_guardrail            { key, kind:'privacy_model'|'crypto_model', // k-anon/l-div/t-close/ε-DP
                          thresholds(json), requiredOperatorKeys[], requiredAlgorithmKeys[],
                          applicableScenarios[], basedOn }
// Risk Assessment（3 条：low/medium/high）
l2_risk_policy          { riskLevel, criteria, requiredAnonymizationKey, requiredSecurityCapabilityKey,
                          requiredAlgorithmKeys[], approvalRequired }
// Anonymization Assessment（2 条：Complete/Adequate）—— 定义匿名度等级的语义
l2_anonymization_degree { key, definition, requiredTechniques[],
                          reIdentificationRiskUpper, allowedScenarios[] }
// Security Assessment（2 条：Enhanced/Basic）—— 定义保障级的语义
l2_security_capability  { key, requiredProtocolKeys[], description }
// 5 条阻断规则 + 审批工作流
l2_block_rule           { key, condition(结构化), block:true, reason }
l2_approval_rule        { conditionGroup:'auto_block'|'auto_approve'|'manual', conditions(json) }
```

`l2_risk_policy` 通过 `requiredAnonymizationKey` / `requiredSecurityCapabilityKey` 引用上面两张语义表（与跨层 key 引用同构）。引擎依 `l2_guardrail.kind` **分支读取** `thresholds`（k-anon 读 `{medical_general,high_risk}`、l-div/t-close 读标量、ε-DP 读 `epsilon_range` + `medical_guidelines` + `privacy_budget_tracking`）。

### 5.4 组合与评估表

```ts
composition           { id, computeTaskId?, scenarioKey, modelKeys[], algorithmKeys[],
                        operatorKeys[], protocolKeys[], infraKeys[],
                        riskDimensions(json) }
                        // riskDimensions: 数据敏感度 / 参与方数 / 流通链 / 准标识符密度
                        //                 / 含遗传资源 / 跨境
compliance_evaluation { id, compositionId, overallRisk, required(json),
                        autoVerdict:'auto_approve'|'manual_review'|'block',
                        blockingRulesMatched[], warnings[], evaluatedAt }
```

**`riskDimensions` 的来源（provenance）**：优先**自动派生**——`participantCount`、`crossBorder` 由组合的 parties + catalog 数据产品的 `dataResidency` 推出；`humanGeneticResources`、`dataSensitivity`、`quasiIdentifierDensity` 由数据产品的 `classification` / FHIR schema 推出；`dataFlowChain` 由 outputPolicy 推出。无法派生的项由 §8 compose 向导**人工补录**，并标记来源（`derived` / `manual`）以备审计。

**`compute_tasks` 既有列的归宿**：`composition_id` 成为新事实源后，`algorithmId` / `algorithmParams` / `dataAssets` / `method` / `workloadType` 不再被写入，由 composition 投影覆盖其语义；保留为只读历史列（休眠，不删，避免破坏既有数据与 `WorkloadType` 路由）。执行由 composition 驱动，旧 `SecretFlowTaskSpec` 字段从 composition **投影**生成（保持 orchestrator 不破坏）。

**存放与注册**：新建 `packages/database/src/capability/`，按现有 feature-module 模式经各层模块 `TypeOrmModule.forFeature` 注册到 API 所用 DataSource（dev `synchronize` 自动建表；prod 走迁移）。

## 6. L2 合规引擎（核心）

引擎是纯函数式裁决器，**不执行任何计算**：

```
输入: l1_scenario.riskLevel + composition(各层 keys + riskDimensions)

流程:
  1) 结构校验(DAG 自洽):
     · 算法的 underlyingOperatorKeys ⊆ 已选 operatorKeys
     · 算子的 supportedProtocolKeys ∩ 已选 protocolKeys ≠ ∅
     · 协议 securityCapabilityLevel ≥ 风险要求的保障级
     · L2 guardrail 要求的 requiredOperator/Algorithm 必须在组合内
       (如 ε≤1.0 → 必含 DP-SGD + LaplaceNoise/GaussianNoise)
  2) 治理裁决:
     · 命中任一 l2_block_rule        → verdict=block (+reason)
     · 否则按 l2_approval_rule 判      → auto_approve / manual_review
     · 计算 required{anonymization,k,l,ε,securityCapability,approvalRequired}
     · 收集 warnings(如 含基因组 → NHCC 审批)

输出: compliance_evaluation（结构 = 映射文档里的两段 YAML 示例）
```

**落地策略**：

- **fail-closed**：结构不自洽或规则数据缺失，一律 `block` / `manual_review`，绝不静默放行。
- 与 `runtime/contract` 的 PEP **并联**：合约授权（谁能用谁的数据）+ L2 裁决（这样算合不合规）两关都过，admission 才放行。

## 7. 端到端数据流

```
L1 选场景(risk_level)
  → composition 组合 L3-L7 对象(+riskDimensions)
  → L2 引擎评估 → compliance_evaluation(verdict)
  → admission: verdict ≠ block  AND  contract PEP 通过
  → orchestrator FSM(从 composition 投影出执行 spec)
  → connector 本地 TEE 计算 → output-gate
  → settlement 按贡献分账 + 上链存证

manual_review 时 → 进审批工作流(IRB / 合规官)，批准后再入 admission
```

## 8. Web 三用途（dashboard）

- **知识库后台** `(/console/capability)`：七层对象 CRUD + 依赖关系图（key 数组渲染为 DAG）+ 版本 / 状态管理。
- **任务设计 / 组合** `(/console/compose)`：场景驱动的向导，从注册表真实可选项里挑 L3-L7（替代 assistant 的硬编码默认）；LLM 助手改为从注册表取候选。
- **合规视图**：组合即时显示 L2 verdict、required 约束、命中的 block / warning。

## 9. 种子数据

写一个**幂等 seeder**，把 `隐私计算分类学-JSON.md` 的 JSON 灌入对应表，以 `key` 作幂等键。这是"七层类型写入数据库"的直接交付物。映射须**全覆盖、无遗漏**：

- `Scenarios` → `l1_scenario`
- `Compliance_Guardrails`（按 `type` 拆分）→ `l2_guardrail`(Privacy/Cryptographic Model) + `l2_risk_policy`(Risk Assessment) + `l2_anonymization_degree`(Anonymization Assessment) + `l2_security_capability`(Security Assessment)
- `Models` / `Algorithms` / `Operators` / `Protocols` / `Infrastructure` → `l3`–`l7`
- `block_rules` → `l2_block_rule`；`approval_workflow` → `l2_approval_rule`

种子里出现的层名/算子名统一规范成稳定 `key`（如 `TEE-SGX` → `tee-sgx`），跨层引用一律用 `key`。

## 10. 错误处理

- 引擎 fail-closed（见 §6）。
- seeder 幂等可重跑。
- 未知 key 引用 → 校验报错，绝不忽略。

## 11. 测试策略

- 引擎单测对齐文档两段 YAML：RWS → `manual_review`、CDSS → `auto_approve`。
- 5 条 `block_rule` 各一用例。
- DAG 自洽校验用例（缺算子 / 协议不支持 / 保障级不足）。
- seeder 幂等性测试。
- `composition → SecretFlowTaskSpec` 投影测试。

## 12. 落地阶段（给"物理重构"降风险，每阶段独立可验证）

- **P0** 建 `capability/` 域 + 七层 entities + seeder（**不动旧码**，先让七层类型进库、可查）。
- **P1** L2 规则表 + ComplianceEngine + composition 模型（纯逻辑，带测试）。
- **P2** 接入 admission：composition → verdict 与 contract PEP 并联；`compute_task` 加 `composition_id`。**硬前置**：seeder（§9）必须先成功灌库——否则 fail-closed 引擎面对空规则表会阻断一切；admission 闸门只在规则表非空时启用。
- **P3** 机械搬迁：`orchestrator / contract / identity / catalog` 归入 `runtime/`（独立 PR，纯移动 + 改 import）。
- **P4** Web 三用途页面。

## 13. 决策记录

| 决策点 | 选择 |
|---|---|
| 七层模型与运行时的关系 | 物理重构模块（三域重组） |
| 主要用途 | 合规门控 + 任务设计 / 组合 + 知识库后台（全部） |
| compute task 形态 | 升级为显式跨层组合，由 L2 校验 |
| 重构粒度 | 三域重组（非大爆炸搬迁）；privacy/blockchain/crypto 作 handler 不搬家 |
| 数据库建模 | 每层一张强类型表；跨层依赖用类型化 key 数组 |
| L2 建模 | 6 张结构化规则表（非能力注册表），完整覆盖源 JSON 的 5 类 guardrail |
| 引擎安全姿态 | fail-closed，与 contract PEP 并联 |
