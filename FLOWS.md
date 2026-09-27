# FLOWS.md — 跨域任务链

> **机器可校验的流程契约**。每条链以 `yaml flow` 围栏块声明；medtrust 的 flow 不锚 cron，
> 锚**跨域边**：每步必须声明 `crosses`（跨越哪条信任边界）与 `payload`（携带什么等级的数据）。
> **红线（checker 强制）：`payload: raw-local` 的步骤，`crosses` 只许 `none` 或
> `connector→local`——行级数据出现在任何跨域边上 = 校验直接红。** 这把 ARCHITECTURE §3
> 的核心不变量（数据不出域）落成每条流程边上的机检属性。
> 改跨域流程/闸门顺序/新增任务链时必须同步本文件，跑 `node scripts/check-meta-docs.mjs`。
> dead_edge_check 声明 producer→consumer 配对，防"产出无人消费/消费无人产出"死边。

## 跨域边与数据分级

| crosses | 语义 |
|---|---|
| `none` | 不越信任边界（控制面内部 / 连接器本地） |
| `consumer→control` / `control→consumer` | 药企控制台 ↔ 控制面（任务提交 / 结果交付） |
| `participant→control` / `control→participant` | 参与方注册/领证 ↔ 控制面 |
| `control→connector` / `connector→control` | 控制面 ↔ 医院连接器（传输一律连接器**主动外联拉取**，不开入站） |
| `control→chain` | 控制面 → 存证链（ChainMaker sidecar） |
| `connector→local` | 连接器 ↔ 本地数据源（院内） |
| `cross-space` | 本空间 ↔ 其他可信数据空间 |
| `control→external` | 控制面 → **外部第三方供应商**（AI/LLM API 等，信任边界之外，不受本空间治理） |
| `control→node` / `node→control` | 控制面 ↔ **可信空间节点**（独立参与方，与医院连接器不是同一组件） |
| `node→kms` | 可信空间节点 → 数据持有方自建/共管的 **KMS**（跨信任边界：节点运营方不得持密钥） |

| payload | 语义 | 允许出域 |
|---|---|---|
| `raw-local` | （脱敏后）行级数据 | **仅 none / connector→local** |
| `aggregate-only` | 聚合结果：计数/效应量+SE/截断 KM/模型更新 | 过输出闸门后允许 |
| `evidence-hash` | 哈希/指纹/时间戳（D6） | 允许 |
| `task-spec` | 任务定义（含合约策略快照） | 允许（入连接器方向） |
| `policy` | 合约/策略状态变更 | 允许 |
| `credential` | 证书/CSR/信任清单 | 允许 |
| `catalog-meta` | 数据产品元数据 | 允许（只读） |
| `prompt-text` | 送外部 AI 供应商的提示词文本（**不含任何患者衍生内容**） | 仅 control→external |
| `sealed-envelope` | **C2 数据信封**：AEAD 密文 + 密钥封套（数据密钥封给目标节点会话的一次性公钥）+ 策略 + 持有方签名。**不是行级数据**：明细只在节点内解封后短暂存在 | 仅 `connector→control`（持有方提交中继）、`control→node`（平台转发给节点）与节点内部（`none`，仍是密文） |
| `none` | 纯控制信号 | 允许 |

**第二条红线（checker 强制）**：`crosses: control→external` 的步骤，`payload` 只许
`prompt-text` 或 `none`。任何患者衍生载荷（`raw-local` / `aggregate-only`）流向外部
供应商 = 校验直接红。理由见 TRUST CTL-11 与 DECISIONS D-AI-1：外部 AI 供应商在信任
边界之外，其留存与再训练策略不受本空间治理，出域即不可撤回。

**MDOP 的 C0–C3 与本表 payload 的对应**（mdop-kernel / 协议 §5）：C0 是节点内的行级/明细
制品，对应 `raw-local`（只许 `none` / `connector→local`）；C1（密态）与 C2（受控流动、
依赖可信空间节点）本期在协议里保留、硬件 TEE 到位前**编译期即拒**，因此本表暂无对应项；
C3 是过输出闸门后**可发布**的聚合制品，对应 `aggregate-only`——它正是
`connector→control` 那条 C3 投递边携带的载荷。换言之：**C0 出节点在编译器、复核器与
出节点守卫三处都会被拦**，本文件的红线检查是这条不变量的第四道旁证。

## RWS 阶梯任务链（L1.5 → L4）

四级共用同一骨架：提交 → 准入 → 下发 → **本地计算（raw-local 永远 crosses: none）** →
输出闸门 → 聚合回传 → 中心合并 → 存证。差异只在本地算子与中心合并器。

### FLOW-RWS-01 · L1.5 失衡信号检测（PRR/ROR）

```yaml flow
id: FLOW-RWS-01
name: L1.5 失衡信号检测（药物警戒四格表）
trigger: 药企经控制台提交分析任务（analysisType=disproportionality，D-RWS-2）
steps:
  - actor: ts:apps/api/src/runtime/rws-orchestrator/rws-orchestrator.controller.ts#RwsOrchestratorController
    crosses: consumer→control
    payload: task-spec
    produces: [cp_rws_task(status=pending)]
    consumes: [cp_digital_contract(status=active)]
  - actor: ts:apps/api/src/runtime/rws-orchestrator/rws-admission.service.ts#RwsAdmissionService
    crosses: none
    payload: none
    produces: [准入判定, cp_rws_task(protocolVersion=1, protocolWarnings)]
    consumes: [cp_participant(双认证), cp_digital_contract, cp_data_product(rightsConfirmed/classification)]
    note: |
      未过双认证/合约门抛 AdmissionDeniedError（INV-ID-01）。
      rws-study-protocol-spec Phase 2/3 已启用：validateRwsAnalysisLadder 在更早一步
      fail-closed 拒绝缺 designType/rationale（全局必填）/ SAP（L2/L3/L4 必填，L1.5
      单组合豁免，多组合须声明 α 校正）/ 结局-暴露编码集交集 / 缺失值配对不全。其余
      可选要素（missingness 未声明、自由文本结局-暴露独立性）经 computeProtocolWarnings
      以警告形式写入 cp_rws_task.protocolWarnings（EVD-06/07/08/09/11/12）。冻结触发在
      下一步 pullPending（首次派发写 frozenAt，EVD-07）。
  - actor: ts:apps/api/src/runtime/rws-orchestrator/connector-pull.controller.ts#ConnectorPullController
    crosses: control→connector
    payload: task-spec
    produces: [cp_rws_assignment(status=running)]
    consumes: [cp_rws_task]
    note: |
      连接器主动外联**长轮询**领取（`GET /api/v1/connector/tasks/pending?waitMs=`，无待办时服务端挂起，
      出现面向本连接器的新任务立即返回；outbound-longpoll-agent-auth D2）；assignment 内嵌合约快照供 PEP 用。
      下发任务带平台 SM2 签名，连接器验签 + 校验目标参与方/时效/taskId 去重后才执行（D4）。
      旧的 `connector/rws/pending`、`connector/fl-prediction/pending` 迁移期保留（已废弃）。
  - actor: ts:apps/connector/src/domain/rws-executor.ts#RwsExecutor
    crosses: none
    payload: raw-local
    produces: [本地四格表 a/b/c/d]
    consumes: [local_record]
    note: |
      两条执行路径（algorithm-sandbox，按合约固定模块选择，不由任务自选）：
      ① 合约未固定模块 → 内置实现 disproportionalityTables（D-CN-1），结果标注
         executionIsolation=none（软件级、同进程、无隔离，CTL-09）；
      ② 合约固定了 `pinnedModules['disproportionality']` → 最小列投影（是否入组/是否暴露/
         每词条是否发生）在本地库守卫内完成，词条文本留在宿主一侧，模块在**零能力 Wasm
         沙箱**（worker + 只导入 env.memory，超时/内存上限）内只算 a/b/c/d，结果标注
         wasm-sandbox + 模块 SM3（CTL-20）。运行前两项独立校验：模块 SM3 = 合约固定值；
         模块 SM2 签名用部署配置固定的平台 CA 公钥验过 —— 任一失败即任务失败，不回退到 ①。
      两条路径都仍在 SoftwareSealedCompute 内（软件级、无隔离）；PEP 每步校验合约（INV-PEP-01）。
  - actor: ts:apps/connector/src/domain/output-gate.ts#OutputGate
    crosses: connector→control
    payload: aggregate-only
    produces: [cp_rws_assignment.aggregate, cp_rws_assignment(status=completed)]
    consumes: [本地四格表 a/b/c/d]
    note: n<5 抑制 fail-closed（INV-GATE-01，D-UC-2）；默认 gate-then-merge。P2 merge-then-gate（runMergeThenGate）仅同进程：ungated 不得出现在本步 crosses=connector→control。执行隔离标注在闸门之后、规范化与算结果 SM3 之前写入 `aggregate.execution`，因此受结果哈希覆盖（篡改即验哈希失败）；控制面按院入库 cp_rws_assignment.executionIsolation/moduleSm3，任务级取最弱
  - actor: ts:apps/api/src/runtime/rws-orchestrator/disproportionality.ts
    crosses: none
    payload: aggregate-only
    produces: [cp_rws_task.merged, cp_rws_task(status=completed|partial)]
    consumes: [cp_rws_assignment.aggregate]
    note: 跨院四格表按格相加后重算 PRR/ROR（INV-RWS-01）；输入须为过闸 aggregate
  - actor: ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService
    crosses: control→chain
    payload: evidence-hash
    produces: [cp_attestation_ref(kind=output), 链上哈希]
    consumes: [cp_rws_task.merged]
    note: 异步 fail-open + 补偿队列（D-UC-2）；只存哈希（INV-ATT-01）。存证元数据附 executionIsolation 与模块 SM3 列表（如实标注，attestationLevel 不变，CTL-09）
dead_edge_check:
  - producer: OutputGate 放行 → assignment.aggregate
    consumer: disproportionality 合并读取全部 assignment.aggregate
  - producer: 合并产出 merged
    consumer: AttestationService 存证 + FLOW-SETTLE-01 计量分账
  - producer: OutputGate 拦截（OutputBlocked）
    consumer: local_audit_log 留痕（INV-GATE-01/INV-RAW-01 审计线）
```

