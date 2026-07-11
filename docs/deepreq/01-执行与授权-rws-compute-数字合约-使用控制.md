# 深度需求 · 01 执行与授权层

> 日期: 2026-06-29 · 框架: zai-deepreq 9 维 · 覆盖域: `rws-compute` / `digital-contract` / `usage-control`
> 层定位: 联邦可信数据空间的**核心闭环**——授权(数字合约)→ 强制(使用控制 PEP)→ 执行(RWS/密算)→ 出域(输出闸门)。
> 锚点: 国标 TC609-6-2025-01(数字合约+使用控制为核心技术体系)、TC609-6-2025-15(使用控制)、IDS Usage Control(ODRL/PEP-PDP-PXP);并**对齐 Fly.io 实际部署的真实/mock 边界**(见各域 dim3/dim7)。

---

## A. rws-compute(真实世界研究 / 药物警戒计算)

### A1 对象与数据来源
- **作用对象**: 单个「队列定义 + 分析逻辑」在各医院连接器**本地脱敏数据**上的一次聚合计算实例。原始行级数据永不离院。
- **数据来源**: 连接器 `local-store` 的脱敏 FHIR 资源(Patient/Observation/MedicationStatement/AdverseEvent),经 `deidentifier` 处理后入本地库;药企侧只提供**分析逻辑**(队列入排条件 + 指标定义),不提供数据。
- **当前 Fly 现实**: `apps/agent`(connector-a/b)用合成数据(`dataset.py` 的 `_synth_*`,ESRD/CKD 场景);真实院侧 FHIR 接入未落地。

### A2 触发(枚举所有触发模式)
| 模式 | 条件 | 现状 |
|---|---|---|
| 手动发起 | 药企(consumer)在控制面提交 RWS 任务 → orchestrator `orchestrate()` | ✅ 真实(`/secretflow/tasks`、`/compute-task`) |
| 周期重算 | 药物警戒按月/季度滚动信号检测(新增报告触发) | ✖️ 决策点 D-RWS-1 |
| 事件触发 | 新不良事件(AE)入库达阈值 → 自动重跑信号 | ✖️ 决策点 D-RWS-1 |
| 采样复核 | 信号生成后抽样人工复核 | ✖️ |
- **前置硬门**: 触发后**先过 PEP 准入**(`secretflow-admission.service`,fail-closed):每个 provider 必须有 active 且匹配的 `DigitalContract`,否则 403。再过 L2 合规引擎(见 C 域 / compliance)。

### A3 执行 / 通道
- **通道**: 第一版只走 **TEE 通道**(D3),非 FL 多院联合训练。药企提交「队列定义 + 脚本」→ 在每院连接器本地 TEE 内对脱敏数据执行 → 输出聚合。
- **编排**: `secretflow-orchestrator` 经 gRPC(`AgentDispatchClient` → `AGENT_GRPC_URL=medtrust-connector-a.internal:5024`)派发到 Python agent;`NodeCapabilityService` 做异构降级(`teeu_full` ↔ `pyu_only`)。
- **TEE 现实(关键 mock 边界)**: 设计目标硬件 = 海光 CSV(D9),但 **Fly 上实际跑 `runtime=torch` 软件 fallback**(`apps/agent` import-guarded,无真实机密计算硬件)。"TEE 隔离"目前是进程隔离语义,不是硬件 attestation。→ dim7 异常 & 决策点 D-RWS-4。
- **降级链**: 节点能力不足 → `pyu_only`;超时party → `OrchestratorFsmService` compensation 丢弃(drop-on-timeout);全部 party 掉线 → job FAILED。

### A4 回收 / 记录
- **结果形态**: 仅**聚合结果 + 信号指标 + (FL 时)模型参数 delta**,经 `output_guard` 过滤后回传。原始行级物理无出口。
- **回收正确性**: `outputPolicy.allowedArtifacts` **塑形**输出(省略未授权 artifact),**绝不让已完成的 run 失败**(`output_guard.py` 已修正;TS 连接器 guard 须镜像此语义)。
- **部分/中断**: 某院掉线 → 该院贡献从聚合中剔除并记 compensation 事件;不阻塞其余院出结果(若 ≥1 院有效)。

