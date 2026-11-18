## ADDED Requirements

### Requirement: L1.5 生产与本地接线应用协议队列与缺失声明
生产 MDOP L1.5 接线（`wire-l15.ts`）与本地 L1.5 接线（`local-l15-wiring.ts`）SHALL 共用同一准备流程，在投影进入沙箱前依次校验并应用计划阶段参数中的 `cohortDefinition`（未知规则文法 MUST fail-closed 报错）与 `missingnessDeclaration`。

#### Scenario: 生产接线执行队列纳入排除规则
- **WHEN** 阶段参数包含 `cohortDefinition: { inclusion: ["age>=18"], exclusion: ["pregnancy"] }` 且输入含未成年或妊娠患者
- **THEN** 生产接线在调用 `projectDisproportionality` 前过滤掉不符合队列的记录，队列规模与本地接线一致

#### Scenario: 生产接线拒绝不支持的队列规则
- **WHEN** `cohortDefinition` 含有闭集文法之外的规则表达式
- **THEN** 接线在投影前抛出明确错误，MUST NOT 静默跳过规则或放行全部人群

### Requirement: L1.5 模板入口强制研究设计协议校验
医疗行业包 L1.5 模板（`buildL15Plan` / `/mdop/jobs/l15`）SHALL 强制要求声明合法的流行病学设计类型 `designType` 与非空选型理由 `rationale`，并对可选的 `missingnessDeclaration`、`cohortDefinition` 与 `temporalWindow` 执行结构校验，非法输入 MUST 抛出 `PlanInputError` 并映射为 HTTP 400。

#### Scenario: 缺少 designType 或 rationale 时拒绝提交
- **WHEN** 调用方提交 L1.5 作业但未提供 `designType` 或 `rationale` 为空
- **THEN** 模板校验抛出 `PlanInputError`，HTTP 接口返回 400 且提示缺失研究设计声明

#### Scenario: 完整协议参数穿透至算子阶段
- **WHEN** 调用方提交含 `designType`、`rationale`、`cohortDefinition`、`missingnessDeclaration` 与 `temporalWindow` 的 L1.5 请求
- **THEN** 计划生成成功且 `rws.disproportionality@1.0.0` 阶段 `params` 完整保留这些声明

### Requirement: 药物暴露与不良反应时间先后窗与去重（兼容无日期）
宿主在 `projectDisproportionality` 构造最小投影时 SHALL 对同一受试者内的重复事件词条去重；当记录包含用药起始日期与事件发病日期时 SHALL 过滤掉用药前发生的事件并应用可选风险时间窗；当记录缺少日期字段时默认 SHALL 允许回退为无日期共现并在投影元数据标注 `temporalMode: "undated-cooccurrence"`（仅在 `requireTemporalOrder: true` 时拒绝无日期记录）。

#### Scenario: 用药前发生的不良事件不计入暴露阳性
- **WHEN** 受试者药物暴露 `startDate` 为 `2026-05-10` 而不良事件 `onsetDate` 为 `2026-05-01`
- **THEN** 该事件 MUST NOT 计入暴露期事件桶 `a`，`temporalMode` 为 `"drug-before-event"`

#### Scenario: 允许无日期存量记录并诚实标注
- **WHEN** 输入记录的用药和不良事件未携带日期且未开启 `requireTemporalOrder`
- **THEN** 投影正常完成并返回计数，同时 `temporalMode` 标注为 `"undated-cooccurrence"`

#### Scenario: 同患者重复记录同一不良事件去重
- **WHEN** 同一患者在 `adverseEvents` 中出现多次相同 `term`
- **THEN** 该患者在对应词条四格表中至多贡献 1 人次

### Requirement: 跨院小单元格抑制状态传播与有效分母披露
平台侧 `mergeDisproportionalityAggregates` SHALL 聚合各院 `suppressed` 状态，在不还原节点清零格值的前提下输出 `suppressed`、`partialSuppression`、`suppressedSites`、`effectiveSites`、`totalSites` 与 `effectiveCohortSize`；当全部站点都被抑制时 MUST 置 `signal = false` 且不得通过 `+0.5` 校正算出虚假统计比值。

#### Scenario: 部分医院因小单元格被抑制
- **WHEN** 2 家医院参与合并，其中 A 院某结局因 `a < minCell` 交付 `suppressed: true`（格值全 0），B 院交付 `a=10, b=40, c=5, d=445`
- **THEN** 合并该结局标注 `partialSuppression: true`、`suppressedSites: 1`、`effectiveSites: 1`、`effectiveCohortSize: 500`、`suppressed: false`

#### Scenario: 全部医院均抑制同一结局
- **WHEN** 所有参与医院对该结局均交付 `suppressed: true`
- **THEN** 合并该结局标注 `suppressed: true`、`signal: false`、`signalBcpnn: false` 且统计比值为 `null`

### Requirement: BCPNN 信息成分可信区间与双判据信号计算
L1.5 统计分析（`disproportionality.ts`）SHALL 在保留 Evans 主判据（`signal`）的同时，计算 WHO-UMC BCPNN 收缩后验的 95% 可信区间下界 `ic025`、上界 `ic975` 与 `signalBcpnn`（`ic025 > 0 && a >= 1`），且 `c3-facts` 白名单 MUST 接纳这些统计量与抑制披露字段。

#### Scenario: 极小样本下点估计 IC 与下界 IC025 区分
- **WHEN** 四格表计数极小（例如 `a=1` 且略高于期望）使点估计 `ic > 0`
- **THEN** 输出精确计算的 `ic025`（此时可为负值），`signalBcpnn` 为 `false`，避免点估计假阳性

### Requirement: 描述性器官系统计数与药物别名及默认词典容错
`rws.adverse-event-signal` 模板与节点 `seal` 算子（通过通用参数机制，基座不得硬编码医学词汇）SHALL 支持不区分大小写的药物别名过滤；使用默认器官系统词典时 SHALL 将常见变体映射至标准桶或兜底至 `"全身性及其他"`，而显式自定义 `categoryKeys` 时仍 MUST fail-closed。

#### Scenario: 别名药物过滤命中不同大小写制剂
- **WHEN** 提交 `adverse-event-signal` 传入 `drug: "insulin"`，患者 `medications` 包含 `"Insulin Glargine"`
- **THEN** 节点正确保留该患者并对其器官系统计数

#### Scenario: 默认词典下常见中文器官系统别名不再误拒
- **WHEN** 使用默认器官系统词典且患者事件标注为 `"消化系统"` 或 `"血液系统"`
- **THEN** 封存投影分别映射归类到 `"胃肠系统"` 与 `"血液及淋巴系统"`，不触发分类下标越界失败