### FLOW-RWS-02 · L2 比较效果 Meta 分析

```yaml flow
id: FLOW-RWS-02
name: L2 比较效果（分层效应量 + DerSimonian-Laird 合并）
trigger: analysisType=comparative-effect 提交（骨架同 FLOW-RWS-01，仅列差异步骤）
steps:
  - actor: ts:apps/connector/src/domain/comparative-effect.ts#effectEstimateFromStratifiedTables
    crosses: none
    payload: raw-local
    produces: [分层四格表, 效应量+SE]
    consumes: [local_record]
    note: rws-worker 在 SoftwareSealedCompute 内执行（软件级、同进程、无隔离，CTL-09）（D-CN-1）；小分层抑制后重算（INV-GATE-01）
  - actor: ts:apps/connector/src/domain/output-gate.ts#OutputGate
    crosses: connector→control
    payload: aggregate-only
    produces: [cp_rws_assignment.aggregate(效应量+SE)]
    consumes: [效应量+SE]
  - actor: ts:apps/api/src/runtime/rws-orchestrator/meta-analysis.service.ts#MetaAnalysisService
    crosses: none
    payload: aggregate-only
    produces: [cp_rws_task.merged(随机效应合并)]
    consumes: [cp_rws_assignment.aggregate]
dead_edge_check:
  - producer: 各院效应量出域
    consumer: MetaAnalysisService 随机效应合并（拒绝非法输入 MetaInputRejected）
```

### FLOW-RWS-03 · L3 因果推断（PSM/IPTW + Cox/KM）

```yaml flow
id: FLOW-RWS-03
name: L3 因果推断生存分析
trigger: analysisType=causal 提交（骨架同 FLOW-RWS-01，仅列差异步骤）
steps:
  - actor: py:apps/agent/src/medtrust_agent/psm_iptw.py
    crosses: none
    payload: raw-local
    produces: [倾向评分匹配队列]
    consumes: [local_record]
    note: rws-worker 经 apps/connector/src/domain/causal/causal-executor.ts 委托 agent gRPC 重计算（D-CN-1）
  - actor: py:apps/agent/src/medtrust_agent/cox_km.py
    crosses: none
    payload: raw-local
    produces: [HR/ATE+SE, KM 曲线]
    consumes: [倾向评分匹配队列]
  - actor: ts:apps/connector/src/domain/output-gate.ts#OutputGate
    crosses: connector→control
    payload: aggregate-only
    produces: [cp_rws_assignment.aggregate(HR+SE, 截断 KM)]
    consumes: [HR/ATE+SE, KM 曲线]
    note: 闸门在 worker 侧；KM 尾部 atRisk<5 截断（km-gate.ts#gateKmCurve，INV-GATE-01）
  - actor: ts:apps/api/src/runtime/rws-orchestrator/causal-effect-merge.ts
    crosses: none
    payload: aggregate-only
    produces: [cp_rws_task.merged]
    consumes: [cp_rws_assignment.aggregate]
dead_edge_check:
  - producer: 截断后 KM + HR 出域
    consumer: causal-effect-merge 跨院合并
```

### FLOW-RWS-04 · L4 联邦预测

```yaml flow
id: FLOW-RWS-04
name: L4 联邦学习预测（模型更新跨域，样本不动）
trigger: 药企提交 flPredictionSpec（fl-orchestrator 通道）
steps:
  - actor: ts:apps/api/src/runtime/fl-orchestrator/fl-orchestrator.controller.ts#FlOrchestratorController
    crosses: consumer→control
    payload: task-spec
    produces: [cp_fl_prediction_task(status=pending)]
    consumes: [cp_digital_contract(status=active)]
  - actor: ts:apps/api/src/runtime/fl-orchestrator/fl-admission.service.ts#FlAdmissionService
    crosses: none
    payload: none
    produces: [准入判定]
    consumes: [cp_participant(双认证), cp_digital_contract]
  - actor: ts:apps/api/src/runtime/fl-orchestrator/fl-orchestrator.service.ts#FlOrchestratorService
    crosses: control→connector
    payload: task-spec
    produces: [cp_fl_prediction_assignment(status=running)]
    consumes: [cp_fl_prediction_task]
    note: |
      下发经统一长轮询（`GET /api/v1/connector/tasks/pending`，上限 25s；outbound-longpoll-agent-auth D2）：
      连接器出站领取，平台不要求参与方开放入站端口。每个下发任务带平台 CA 的 SM2 签名
      （内容含目标参与方/任务类型/任务 ID/签发时间/任务内容），连接器用部署固定的平台 CA
      公钥验签并检查目标参与方、时效、taskId 去重（D4）。
  - actor: ts:apps/connector/src/domain/fl-prediction/fl-task-runner.ts#FlTaskRunner
    crosses: none
    payload: raw-local
    produces: [本方模型更新 + 本地指标]
    consumes: [合约授权的数据产品（按 contract.dataProductId 私有装载）]
    note: PEP 先校验 spec 里本院 party 声明的数据产品恰为合约授权的那个（不符即拒并留痕，一行不读）；取数不读也不替换共享 LocalStore；CDM 产品拒绝；产品无记录即失败（不编样本数）。训练走连接器内 FedAvg LR 或 connector-ml 侧车；样本永不出域
  - actor: ts:apps/connector/src/domain/connector-worker.service.ts#ConnectorWorkerService
    crosses: connector→control
    payload: aggregate-only
    produces: [cp_fl_prediction_assignment.partyResult]
    consumes: [本方模型更新 + 本地指标]
    note: 只交换模型更新/指标（聚合结果定义见 DOMAIN 术语表）；出域前过 fl-output-guard（assertSafeFlPartyRunResult）与 DP 闸（assertDpCompliance）
  - actor: ts:apps/api/src/runtime/fl-orchestrator/fl-orchestrator.service.ts#FlOrchestratorService
    crosses: none
    payload: aggregate-only
    produces: [cp_fl_prediction_task.merged, resultSummary]
    consumes: [cp_fl_prediction_assignment.partyResult]
    note: FedAvg 表格 LR 可合并 weightBundle（model_weights）；非 raw-local
  - actor: ts:apps/api/src/runtime/fl-orchestrator/fl-orchestrator.controller.ts#FlOrchestratorController
    crosses: control→consumer
    payload: model-weights
    produces: [FlWeightBundle]
    consumes: [cp_fl_prediction_task.merged.weightBundle, cp_digital_contract(status=active)]
    note: 仅消费方+生效合约可下载；单患者特征不得经本边（浏览器本地推理）
  - actor: ts:apps/web/src/app/(console)/space/infer/[taskId]/page.tsx
    crosses: none
    payload: none
    produces: [本地风险概率]
    consumes: [FlWeightBundle]
    note: browser-local only；患者表单不上送 API（CTL-13）
  - actor: ts:apps/api/src/runtime/fl-orchestrator/fl-attestation.service.ts#FlAttestationService
    crosses: control→chain
    payload: evidence-hash
    produces: [cp_attestation_ref]
    consumes: [cp_fl_prediction_task.merged]
dead_edge_check:
  - producer: partyResult 出域
    consumer: FlOrchestratorService 合并全部 partyResult
  - producer: merged 产出
    consumer: FlAttestationService 存证
  - producer: weightBundle 交付
    consumer: space/infer 浏览器本地打分
```