### A5 状态机(任务级 vs 实例级,勿混淆)
- **任务级(orchestrator FSM)**: `PENDING → ADMITTED → DISPATCHED → RUNNING → AGGREGATING → COMPLETED`;旁路 `FAILED`、`COMPENSATED`(部分院丢弃后继续)。非法跃迁被拒(已测)。
- **实例级(每院 perNode)**: `assigned → running → reported → (timeout)dropped`;FSM 把流式事件 fold 进 state + metrics(`perNode.cohortSize` 等)。
- **二者分离**: 任务 COMPLETED 不要求所有 perNode reported(允许 dropped 后聚合)。

### A6 统计(指标公式 — 药物警戒/RWS 核心)
信号检测沿用国际通行的**不成比例报告**(disproportionality)四格表 `(a,b,c,d)`:a=目标药-目标AE 报告数。

| 指标 | 公式 | 触发阈值(MHRA 综合标准) |
|---|---|---|
| ROR(报告比值比) | `ROR = (a·d)/(b·c)`,95%CI 下限 = `exp(ln ROR − 1.96·SE)` | a≥3 且 95%CI 下限 > 1 |
| PRR(比例报告比) | `PRR = [a/(a+b)] / [c/(c+d)]` | a≥3 且 PRR≥2 且 χ²≥4 |
| χ² | 四格表卡方 | ≥4 |
| IC(BCPNN 信息成分) | `IC = log2[ P(drug,AE) / (P(drug)·P(AE)) ]` | IC 的 95%CI 下限(IC−2SD)> 0 |
- **队列疗效路径(备选切口)**: 发生率 `incidence = 事件数/人时`、风险比 HR(Cox)、KM 生存曲线点。**切口形态(信号检测 vs 队列疗效)是唯一靠调研无法消除的 Open Question**,需真实药企 PV 岗访谈 → 决策点 D-RWS-2(★ 影响输出闸门规则与任务 schema)。
- **分组维度**: 按药品(URN)、AE(MedDRA PT/SOC)、医院、时间窗;**跨院聚合只在四格表计数层面相加,不交换个案**。
- **下钻**: 信号 → 贡献该信号的院级计数(不可下钻到个案行)。

### A7 边界 / 异常(穷举)
1. **小样本/再标识**: a<3 不出信号;输出闸门小单元格抑制 `n<5`(见 usage-control C5)。
2. **TEE 非硬件**: 当前 torch fallback 无远程证明 → 不可对医院声称"硬件级机密计算";须在合约/审计中如实标注通道为软件隔离(决策点 D-RWS-4)。
3. **存证写入**(勘误): 原 FISCO mock 已被推翻——**现经长安链 ChainMaker Java sidecar 真实 `storeAttestation` 写入**(migration 阶段 0–4 通过)。残留风险 = sidecar 密钥/口令治理 + solo 单节点 → 决策点 D-RWS-3-a/b(★),见 [04 技术选型](04-技术选型-架构级决策点.md)。
4. **party 掉线/超时**: drop + 记账惩罚(`contributions` drop-penalized);全掉 → FAILED。
5. **死亡/转院/失访**(队列路径): 删失(censoring)按人时处理,不可当缺失丢弃。
6. **刷量/伪造贡献**: 贡献由 orchestrator 从 `cohortSize` 客观计量,**禁止使用方单方声明**(见 value-settlement)。
7. **并发同合约多任务**: 各任务独立 FSM;预算独立(`TaskBudget`)。
8. **预算耗尽**: `budget`(默认 100 CNY)用尽 → 拒新任务。

### A8 权限 / 审计
- **RBAC**(复用平台原生 `ParticipantRolesGuard`): 发起 RWS = `consumer`/`provider`;`/contracts` 写 = `@ParticipantRoles('provider')`。
- **数据范围**: provider 只见自院 perNode;consumer 见聚合结果;operator 见全量。
- **审计**: 每步进 `AuditService`;关键证据(任务哈希/策略哈希/输入指纹/输出哈希/时间戳)进存证(见 B/D6)。**本地审计真实,上链摘要待接真实链。**

### A9 数据模型
- 复用 `compute-task`(保留 vestigial `requestId`,无旧实体关系)+ orchestrator `OrchestrationRecord`(`types.ts`):`perNode[]{cohortSize, tier, state}`、`settlementLines[]`、`transitions[]`、`logEvents[]`。
- 任务 spec = `SecretFlowTaskSpec`/RWS analysis spec(`parties/modalities/privacy(DpSgd ε)/outputPolicy.allowedArtifacts`)。
- **柔性字段**: analysis 定义(队列入排、指标列表)宜存 jsonb;不同 RWS 形态共用一张表 + 类型判别字段(信号检测 / 队列疗效)。

