# PACK-FLOWS-med.md — 医疗包流程册

> **分册规则（D-SPD-1 / P11.4）**：基座流程在 [FLOWS.md](FLOWS.md)，行业专属流程在本册。
> 判定规则与红线（crosses × payload，raw-local 禁跨域边，C2 信封只走允许边）由
> `scripts/check-meta-docs.mjs` **跨册并集**校验：flow id 在两册间必须唯一。
> 医疗包的证据与合规契约见 [EVIDENCE.md](EVIDENCE.md) / [REGULATORY.md](REGULATORY.md)。

## 医疗包流程（RWS / RBQM / 数据源）
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