### FLOW-RWS-05 · L0 算法验证（识别算法准确性）

骨架与 FLOW-RWS-01 同源，差异在本地算子（算法求值 + 金标准比对）与中心合并器（**不合并、按 providerId 分列**）。
跨域载荷始终是 2×2 混淆矩阵计数（TP/FP/TN/FN），个体金标准标注永不出域。

```yaml flow
id: FLOW-RWS-05
name: L0 算法验证（识别算法准确性指标 Se/Sp/PPV/NPV）
trigger: 药企/医院经控制台提交 algorithm-validation 任务（识别算法定义 + 目标变量 + 金标准集版本，rws-algorithm-validation D1–D6）
steps:
  - actor: ts:apps/api/src/runtime/rws-orchestrator/rws-orchestrator.controller.ts#RwsOrchestratorController
    crosses: consumer→control
    payload: task-spec
    produces: [cp_rws_task(status=pending, analysisType=algorithm-validation)]
    consumes: [cp_digital_contract(status=active, allowedArtifacts 含 validation_metrics, allowedLevels 含 L0)]
    note: 算法定义作为入站载荷携带；闭合语法校验在连接器侧（CTL-10），控制面只做结构完整性校验
  - actor: ts:apps/api/src/runtime/rws-orchestrator/rws-admission.service.ts#RwsAdmissionService
    crosses: none
    payload: none
    produces: [准入判定]
    consumes: [cp_participant(双认证), cp_digital_contract, cp_data_product]
    note: 未过双认证/合约门抛 AdmissionDeniedError（INV-ID-01）
  - actor: ts:apps/api/src/runtime/rws-orchestrator/connector-pull.controller.ts#ConnectorPullController
    crosses: control→connector
    payload: task-spec
    produces: [cp_rws_assignment(status=running)]
    consumes: [cp_rws_task]
    note: 连接器主动外联拉取；assignment 内嵌合约快照供 PEP 用
  - actor: ts:apps/connector/src/domain/algorithm-validation-executor.ts#AlgorithmValidationExecutor
    crosses: none
    payload: raw-local
    produces: [本地 2×2 混淆矩阵 TP/FP/TN/FN]
    consumes: [local_record, local_gold_standard]
    note: 先 grammar-validate 算法（CTL-10），再在 SoftwareSealedCompute 内（软件级、无隔离）逐主体求值 + 与金标准比对；attestationLevel=software（D-RWS-4）；无金标准时 fail-closed。测试路径金标准来自注入真值（D-DATA-1：`goldFromInjectedTruth` / truth.json `truePancreatitis`），非 flip 占位；合成 provenance=synthetic MUST NOT 用于申报（CTL-12）
  - actor: ts:apps/connector/src/domain/output-gate.ts#OutputGate
    crosses: connector→control
    payload: aggregate-only
    produces: [cp_rws_assignment.aggregate(含 validationResult), cp_rws_assignment(status=completed)]
    consumes: [本地 2×2 混淆矩阵]
    note: 任一格 < DEFAULT_MIN_CELL 则全部指标不出域（D3 fail-closed，D-UC-2）；payload 永远是计数，从不是个体标注
  - actor: ts:apps/api/src/runtime/rws-orchestrator/l0-validation-merge.ts#L0ValidationMergeService
    crosses: none
    payload: aggregate-only
    produces: [cp_rws_task.merged(l0Validation: per-provider results), cp_rws_task(status=completed|partial)]
    consumes: [cp_rws_assignment.aggregate]
    note: MUST NOT 合并/平均（D6）；结果按 providerId 分列；单院任务也走此路径产出存证
  - actor: ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService
    crosses: control→chain
    payload: evidence-hash
    produces: [cp_attestation_ref(kind=output), 链上哈希]
    consumes: [cp_rws_task.merged.l0Validation]
    note: 异步 fail-open + 补偿队列（D-UC-2）；只存哈希（INV-ATT-01）；绑定三元组（算法版本 / 数据源 / 标注集版本）
dead_edge_check:
  - producer: OutputGate 放行 → assignment.aggregate.validationResult
    consumer: L0ValidationMergeService 读取全部 assignment.aggregate
  - producer: L0 分列产出 merged.l0Validation
    consumer: AttestationService 存证 + EVD-05 报告带出（任务 5.5 carry-along）
  - producer: OutputGate 拦截（fail-closed）
    consumer: local_audit_log 留痕（validation-suppressed，INV-GATE-01 审计线）
```

### FLOW-RWS-06 · 联邦训练轮次（LoRA FedAvg，经连接器中转）

控制面不再直连参与方计算后端：每院每轮的训练任务经连接器长轮询下发，由连接器在院内调用本院
agent 后回传结果（outbound-longpoll-agent-auth D1/D3）。

```yaml flow
id: FLOW-RWS-06
name: 联邦训练轮次（控制面不直连院内计算后端）
trigger: 消费方提交 SecretFlow 任务，控制面按轮为各院生成轮次任务
steps:
  - actor: ts:apps/api/src/runtime/secretflow-orchestrator/secretflow-orchestrator.service.ts#SecretFlowOrchestratorService
    crosses: none
    payload: none
    produces: [轮次任务入队(每院每轮), OrchestrationRecord(状态机)]
    consumes: [SecretFlowTaskSpec, cp_digital_contract(status=active)]
    note: PEP 准入 + 节点能力编排；每轮设时限，未按时回传的医院踢出本轮（补偿），下一轮可重新参与
  - actor: ts:apps/api/src/runtime/secretflow-orchestrator/fl-round-queue.service.ts#FlRoundQueueService
    crosses: control→connector
    payload: task-spec
    produces: [本院轮次任务(带平台 SM2 签名)]
    consumes: [轮次队列]
    note: 经长轮询下发（D2，上限 25s）；任务签名覆盖目标参与方/类型/ID/签发时间/内容（D4）。控制面 MUST NOT 直接连接参与方计算后端
  - actor: ts:apps/connector/src/domain/fl-round/fl-round-executor.ts#FlRoundExecutor
    crosses: none
    payload: raw-local
    produces: [训练切片（schema + 7 维数值特征 + 0/1 标签，无假名/人口学/诊断文本）]
    consumes: [轮次任务(验签后), contract.dataProductId → 本院数据产品（连接器去标识记录）]
    note: 验签 → PEP（合约生效/目的相符/允许 L4 与 model_hash）→ 按合约的数据产品投影切片（CDM 产品拒绝、不读文件；不替换共享本地存储）→ 带共享凭证 x-agent-token 在院内调用本院 agent（D6），切片随请求给出（omop-data-source-access 4.3，D-CN-6）
  - actor: py:apps/agent/src/medtrust_agent/fed_trainer.py
    crosses: none
    payload: raw-local
    produces: [本地 LoRA 增量 + 本轮指标]
    consumes: [训练切片（连接器投影）]
    note: agent 不自行读取任何院内数据：无切片即本轮失败；切片之外的字段拒收；spec 带 dataPath 即拒。只在参与方内部网络监听且校验共享凭证（D6）
  - actor: ts:apps/connector/src/domain/fl-round/fl-round-executor.ts#FlRoundExecutor
    crosses: connector→control
    payload: model-weights
    produces: [轮次结果回传(结果 SM3 + 连接器 SM2 签名)]
    consumes: [本地 LoRA 增量, 本轮指标]
    note: 只回模型增量与指标（不回原始数据）；平台用连接器证书公钥验结果签名
  - actor: ts:apps/api/src/runtime/secretflow-orchestrator/secretflow-orchestrator.service.ts#SecretFlowOrchestratorService
    crosses: none
    payload: aggregate-only
    produces: [FedAvg 全局适配器, 存证, 结算台账]
    consumes: [各院轮次结果]
    note: 等齐各院结果后按样本权重平均；前端经 /ws/secretflow 收每轮指标（取代原先的 agent 日志桥）
dead_edge_check:
  - producer: 轮次任务入队
    consumer: 连接器长轮询领取并在院内执行
  - producer: 各院轮次结果回传
    consumer: 编排器 FedAvg 合并 + 存证/分账
```