---

## B. digital-contract(数字合约 — 授权载体)

### B1 对象与数据来源
- **对象**: 一份 consumer↔provider(就某数据产品 URN)的可执行授权策略。来源 = 控制面合约生成 + provider 审批。

### B2 触发
| 模式 | 条件 |
|---|---|
| 申请 | consumer 对某 data-product 发起合约请求(`ContractRequest`) |
| 审批 | provider `approve`(`ApproveContractDto`) → active |
| 撤销 | provider/operator `revoke` → effective status = revoked |
| 到期 | 过 `validUntil` → 报告 expired(惰性判定,已测) |

### B3 执行 / 下发
- 合约 = 授权产物;**强制执行点在连接器 PEP**(见 usage-control)。合约 active 后,其策略哈希下发至执行链;每次计算前 `secretflow-admission` 校验 active+匹配+purpose。

### B4 回收 / 记录
- 状态变更全程记录;合约策略哈希 → `AttestationService.anchor()` 上链(B7)。

### B5 状态机
- `draft → active → (revoked | expired)`。`expired` 为惰性派生(查询时比 `validUntil`),`revoked` 为显式翻转(已测 round-trip)。
- 区分**合约级**状态与**单次使用级**(use-event)——使用级由 usage-control 记录,合约级只管授权窗口。

### B6 统计
- 活跃合约数、按 provider/consumer/数据产品分组的授权量、撤销率 = `撤销数/签发数`、到期续约率。

### B7 边界 / 异常
1. **撤销后在途任务**: revoke 立即翻转 → 下一次 PEP 校验即拒;已在 TEE 内运行的任务按 D-DC-1 决策(立即中止 vs 允许完成当前批)。
2. **存证写入**(同 A7-3,勘误): 合约哈希 `anchor()` 现经长安链 ChainMaker sidecar 真实写入,不再是占位 receipt → D-RWS-3 已落定,残留 D-RWS-3-a/b,见 [04](04-技术选型-架构级决策点.md)。
3. **purpose 不匹配**: admission fail-closed 拒(已测 enforces purpose)。
4. **无合约/全空**: fail-closed 403(已测)。

### B8 权限 / 审计
- 写合约 = `provider`;查 = 各自范围;每次状态变更 + attest 进审计。

### B9 数据模型
- `DigitalContract`(`blockchain-attestation.entity` 邻域 + control-plane):`consumerId/providerId/dataProductUrn/purpose/retention/outputPolicy/pricing/validUntil/status/policyHash`。`pricing`(按任务/按记录/订阅)为 value-settlement 接入点(见 03 文件)。

---

## C. usage-control(使用控制 — 合约的强制执行)

### C1 对象与数据来源
- **对象**: 一次数据使用请求(计算任务)对照其数字合约策略的实时裁决 + 义务执行。对齐 IDS:**ODRL** 策略(permission/prohibition/duty)+ **PEP/PDP/PXP** 三点架构。

### C2 触发
- 每次计算执行**前**(PEP 拦截)+ 执行**中**(持续约束:留存/输出)+ 执行**后**(义务 PXP:写审计、上链、通知)。非一次性审批——这是取代旧 `access-request` 的核心(D4)。

### C3 执行 / 下发
- **PDP(决策)**: `secretflow-admission`(合约 active/匹配/purpose,fail-closed)+ **L2 合规引擎**(`capability/l2-compliance/compliance-engine`)做风险裁决,verdict ∈ `{auto-approve, manual-review, block}`。
- **PEP(执行)**: 连接器侧拦截数据流,等 PDP 裁决;block → ForbiddenException 不派发(已测 `l2-gate`)。
- **PXP(义务)**: 完成后 `onComplete` → `anchor(reportHash)` 上链 + `SettlementService.record(...)`。

### C4 回收 / 记录
- 裁决结果 + 命中规则 + 义务执行回执全程记录;manual-review 进人工队列(决策点 D-UC-1:复核 SLA/超时默认动作)。

### C5 状态机 + 输出闸门
- 使用级状态: `requested → admitted → executing → gated → released`;旁路 `denied(block)`、`pending-review`。
- **输出闸门(Output Gate,连接器侧强制,D5)**: 通过才出域。规则:
  - 小单元格抑制 `n<5`(已是 L2 规则 `cross-institution + k<5 → block`)。
  - 差分隐私预算 `ε ≤ 8.0`(L2 规则 `epsilon > 8.0 → block`);DP-SGD 参数由 transpiler 注入。
  - artifact 白名单塑形(`output_guard`,A4)。