## 合约生命周期

### FLOW-MDOP-01 · MDOP 作业（提交 → 编译 → 要约 → 复核 → 凭证 → 执行 → C3 → 合并 → 销毁 → 锚定）

> mdop-kernel：平台按「数据就近」把作业切成**片段**下发，各院用**本地合约副本**做七项复核
> 并签名接受，平台收齐后签发**执行凭证**，各院校验凭证与数据快照后才执行；C3 制品经
> **出节点守卫**投给平台（合约明示的接收方），平台合并后进终态，各院销毁制品并回签名回执，
> 链头锚定上链。作业状态机：`SUBMITTED→COMPILED→NEGOTIATING→TICKETED→RUNNING→RELEASING→SUCCEEDED`→`PURGED`。

```yaml flow
id: FLOW-MDOP-01
name: MDOP 作业：编译 → 凭证协商 → 本地执行 → C3 合并 → 销毁 → 锚定
trigger: 申请方提交逻辑计划（RWS 向导「经 MDOP 执行」或 POST /mdop/jobs/l15）
steps:
  - actor: ts:apps/api/src/mdop/mdop-jobs.service.ts#MdopJobsService
    crosses: consumer→control
    payload: task-spec
    produces: [cp_mdop_job(status=SUBMITTED)]
    consumes: [cp_digital_contract(status=active), cp_mdop_operator]
    note: 逻辑计划只许引用已登记算子；引用未登记算子即拒（不携带可执行代码）
  - actor: ts:apps/api/src/mdop/mdop-jobs.service.ts#MdopJobsService
    crosses: none
    payload: task-spec
    produces: [cp_mdop_stage, cp_mdop_fragment, plan_hash]
    consumes: [各节点能力通告（心跳）, cp_digital_contract]
    note: 数据就近放置 + C0–C3 边校验 + 合约可用性（无持签即 E_CONTRACT_UNSIGNED）
  - actor: ts:apps/api/src/mdop/mdop-ticket.service.ts#MdopTicketService
    crosses: control→connector
    payload: task-spec
    produces: [cp_mdop_ticket(status=OFFERED)]
    consumes: [cp_mdop_fragment, plan_hash]
    note: 只发**本方片段** + 片段哈希表；他院片段内容不出平台
  - actor: ts:apps/connector/src/mdop/mdop-review.ts#MdopReviewService
    crosses: none
    payload: task-spec
    produces: [复核结论（通过 / 带错误码的拒绝）]
    consumes: [local_mdop_contract, local_mdop_operator_whitelist, local_mdop_revocation_state]
    note: 七项复核只用本地输入；本地没有该合约副本即 E_CONTRACT_UNSIGNED；自动确认须由本地策略点名
  - actor: ts:apps/connector/src/mdop/mdop-node.service.ts#MdopNodeService
    crosses: connector→control
    payload: credential
    produces: [cp_mdop_ticket.signatures(holder)]
    consumes: [复核结论]
    note: 用**本院私钥**对「凭证核心 + 数据快照」签名；本院没签过的计划平台也逼不动本院执行
  - actor: ts:apps/api/src/mdop/mdop-ticket.service.ts#MdopTicketService
    crosses: control→connector
    payload: credential
    produces: [cp_mdop_ticket(status=ISSUED), cp_mdop_job(status=TICKETED)]
    consumes: [全部持有方的接受签名]
    note: 任一院拒绝或复核超时 → REJECTED 且**不发任何 StageDispatch**
  - actor: ts:apps/api/src/mdop/mdop-scheduler.service.ts#MdopSchedulerService
    crosses: control→connector
    payload: none
    produces: [连接器侧执行排程]
    consumes: [cp_mdop_ticket(status=ISSUED), cp_mdop_stage]
    note: 幂等键 job:stage:attempt；可重试错误按 30/60/120 秒退避（最多 3 次）
  - actor: ts:apps/connector/src/mdop/operators/wire-l15.ts#L15OperatorWiring
    crosses: connector→local
    payload: raw-local
    produces: [local_mdop_artifact(C0：行级数据、四格表)]
    consumes: [本地数据产品切片, wasm 算子模块, local_mdop_contract(minCell)]
    note: 行级数据永不出节点；四格表也是 C0，只有过闸门后的那份才是 C3
  - actor: ts:apps/connector/src/mdop/mdop-egress.ts#MdopEgressGuard
    crosses: none
    payload: aggregate-only
    produces: [C3 制品 + 句柄]
    consumes: [local_mdop_artifact(C3), local_mdop_contract(recipients)]
    note: 第三道拦截：非 C3 或目标不在合约接收方列表 → 拒绝投递
  - actor: ts:apps/api/src/mdop/mdop-messages.controller.ts#MdopMessagesController
    crosses: connector→control
    payload: aggregate-only
    produces: [cp_mdop_handle, cp_mdop_delivery(C3 载荷)]
    consumes: [C3 制品 + 句柄]
    note: 数据面只收 C3；摘要与已登记句柄不一致即拒；载荷只落平台（合约接收方）
  - actor: ts:apps/api/src/mdop/mdop-merge.service.ts#MdopMergeService
    crosses: none
    payload: aggregate-only
    produces: [平台合并结果（C3 交付物）, cp_mdop_job(status=RELEASING→SUCCEEDED)]
    consumes: [各院 C3 投递]
    note: 收齐才合并；缺任一院即等待重发，不提前出结论
  - actor: ts:apps/api/src/mdop/mdop-purge.service.ts#MdopPurgeService
    crosses: control→connector
    payload: none
    produces: [各院制品销毁]
    consumes: [cp_mdop_job(终态)]
    note: 终态触发；收齐全部回执才进 PURGED（C3 交付物不销毁）
  - actor: ts:apps/connector/src/mdop/mdop-node.service.ts#MdopNodeService
    crosses: connector→control
    payload: evidence-hash
    produces: [local_mdop_receipt(成链), cp_mdop_receipt(kind=purge)]
    consumes: [各院制品销毁事件]
    note: 每事件一条签名回执并与上一条成链；审计回执链头由平台锚定
  - actor: ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#MdopReceiptChainService
    crosses: control→chain
    payload: evidence-hash
    produces: [cp_mdop_receipt(kind=anchor)]
    consumes: [各院回执链头]
    note: 终态时 + 每 30 分钟锚定；链不可达进补偿队列，**不伪造交易号**
dead_edge_check:
  - producer: MdopJobsService.compile → 片段 + plan_hash
    consumer: MdopTicketService.offerTickets 发 PlanFragmentOffer（片段哈希进凭证核心）
  - producer: MdopReviewService 复核结论 → PlanFragmentAccept/Reject
    consumer: MdopTicketService.accept 收齐后签发 ExecutionTicketIssue
  - producer: L15OperatorWiring 的 C3 制品
    consumer: MdopEgressGuard 放行 → 数据面投递 → MdopMergeService 合并
  - producer: MdopPurgeService 的 PurgeOrder
    consumer: MdopNodeService 销毁并回 PurgeReceipt → 作业 PURGED
  - producer: 各院 local_mdop_receipt 链头
    consumer: MdopReceiptChainService 锚定上链（cp_mdop_receipt kind=anchor）
```

### FLOW-MDOP-02 · C2 可信空间节点链路（封存 → 中继 → 证明 → KMS 释放 → 节点内执行 → 只出 C3 → 销毁 → 锚定）

> 与 FLOW-MDOP-01（C0/C3，数据不出域）**并存且互不影响**：这条链把**密文**送出持有方，
> 只在**被证明过的代码**里解密，离开节点仍然只有 C3。**平台是转运方不是接收方**：
> 它拿到的是密文（数据密钥封给节点会话的一次性公钥，平台解不开），不做解封、不做发布审查、
> 不参与密钥释放（D15 / 协议 §9.6）。信任锚换成「CPU 厂商证明根 + 代码度量 + 运营方 + KMS 释放策略」，
> 合规定性是**委托处理/数据出域**——MUST NOT 表述为「数据没有出医院」（TRUST P-CTL-8）。
>
> **状态（2026-09-26）**：链路各步的 enforcement 均已落地并有用例；**放置判定已翻转为「目标节点证明有效」**
> （D-MDOP-6 翻转补注），但**真实硬件证明与真实 KMS 未接**——无硬件则无节点通告 `tee{kind}`，
> 因此本链在任何真实部署里仍不成立，目前只在开发替身下可复跑。

```yaml flow
id: FLOW-MDOP-02
name: C2 可信空间节点链路：封存 → 中继 → 证明与 KMS 释放 → 节点内执行 → 只出 C3 → 销毁 → 锚定
trigger: 合约声明 attestation_policy 且计划里存在 C2 边（编译期按节点证明能力与策略放置）
steps:
  - actor: ts:apps/connector/src/mdop/operators/seal.ts#buildSealedEnvelope
    crosses: connector→local
    payload: raw-local
    produces: [C2 信封（mdop.env/1.0）+ 密文体（本地制品）]
    consumes: [本地数据产品切片, local_mdop_contract(attestation_policy)]
    note: 只封合约声明的那一份切片；AAD 绑作业/凭证/合约；没有 KMS 保管口就拒绝产出信封
  - actor: ts:apps/connector/src/mdop/mdop-node.service.ts#MdopNodeService
    crosses: connector→control
    payload: sealed-envelope
    produces: [cp_mdop_outbox(待中继 C2 信封)]
    consumes: [C2 信封, 复核结论 c2Targets]
    note: 目标是复核结论里点名的 C2 对端（不从消息取、不猜）；目标数 ≠ 1 就不投并留痕
  - actor: ts:apps/api/src/mdop/mdop-messages.controller.ts#MdopMessagesController
    crosses: none
    payload: sealed-envelope
    produces: [cp_mdop_outbox(C2EnvelopeRelay), cp_mdop_delivery(label=C2 审计行)]
    consumes: [C2 信封]
    note: 六项检查（签名/合约声明策略/AAD/密文摘要/目标为片段节点/未过期）；只转运不解密，审计不存密文
  - actor: ts:apps/connector/src/tee-node/poller.ts#pollNodeMessages
    crosses: control→node
    payload: sealed-envelope
    produces: [节点侧待处理中继]
    consumes: [cp_mdop_outbox(C2EnvelopeRelay)]
    note: 平台公钥来自部署配置；逐 msg_id 去重；验不过的消息不处理但逐条留痕
  - actor: ts:apps/connector/src/mdop/node/entry-guard.ts#TrustedNodeEntryGuard
    crosses: none
    payload: sealed-envelope
    produces: [通过入口守卫的信封（仍是密文）]
    consumes: [C2 信封, local_mdop_contract]
    note: 解密**之前**逐项核对：结构/AAD 绑定/出口形态/本节点链型/策略覆盖/有效期/持有方签名
  - actor: ts:packages/mdop/src/attestation/release.ts#evaluateKeyRelease
    crosses: node→kms
    payload: none
    produces: [KMS 释放凭据（含封给本次一次性公钥的数据密钥）]
    consumes: [本次证明报告, 执行凭证, 信封 key_id, 合约状态]
    note: 判据只有一份；逐项 fail-closed，任何一条不过即拒绝且不回退；KMS 由持有方自建或共管（D-TEE-1）
  - actor: ts:apps/connector/src/mdop/node/node-session.ts#TrustedNodeSession
    crosses: none
    payload: raw-local
    produces: [节点内中间制品（明细，永不出节点）]
    consumes: [解封后的投影, 算子清单, local_mdop_contract(minCell)]
    note: 解封用一次性私钥；明细只在节点内存/临时盘；等级由输入推出，C0/C1 不得进发布审查
  - actor: ts:apps/connector/src/mdop/node/publication-review.ts#NodePublicationReview
    crosses: none
    payload: aggregate-only
    produces: [过闸门后的 C3 候选]
    consumes: [节点内中间制品]
    note: 小单元格抑制与二次抑制在节点内由被测代码强制；抑制明细只进节点本地审查记录与回执
  - actor: ts:apps/connector/src/tee-node/wasm-runner.ts#createNodeWasmRunner
    crosses: none
    payload: raw-local
    produces: [配对结果（聚合量，节点内）]
    consumes: [解封后的投影, 注册中心签发的配对模块, 阶段入边绑定的 parties]
    note: 数字列 ABI（宿主判定调用形状）；对齐与分层留在宿主，键文本与分层映射不进模块；不回退内置实现
  - actor: ts:apps/connector/src/mdop/node/node-exit.ts#NodeExitGuard
    crosses: none
    payload: aggregate-only
    produces: [C3 制品（节点本地登记）]
    consumes: [过闸门后的 C3 候选, local_mdop_contract(recipients)]
    note: 出口只放 C3；C1/C2 一律不得离开节点；C0 只许回原持有方并记告警
  - actor: ts:apps/connector/src/tee-node/relay-receive.ts#receiveRelayedEnvelope
    crosses: node→control
    payload: aggregate-only
    produces: [cp_mdop_handle(C3), cp_mdop_delivery(C3 载荷)]
    consumes: [C3 制品]
    note: 用**节点自己的身份密钥**登记句柄并投递载荷；平台是合约明示的 C3 接收方
  - actor: ts:apps/connector/src/tee-node/witness-report.ts#reportWitness
    crosses: node→control
    payload: credential
    produces: [cp_mdop_attestation(会话见证本体)]
    consumes: [本次证明报告, KMS 释放凭据]
    note: 见证按每个 key_id 一条上报；平台验签后原样转发给持有方（平台不下结论，D14）
  - actor: ts:apps/connector/src/mdop/node/node-receipts.ts#NodeReceiptChain
    crosses: node→control
    payload: evidence-hash
    produces: [节点回执链（解封/执行/出口/销毁）]
    consumes: [节点内四类事件]
    note: 每事件一条节点自签回执并成链；链头供平台锚定
  - actor: ts:apps/connector/src/tee-node/stage-status.ts#reportNodeStageStatus
    crosses: node→control
    payload: none
    produces: [cp_mdop_outbox(StageStatus)]
    consumes: [阶段执行结果]
    note: 成功带摘要与等级、失败带错误码；平台据此推进下游并按错误码重试（形状与持有方同口径）
  - actor: ts:apps/connector/src/tee-node/fragment-review.ts#reviewFragmentForNode
    crosses: none
    payload: none
    produces: [本节点片段复核结论（接受快照 / 带错误码的拒绝）]
    consumes: [要约片段, local_mdop_contract, 本地算子白名单, 本节点能力通告]
    note: 九项本地复核；跨节点输入按边界边解析等级；C2 边必须指向本节点且凭证期望须与本节点实际能力相符
  - actor: ts:apps/connector/src/tee-node/node-messages.ts#NodeMessageRouter
    crosses: node→control
    payload: none
    produces: [cp_mdop_outbox(PlanFragmentAccept), cp_mdop_outbox(PurgeReceipt)]
    consumes: [PlanFragmentOffer, ExecutionTicketIssue, PurgeOrder, C2 信封, 阶段派发指令]
    note: 节点的消息状态机；信封与派发两个来源做会合（先到的一方只登记、不误报失败），销毁回执幂等
  - actor: ts:apps/connector/src/tee-node/node-messages.ts#bindRelayToStage
    crosses: none
    payload: sealed-envelope
    produces: [绑定到阶段输入的 C2 信封]
    consumes: [C2 信封, 已复核片段里的 C2 入边]
    note: 目标阶段从**片段入边**取（不从消息猜）；同一持有方两条入边即拒（无法唯一绑定）
  - actor: ts:apps/connector/src/tee-node/runtime.ts#TrustedNodeRuntime
    crosses: node→control
    payload: none
    produces: [cp_mdop_outbox(StageStatus), cp_mdop_outbox(PurgeReceipt), 心跳与证明探针]
    consumes: [平台下发的五类消息, 算子清单, 吊销名单]
    note: 长驻循环：先应用清单与吊销再处置消息；心跳/探针到点才发；轮询失败退避重试、不退进程
  - actor: ts:apps/api/src/mdop/mdop-purge.service.ts#MdopPurgeService
    crosses: control→node
    payload: none
    produces: [节点侧制品销毁]
    consumes: [cp_mdop_job(终态)]
    note: 收齐含该节点在内的全部回执才进 PURGED
  - actor: ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#MdopReceiptChainService
    crosses: control→chain
    payload: evidence-hash
    produces: [cp_mdop_receipt(kind=anchor)]
    consumes: [节点回执链头]
    note: 链不可达进补偿队列，不伪造交易号
dead_edge_check:
  - producer: buildSealedEnvelope 的 C2 信封
    consumer: MdopNodeService 中继提交 → MdopMessagesController 转发 → pollNodeMessages 取回 → TrustedNodeEntryGuard 核对
  - producer: evaluateKeyRelease 的释放凭据
    consumer: TrustedNodeSession 解封数据密钥 → 会话见证留痕（verifyReleaseWarrant 复算）
  - producer: NodePublicationReview 过闸门的 C3
    consumer: NodeExitGuard 放行 → receiveRelayedEnvelope 投递 → 平台合并/交付
  - producer: NodeReceiptChain 链头
    consumer: MdopReceiptChainService 锚定上链
  - producer: dispatchNodeStage 的阶段结果
    consumer: reportNodeStageStatus 上报 → MdopSchedulerService.onStageStatus 推进下游 / 退避重试
  - producer: reviewFragmentForNode 的接受快照
    consumer: NodeMessageRouter 签名接受 → MdopTicketService.accept 收齐全部片段签名后签发凭证
  - producer: NodeMessageRouter 的 PurgeReceipt
    consumer: MdopPurgeService.onPurgeReceipt 收齐回执 → 作业进入 PURGED
```