### C6 统计(L2 合规引擎裁决公式)
`computeRequired(riskDimensions)` 按风险维度计算必需管控,`evaluateCompliance` 出 verdict。已实现规则(测试即规格):
| 规则 | verdict |
|---|---|
| RWS 高风险 + 基因组学 | manual-review |
| CDSS 低风险 + 内部 | auto-approve |
| 高风险 + 部分匿名化 | block |
| 高风险 + 非增强安全等级 | block |
| 跨机构 + k<5 | block |
| ε > 8.0 | block |
| 缺必需算法(结构性) | block |
| 涉人类遗传资源 + 无 NHCC(科技部人遗办)批件 | block |
- 统计: 裁决分布(auto/review/block 占比)、block 原因 top-N、manual-review 平均时延。

### C7 边界 / 异常
1. **合约中途撤销**: 见 B7-1(★决策 D-DC-1)。
2. **manual-review 无人处理**: 超时默认动作?(D-UC-1)
3. **义务执行失败**(上链 mock / settlement 异常): PXP 失败是否回滚已出域结果?(结果已出域不可撤 → 须 fail-closed 在出域**前**完成关键义务)→ 决策点 D-UC-2(★)。
4. **跨空间使用**: 远端合约互认(见 02 participant-identity / space-interconnect)。

### C8 权限 / 审计
- 复用平台 RBAC;合规复核 = `compliance`/`operator` 角色(新增 compliance 角色已端到端打通:`compliance@medtrust.org`,web 合规总览/告警/审计页)。

### C9 数据模型
- 策略 = 合约内嵌 ODRL-like 结构(`purpose/retention/outputPolicy{allowedArtifacts, dpEpsilon, suppressBelow}`);裁决记录 = L2 composition + EvaluationResult(`engine.types`:`Risk/SecurityLevel/ComplianceRequired`)。

---

## 本文新增待决策点

| # | 决策点 | 影响 | ★架构 |
|---|---|---|---|
| D-RWS-1 | RWS 触发模式:仅手动 vs 加周期/事件/采样滚动信号检测 | 调度器、任务 schema | |
| D-RWS-2 | RWS 切口精确形态:信号检测 vs 队列疗效分析(需药企 PV 岗访谈) | 输出闸门规则、任务 schema、指标引擎 | ★ |
| D-RWS-3 | FISCO 真写入方案:Go/Python 3.x SDK sidecar vs 降链到 2.x npm SDK | 存证可信性、部署拓扑 | ★ |
| D-RWS-4 | TEE 通道如实标注:软件隔离(torch fallback)期间如何向医院/合约表述,何时切海光 CSV | 信任表述、合规、采购 | ★ |
| D-DC-1 | 合约撤销对在途 TEE 任务:立即中止 vs 允许完成当前批 | PEP 中止语义、结算 | ★ |
| D-UC-1 | manual-review 复核 SLA 与超时默认动作(默认拒/默认放) | 合规流程、用户体验 | |
| D-UC-2 | 出域义务(上链/结算)执行失败的处理:关键义务必须在出域前 fail-closed 完成 | 输出闸门时序、数据主权 | ★ |

## 调研来源
- 国标: TC609-6-2025-01《可信数据空间技术架构》、TC609-6-2025-15《使用控制技术要求》(见 design.md 链接)
- 药物警戒信号检测(ROR/PRR/χ²/IC 公式与 MHRA 阈值): [中国药房 2022](http://net.china-pharmacy.com/2022/202222/files/basic-html/page81.html) · [FAERS CNS 信号挖掘 PMC10930086](https://pmc.ncbi.nlm.nih.gov/articles/PMC10930086/) · [药物警戒数据挖掘](https://www.jianshu.com/p/69dfbcceef9b)
- 使用控制架构(ODRL/PEP-PDP-PXP/duty): [IDS-RAM 4.1.6 Usage Control](https://docs.internationaldataspaces.org/ids-knowledgebase/ids-ram-4/perspectives-of-the-reference-architecture-model/4_perspectives/4_1_security_perspective/4_1_6_usage_control) · [Dataspace Connector Usage Control](https://international-data-spaces-association.github.io/DataspaceConnector/Documentation/v5/UsageControl)
- Fly.io 真实/mock 边界: 本仓库部署记忆(8/8 真实部署,存证写 mock、TEE torch fallback)