### FLOW-MDOP-03 · 服务计算长周期语料托管与分步执行链路

> 服务计算（Service Computing）链路：数据提供方在数字合约周期内托管 C2 密封语料，
> 消费方按合约声明的服务协议标准（`service_protocol`）发起多次分步流水线查询。
> 密文驻留在 TEE 节点磁盘，数据密钥由 KMS 逐会话释放入内存，用完即销毁。
> 算子执行轨迹逐步记录为状态转移并聚合为 Merkle 树，由节点签名出具见证凭单。

```yaml flow
id: FLOW-MDOP-03
name: 服务计算长周期语料托管与多次分步查询链路：语料密封存盘 → 服务协议校验 → 会话临时解封 → 分步管道执行 → 执行轨迹见证 → 合约终态销毁
trigger: 合约声明 service_protocol 且存在托管语料（长生命周期服务计算作业）
steps:
  - actor: ts:apps/connector/src/mdop/node/corpus-store.ts#CorpusStore
    crosses: none
    payload: sealed-envelope
    produces: [corpus_handle, CorpusArtifactRecord]
    consumes: [C2 信封, local_mdop_contract]
    note: 密态存盘于 TEE 节点本地，以 corpus://<contractId>/<corpusId> 索引，不随单次作业清理
  - actor: ts:apps/connector/src/mdop/node/budget-ledger.ts#NodeQueryBudgetLedger
    crosses: none
    payload: prompt-text
    produces: [预算断言通过]
    consumes: [ServiceBudgetPolicy, 查询参数]
    note: 四道关口先判（熔断状态/总调用量/总 ε/小时速率），超限即拒且不扣减
  - actor: ts:apps/connector/src/mdop/node/pipeline-executor.ts#ServicePipelineExecutor
    crosses: none
    payload: raw-local
    produces: [C0_internal 中间态, C3 交付物, ExecutionTraceStep]
    consumes: [解封明文语料, PipelineStageQuery, ServiceProtocolSpec]
    note: 严格对拍拓扑、白名单算子及参数空间白名单；中间产物打 C0_internal 标签且仅在飞地内存驻留
  - actor: ts:packages/mdop/src/provenance/execution-trace.ts#generateTraceWitness
    crosses: none
    payload: aggregate-only
    produces: [ExecutionTraceWitness, trace_root]
    consumes: [ExecutionTraceStep, 节点私钥]
    note: 生成 Merkle 树根并由节点私钥签名，实现交付即验证
  - actor: ts:apps/connector/src/mdop/node/corpus-store.ts#CorpusStore
    crosses: none
    payload: prompt-text
    produces: [CorpusPurgedReceipt]
    consumes: [PurgeCorpusOrder]
    note: 合约终止或到期时物理擦除密文信封与账本，返回防篡改签名回执
dead_edge_check:
  - producer: CorpusStore 的 CorpusArtifactRecord
    consumer: ServicePipelineExecutor 加载密文语料并在内存中分步执行
  - producer: NodeQueryBudgetLedger 的预算断言通过
    consumer: ServicePipelineExecutor 执行查询前断言与事后扣减
  - producer: ServicePipelineExecutor 的 ExecutionTraceStep
    consumer: generateTraceWitness 聚合计算 Merkle 树根并签名见证
  - producer: generateTraceWitness 的 ExecutionTraceWitness
    consumer: 平台与消费方查验执行轨迹防篡改见证
  - producer: CorpusStore 的 CorpusPurgedReceipt
    consumer: 平台与持有方核验语料终态物理销毁
```

### FLOW-DC-01 · 数字合约签署与撤销

```yaml flow
id: FLOW-DC-01
name: 数字合约生成 → 生效 → 撤销补偿（fail-closed）
trigger: 缔约（consumer 申请 + provider 确认）或任一方 revoke
steps:
  - actor: ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService
    crosses: consumer→control
    payload: policy
    produces: [cp_digital_contract(status=active), SM3 合约哈希]
    consumes: [cp_data_product, cp_participant(双方)]
    note: 生成即算哈希（INV-DC-01）
  - actor: ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService
    crosses: control→chain
    payload: evidence-hash
    produces: [cp_attestation_ref(kind=policy)]
    consumes: [SM3 合约哈希]
  - actor: ts:apps/api/src/runtime/rws-orchestrator/connector-pull.controller.ts#ConnectorPullController
    crosses: control→connector
    payload: policy
    produces: [连接器侧合约视图（PEP 依据）]
    consumes: [cp_digital_contract]
    note: 随 assignment 快照下发；连接器 ContractView + PEP 消费
  - actor: ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService
    crosses: none
    payload: policy
    produces: [cp_digital_contract(status=revoked), 撤销事件]
    consumes: [cp_digital_contract(status=active)]
    note: revoke 立即生效，无"完成当前批"宽限（D-DC-1）
  - actor: ts:apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts#RwsOrchestratorService
    crosses: control→connector
    payload: policy
    produces: [COMPENSATE 指令, cp_rws_assignment(status=failed), cp_rws_task(status=partial|failed)]
    consumes: [撤销事件]
    note: 全 party 被撤→failed；部分→partial 出剩余院结果（INV-RWS-01）
dead_edge_check:
  - producer: ContractService.revoke → 撤销事件
    consumer: 编排器注入 COMPENSATE + 连接器 PEP 下一次校验即拒（INV-PEP-01）
  - producer: 合约哈希
    consumer: 链上存证 kind=policy
```

### FLOW-CMP-01 · 合规预审 → 合约申请绑定 → 任务准入复核

```yaml flow
id: FLOW-CMP-01
name: 合规预审绑定合约 + 任务准入复核（D-CMP-2，fail-closed）
trigger: 药企创建预审 → 申请合约 → 医院签发 → 创建 RWS/FL/SecretFlow 任务准入
steps:
  - actor: ts:apps/api/src/capability/l2-compliance/compliance.service.ts#ComplianceService
    crosses: consumer→control
    payload: policy
    produces: [composition(owner=药企), compliance_evaluation]
    consumes: [能力注册表对象(须 active), L2 规则]
    note: createComposition 校验对象已落地；evaluate 事实优先裁决 + 记录来源/冲突（design D3）
  - actor: ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService
    crosses: consumer→control
    payload: policy
    produces: [cp_digital_contract(status=draft, preReview 快照)]
    consumes: [composition, compliance_evaluation, cp_data_product]
    note: request 必须带 compositionId + 校验归属；按当前规则 + 推导维度(数据敏感度)重裁决；驳回则拒
  - actor: ts:apps/api/src/runtime/digital-contract/contract.service.ts#ContractService
    crosses: participant→control
    payload: policy
    produces: [cp_digital_contract(status=active, preReviewAck?), SM3 合约哈希(含预审快照)]
    consumes: [cp_digital_contract(draft)]
    note: approveDraft；快照为需审批时医院须显式确认并填理由，确认计入哈希（D-CMP-2）
  - actor: ts:apps/api/src/capability/l2-compliance/pre-review-gate.ts#PreReviewGate
    crosses: none
    payload: policy
    produces: [任务准入决定(放行/拒绝)]
    consumes: [cp_digital_contract.preReview, composition, L2 规则(当前)]
    note: RWS/FL/SecretFlow 三处 admit 统一复核——快照存在 + 范围(L3∪L4 覆盖分析类型) + 按任务层参与机构数复评；规则收紧立即生效；block 拒、manual_review 须合约有医院确认
dead_edge_check:
  - producer: ComplianceService.evaluate → 裁决快照
    consumer: request 写入合约草稿 + PreReviewGate 任务准入复核消费
  - producer: 合约哈希(含预审快照)
    consumer: 链上存证 kind=policy（FLOW-DC-01）
```

## 参与方准入

### FLOW-ID-01 · 注册 → 双认证 → 领证 → 通道

```yaml flow
id: FLOW-ID-01
name: 参与方准入与 SM2 证书生命周期
trigger: 新参与方（医院/药企）申请接入
steps:
  - actor: ts:apps/api/src/runtime/participant-identity/participant-registry.service.ts#ParticipantRegistryService
    crosses: participant→control
    payload: credential
    produces: [cp_participant(subjectVerified/dataVerified)]
    consumes: [主体材料/数据资源材料]
    note: 双认证齐备才可过准入门（INV-ID-01）
  - actor: ts:apps/api/src/runtime/participant-identity/ca.service.ts#CaService
    crosses: control→participant
    payload: credential
    produces: [cp_certificate(SM2 指纹), cp_connector_registry]
    consumes: [cp_participant, cp_ca_keypair]
    note: CA 根密钥按 spaceId 持久化，重启不重生（否则已发证书全失效）
  - actor: ts:apps/api/src/runtime/participant-identity/secure-channel.service.ts#SecureChannelService
    crosses: connector→control
    payload: credential
    produces: [安全通道会话（SM2 加密 + SM3 完整性 + 签名）]
    consumes: [cp_certificate(validUntil, revoked=false)]
    note: 吊销拉模式（D-ID-1）；revoked 下一次校验即拒（INV-CERT-01）
dead_edge_check:
  - producer: CaService 签发证书
    consumer: SecureChannelService 通道校验 + 连接器出示
  - producer: 证书吊销（revoked=true）
    consumer: 下一次通道建立被拒（INV-CERT-01）
```

## 结算

### FLOW-SETTLE-01 · 按贡献分账与上链

```yaml flow
id: FLOW-SETTLE-01
name: 任务完成 → cohortSize 计量 → 台账 → 上链
trigger: RWS/FL 任务出域完成（出域后旁路义务，异步 fail-open，D-UC-2）
steps:
  - actor: ts:apps/api/src/runtime/settlement/settlement.service.ts#SettlementService
    crosses: none
    payload: aggregate-only
    produces: [各院 contribution（=cohortSize）]
    consumes: [cp_rws_task.merged, cp_rws_assignment.aggregate]
    note: 贡献由编排器产出，consumer 不可自报（D-VS-1 / INV-SETTLE-01）
  - actor: ts:apps/api/src/runtime/settlement/settlement.service.ts#SettlementService
    crosses: none
    payload: none
    produces: [cp_settlement_record + cp_settlement_line(amount=total×占比), 台账哈希]
    consumes: [各院 contribution, cp_digital_contract(pricing)]
    note: append-only，更正用新条目
  - actor: ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService
    crosses: control→chain
    payload: evidence-hash
    produces: [链上台账哈希（taskRef 锚定任务存证）]
    consumes: [台账哈希]
dead_edge_check:
  - producer: 任务 merged（FLOW-RWS-01..04 产出）
    consumer: SettlementService 计量贡献
  - producer: 台账哈希
    consumer: 上链存证（失败入补偿队列，不反向阻断已出域结果）
```

## 跨空间互认

### FLOW-FED-01 · 信任清单与目录联邦

```yaml flow
id: FLOW-FED-01
name: 跨空间 CA 互认 + 远端目录只读缓存
trigger: 运营方登记可信空间 / 定期目录同步
steps:
  - actor: ts:apps/api/src/runtime/federation/federation.service.ts#FederationService
    crosses: participant→control
    payload: credential
    produces: [cp_federation_trust(spaceId, caPublicKey)]
    consumes: [对方空间 CA 公钥]
    note: 静态清单 + 拉模式吊销（D-ID-1 / D11）
  - actor: ts:apps/api/src/runtime/federation/federation.service.ts#FederationService
    crosses: cross-space
    payload: catalog-meta
    produces: [cp_remote_catalog(只读缓存)]
    consumes: [对方空间目录（urn:tds:<space>:<product>）]
    note: 只读元数据；跨空间任务计算仍在源连接器本地（D11）
dead_edge_check:
  - producer: 信任清单登记
    consumer: 跨空间证书校验 + 远端目录拉取
  - producer: 远端目录缓存
    consumer: 本空间 consumer 浏览/发起跨空间任务
```

## RBQM 中心化监查

### FLOW-RBQM-01 · 站点 KRI 聚合 → QTL 越限 → 存证

```yaml flow
id: FLOW-RBQM-01
name: 站点级 KRI 聚合回传与 QTL 越限检测存证
trigger: 周期性质量监查（连接器在院内计算站点 KRI；本期演示以控制面幂等种子驱动）
steps:
  - actor: ts:apps/connector/src/domain/kri-aggregator.ts#aggregateKri
    crosses: connector→local
    payload: raw-local
    produces: [站点级聚合三元组(numerator/denominator/value)]
    consumes: [local_record]
    note: |
      在院内读本地脱敏明细算聚合，唯一接触 raw-local 的一步（RAW_OK）。
      分母 < 小格抑制硬底 5 → 整条抑制（suppressed，计数清零），不出精确值。
  - actor: ts:apps/api/src/runtime/rbqm/rbqm.service.ts#RbqmService
    crosses: connector→control
    payload: aggregate-only
    produces: [cp_kri_observation]
    consumes: [cp_kri_definition]
    note: 仅聚合三元组 + 元数据（站点/周期/KRI code）出域；红线 raw-local 不跨此边。
  - actor: ts:apps/api/src/runtime/rbqm/rbqm.service.ts#RbqmService
    crosses: none
    payload: none
    produces: [cp_qtl_breach(status=open)]
    consumes: [cp_kri_definition, cp_kri_observation]
    note: 按 direction × 分层阈值判定，命中最严重层级（critical>warning）才记录；未越限不产生记录。
  - actor: ts:apps/api/src/runtime/digital-contract/attestation.service.ts#AttestationService
    crosses: control→chain
    payload: evidence-hash
    produces: [越限证据 SM3 上链回执(txHash/block)]
    consumes: [cp_qtl_breach]
    note: 链不可达降级 0xLOCAL 本地回执，不阻断越限记录（与合约存证同）。
dead_edge_check:
  - producer: 站点级聚合观测（cp_kri_observation）
    consumer: RbqmService 越限判定 + 监查台站点×KRI 矩阵
  - producer: QTL 越限记录（cp_qtl_breach）
    consumer: 监查台越限清单 + 合规告警流
  - producer: 越限存证回执（txHash/block）
    consumer: cp_qtl_breach.attestationTxHash（可追溯，不反向阻断已记录越限）
```

## 院内数据源接入

### FLOW-DS-01 · CDM 数据源接入校验 → 覆盖元数据上报 → 目录登记

```yaml flow
id: FLOW-DS-01
name: 院内 OMOP CDM 数据源接入（视图层 + 双权限域）与覆盖元数据上报
trigger: 连接器启动与周期复核（CONNECTOR_CDM_REVERIFY_MS）；医院 DBA 变更视图层授权
steps:
  - actor: ts:apps/connector/src/domain/data-source/cdm-access-gate.ts#CdmAccessGate
    crosses: connector→local
    payload: catalog-meta
    produces: [local_data_source_status, local_audit_log(data-source-verified/rejected)]
    consumes: [CONNECTOR_CDM_SOURCES（只含 passwordEnv 引用）, 医院视图层 + 双权限域账号]
    note: 只做权限自省与元数据读取（唯一写操作是 results 里建即删的探针表）；按六个权限域 fail-closed（D-CN-7 / INV-DS-02）
  - actor: ts:apps/connector/src/domain/data-source/cdm-coverage.ts#computeCdmCoverage
    crosses: connector→local
    payload: aggregate-only
    produces: [覆盖统计（表数量级 + 月粒度观察期）]
    consumes: [CDM 视图（count / min / max）]
    note: 精确行数与日粒度日期不离开这一步
  - actor: ts:apps/connector/src/domain/control-plane-client.ts#ControlPlaneClient
    crosses: connector→control
    payload: catalog-meta
    produces: [覆盖上报报文（版本 + 统计量；校验未过只有一个布尔）]
    consumes: [覆盖统计, 接入校验结论]
    note: 发前用与控制面同一个白名单校验器自检（validateCoverageReport）；证书签名覆盖请求体 SM3
  - actor: ts:apps/api/src/runtime/catalog/catalog.service.ts#CatalogService
    crosses: none
    payload: catalog-meta
    produces: [cp_data_product.coverage(stale/staleReason)]
    consumes: [覆盖上报报文, cp_data_product.fhirSchema.dataSource]
    note: 只挂到认证出来的机构自己声明了该 label 的在架产品上；版本变化未跟上统计 / 校验未过 → 标待刷新（INV-CAT-02）
  - actor: ts:apps/connector/src/domain/data-source/cdm-projection.ts#projectDisproportionalityFromCdm
    crosses: connector→local
    payload: raw-local
    produces: [投影载荷（与文件路径同一构造器）]
    consumes: [CDM 视图（列裁剪 + 行过滤下推进 SQL）]
    note: 机制已交付并与文件路径逐字节对拍；**本版不接生产派发**——CDM 类型数据产品派发一律拒绝、不读文件（omop-data-source-access D8，INV-DS-03）
dead_edge_check:
  - producer: CdmAccessGate 校验结论（local_data_source_status）
    consumer: CdmDataSourceRegistry.requireAvailable（未过即抛，任务失败，不改用文件数据）
  - producer: 覆盖上报报文
    consumer: CatalogService.applyCoverageReport → 目录 CdmCoverageSummary 呈现（含新鲜度）
  - producer: 医院 DBA REVOKE 视图 / results 权限
    consumer: 下一条查询即被数据库拒绝 + 周期复核判不可用 + 目录标待刷新（无需平台配合）
```

## AI 助手链（AI Agent 层的唯一在册流程）

> 愿景图的「AI Agent 层」列了 11 类智能体，**本仓当前只有 1 个真实实现**
> （任务设计助手）。本节只登记已存在且可守护的那条边；其余智能体属愿景，
> 见 ARCHITECTURE §11 边界表。新增任何调用外部 AI 供应商的 agent，
> 必须在此登记 flow 并通过 `control→external` 红线。

```yaml flow
id: FLOW-AI-01
name: 自然语言任务设计助手（SecretFlow spec 草稿生成）
trigger: 研究者在控制台用自然语言描述研究意图
steps:
  - actor: ts:apps/api/src/secretflow-assistant/secretflow-assistant.controller.ts
    crosses: consumer→control
    payload: prompt-text
    produces: [研究意图描述文本, 声明目的]
    consumes: []
    note: 用户自由文本;控制面不附加任何数据产品内容或患者衍生数据
  - actor: ts:apps/api/src/secretflow-assistant/secretflow-assistant.service.ts
    crosses: control→external
    payload: prompt-text
    produces: [送 DeepSeek 的 system + user prompt]
    consumes: [研究意图描述文本]
    note: >-
      出信任边界(D-AI-1)。红线:仅 prompt-text 可过;MUST NOT 附带 raw-local /
      aggregate-only / 目录真实 schema。当前 prompt 含参与方机构名与研究意图,
      属组织级敏感信息,分级见 TRUST CTL-11
  - actor: ts:apps/api/src/secretflow-assistant/secretflow-spec.schema.ts
    crosses: none
    payload: task-spec
    produces: [SecretFlowTaskSpec 草稿, assumptions, warnings]
    consumes: [LLM 返回文本]
    note: >-
      LLM 输出经 schema 校验后才成为草稿;草稿仅供人工审阅,
      MUST NOT 直接冻结为研究方案(EVIDENCE P-EVD-10)
dead_edge_check:
  - producer: 用户自然语言描述
    consumer: 助手服务构造 prompt 并出域
  - producer: LLM 返回文本
    consumer: schema 校验产出 spec 草稿
  - producer: spec 草稿 + assumptions/warnings
    consumer: 人工审阅后提交为正式任务（FLOW-RWS-01..05 入口）
```

## 附录：格式契约

check-meta-docs.mjs 按以下契约解析本文件：

1. **flow 块**：围栏 info-string 恰为 `yaml flow`。字段 `id`（唯一，`FLOW-<AREA>-<NN>`）、
   `name`、`trigger`、`steps[]`、`dead_edge_check[]`。
2. **step 字段**：`actor`（token 语法同 DOMAIN 附录：`ts:路径#符号` / `py:路径` / `ui:` / `ext:`）、
   `crosses`（枚举见「跨域边与数据分级」）、`payload`（枚举同表）、`produces`、`consumes`、
   可选 `note`。
3. **红线**：`payload: raw-local` ⇒ `crosses ∈ {none, connector→local}`，违反 = ERR。
4. **dead_edge_check**：每条 `- producer:` 必须配对一条 `consumer:`；至少一对。
5. 新增 crosses / payload 枚举值须同步本文件约定表与 checker 的 `CROSSES` / `PAYLOADS`。
6. 解析空转兜底（MS-8）：未解析出任何 `yaml flow` 块，或任一 flow 块的 steps 解析为 0 行 = 格式契约破坏 = 红（防"块被改成散文后静默通过"）。
