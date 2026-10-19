# 单臂试验真实世界外部对照注册研究 Implementation Plan

> 状态：ENGINEERING IMPLEMENTED（2026-10-17）
>
> 已落地：固定输入与摘要校验的 Synthea 注册研究生成器、互斥三方合成夹具/答案键/质量报告、独立 `rws.external-control-registration@1.0.0` TS 参考与 WASM 对拍、IPTW-ATT 节点沙箱及 fail-closed 诊断、注册研究模板与严格 DSL profile、专属设计页与 API 入口、编排台账、ContractBundle 逐源绑定、C3 收集、结果解读、作业详情诊断、证据清单，以及不依赖 TS/WASM 的第二套 Python 统计复核。
>
> 模拟研究文件包已补齐虚构产品/适应症、P0、方案、SAP、队列充分性、数据源适用性、监管沟通草案、独立统计复核和证据索引（见 `docs/superpowers/registration-eca-simulation/`）。仍未完成且不能由工程默认值代替的是**真实研究**的产品/适应症、P0 临床与注册决策、正式 SAP/伦理/数据协议、真实数据接入、实际监管沟通和独立注册统计师的盲态人工复核。上述未完成前只能用于合成数据方法学演练。
>
> 适用对象：MedTrust 单臂外部对照注册研究能力建设、Synthea 合成场景、MDOP 算子与证据链实现。
>
> 核心边界：本计划中的 Synthea 数据只用于平台验证、方法学回归和统计程序对拍。合成数据不得作为真实注册研究的主证据，也不得用来宣称任何药品或器械的疗效、安全性。

## Goal

建立一套可复现、可审计、接近注册研究要求的单臂试验外部对照流程：

1. 由研究团队先确定真实产品、适应症、自然史、目标试验和 estimand。
2. 用 Synthea 生成足够规模、结构合理的合成人群。
3. 在合成人群上注入明确的治疗策略、混杂结构、结局、缺失和删失，形成可对拍的答案键。
4. 在可信空间节点内完成队列构建、混杂调整、效应估计、诊断和发布审查。
5. 平台只输出预先声明的聚合结果、诊断统计和证据材料。
6. 通过方法学验收后，再以合规方式替换为真实医院数据。

## Architecture

```text
真实研究方案与 SAP
  → 研究配置 JSON / MDOP Plan DSL
  → 各数据源本地投影
  → C2 封存与中继
  → 可信空间节点内：
       目标人群构建
       time zero 对齐
       倾向评分 / IPTW-ATT
       效应估计
       balance / overlap / missingness 诊断
       敏感性分析
  → 发布审查
  → C3 聚合结果
  → 证据包与监管审阅材料
```

系统继续使用 MedTrust 的数字合约、ContractBundle、MDOP、PEP、TEE 证明、输出闸门、销毁回执和审计存证。研究设计与统计分析不交给 LLM 直接生成，LLM 只能产出一份供人类确认的草稿。

## Regulatory Basis

设计至少对齐以下公开指导原则和框架：

- FDA《Considerations for the Design and Conduct of Externally Controlled Trials for Drug and Biological Products》2023 年草案。
- ICH E10《Choice of Control Group and Related Issues in Clinical Trials》。
- ICH E9(R1) estimand 框架。
- NMPA《真实世界证据支持药物研发与审评的指导原则（试行）》。
- NMPA/CDE《药物真实世界研究设计与方案框架指导原则（试行）》。
- FDA《Real-World Data: Assessing Electronic Health Records and Medical Claims Data to Support Regulatory Decision-Making》2024。
- Target trial emulation 与 estimand 联合框架。

研究开始前必须与对应监管机构沟通方案和 SAP。FDA 2023 指南是草案，不是监管承诺；任何研究设计都不能仅凭满足本计划自动获得注册资格。

## Scope

### In Scope

- 单臂试验 + 外部历史对照的 superiority 设计。
- 至少一个申办方试验数据源。
- 一个主要外部对照源；在可行时增加第二个独立外部对照源做异质性和复现分析。
- 预先定义的 eligibility、time zero、treatment strategies、outcome、follow-up、intercurrent events、estimand 和 estimator。
- 年龄、性别、日历时间、疾病严重度、合并症、既往治疗、关键生物标志物等混杂控制。
- 倾向评分加权、匹配作为敏感性分析、balance/overlap 诊断、缺失数据与偏倚分析。
- Synthea 合成数据生成、信号注入、答案键和可重复对拍。
- MDOP 多数据源编排、ContractBundle、可信节点执行和证据输出。

### Non-Goals

- 不用本计划验证某个真实药品或器械的临床效果。
- 不把当前 460 × 5,600 的简化演示设计直接升级为注册研究。
- 不采用非劣效设计。FDA 外部对照指南草案不建议将外部对照用于非劣效性证明。
- 不让 LLM 自由选择混杂变量、模型、阈值或统计方法。
- 不让平台以“聚合结果”替代监管机构对源数据和源文件的合法访问。
- 不在第一阶段实现真实患者数据自动化接入和正式申报提交。

## Preconditions

### P0 临床与注册决策门

以下内容必须由申办方、临床、统计、注册、伦理和数据提供方共同确认，不能由工程默认值代替：

- [ ] 产品、适应症、研究目的和拟定申报路径。
- [ ] 疾病自然史是否足够清楚，外部对照是否具备方法学可行性。
- [ ] 试验组与外部对照组各自接受的 treatment strategy。
- [ ] 目标人群和关键入排标准。
- [ ] time zero 的统一定义。
- [ ] 主要和次要终点、结局 ascertainment 规则。
- [ ] 随访开始、结束、删失和 intercurrent event 处理。
- [ ] 主要 estimand 是 ATT、ATE 或其他，以及总体 summary measure。
- [ ] 是否为主证据、支持性证据或探索性证据。
- [ ] 是否需要两个或更多独立外部对照源。
- [ ] 监管沟通计划和数据访问安排。

任何一项未确定，只能开展工程研发和合成数据演练，不能进入真实注册研究执行。

## Reference Study Configuration

建立一个不绑定具体产品的参考配置，真实项目启动时替换研究字段：

```json
{
  "studyId": "REG-ECA-001",
  "design": "single-arm-with-external-control",
  "objective": "superiority",
  "estimand": "ATT",
  "primaryEstimator": "IPTW-ATT",
  "timeZero": "treatment-or-index-date",
  "outcomeType": "time-to-event-or-binary",
  "minimumExternalSources": 1,
  "targetExternalSources": 2,
  "dataSources": [
    {
      "role": "trial",
      "participantId": "${trialParticipant}",
      "dataProductId": "${trialDataProduct}"
    },
    {
      "role": "external-control-primary",
      "participantId": "${controlParticipant}",
      "dataProductId": "${controlDataProduct}"
    }
  ],
  "confounders": [
    "age",
    "sex",
    "calendarYear",
    "severity",
    "diseaseDuration",
    "comorbidityIndex",
    "priorTreatment",
    "keyBiomarker"
  ],
  "missingDataPlan": "multiple-imputation",
  "sensitivityAnalyses": [
    "alternative-time-zero-window",
    "overlap-trimming",
    "alternative-ps-model",
    "coarsened-exact-matching",
    "negative-control-outcome",
    "quantitative-bias-analysis"
  ]
}
```

`participant` 和 `dataProduct` 不得默认写死华山、瑞金或其他具体医院。真实项目通过研究配置显式选择。

## Study Design

### 1. Target Trial

在访问任何外部对照结果前，先写出一个假设随机试验：

- 目标人群：满足试验入排且处于相同疾病阶段的成年人。
- 治疗策略：试验干预的固定 regimen 对照历史标准治疗或不使用同类干预的策略。
- 分配：不是实际随机；用倾向评分和 target trial emulation 近似。
- Time zero：试验组为治疗开始或入组日；外部对照组必须映射到语义相同的日期。
- 随访：统一开始、统一最大随访期、明确删失规则。
- 结局：客观、可重复、可在两类数据源中一致识别的终点。
- Causal contrast：ATT 优先，使用预先定义的 estimand。
- Summary measure：风险差、风险比、HR 或 RMST，按终点类型选择。

### 2. Cohort Construction

- [ ] 研究期、入组期、washout 和随访结束日期固定。
- [ ] 试验组按 protocol eligibility 构建。
- [ ] 外部对照组按同一概念定义构建；允许因数据可得性实施预先声明的近似规则。
- [ ] 同一主体不得同时进入试验组和外部对照组。
- [ ] 既往治疗、合并症和诊断必须在 time zero 之前测量。
- [ ] 结局只能在 time zero 之后识别。
- [ ] 记录每个排除步骤的人数和原因。

### 3. Confounding and Balancing

主分析建议采用 IPTW-ATT：

- 目标人群为试验入排符合者。
- 以 trial participation 为处理变量拟合倾向评分。
- 检查 positivity、极端权重和 overlap。
- 稳定权重并预先规定截尾规则。
- 以 SMD 评估加权前后平衡。
- 匹配只作为敏感性分析，不作为唯一主方法。

如果真实项目选择 matching 作为主方法，必须在 SAP 中预先明确：

- 分层变量和匹配变量。
- caliper 单位和定义。
- K:1 比率是否固定。
- 贪心、最优或网络流算法。
- 可重复使用规则。
- 每名试验受试者权重。
- 未匹配对象如何处理。

### 4. Outcome Analysis

- 二元结局：加权风险、风险差、风险比及 95% CI。
- 时间至事件：KM/加权生存、HR 或 RMST；明确 competing risk。
- 连续结局：加权均值差或预定义变换。
- 主要分析必须预先冻结模型、协变量、参数约束和敏感性分析。
- 单层结果只能作为分层描述，不得替代预先定义的合并 estimand。

### 5. Diagnostics and Sensitivity

- [ ] 加权前后 SMD 表。
- [ ] 倾向评分分布和 overlap 图。
- [ ] 权重分布、截尾比例和有效样本量。
- [ ] 缺失模式、多重插补和完整病例对照。
- [ ] time zero 平移和 caliper 变换。
- [ ] 另一套 PS 模型或协变量集。
- [ ] 阴性对照结局。
- [ ] E-value 或预定义的定量偏倚分析。
- [ ] 第二外部对照源复现。
- [ ] 每项敏感性分析的结论方向与不确定性。

## Synthea Data Generation

### 1. Goals of Synthetic Data

Synthea 数据用于：

- 验证队列构建和跨院链接。
- 控制已知 treatment effect、混杂和缺失机制。
- 生成答案键，检查统计实现和隐私发布结果。
- 覆盖负例、边界例、缺失、删失和异质性。

不用于：

- 临床有效性结论。
- 真实监管申报。
- 声称模拟了某真实疾病的完整自然史。

### 2. Pinned Inputs

- [ ] 固定 Synthea JAR 版本和 SHA-256。
- [ ] 固定 disease Keep Module、模块源码和 SHA-256。
- [ ] 固定人口规模、seed、地理区域和 reference date。
- [ ] 固定 Synthea 输出配置、CSV schema 版本和 FHIR 导出开关。
- [ ] 将 jar 放在 `data/synthea/`，生成目录写入 `.gitignore`。

### 3. Disease Module

工程阶段选择一个明确的合成疾病模块，真实研究启动时替换为适应症对应模块。

- [ ] 创建 `data/synthea/modules/keep_registration_indication.json`。
- [ ] 用 Active Condition 的 SNOMED 或其他稳定编码保留目标人群。
- [ ] 保留目标疾病常用药物、检查、就诊和随访事件。
- [ ] 不把 `-m module` 当作疾病过滤；使用完整患者图 + Keep Module。
- [ ] 明确 Synthea 不覆盖的真实变量，并通过显式注入补齐。

### 4. Generator Script

新增 `scripts/generate-synthea-registration-cohort.sh`：

```bash
scripts/generate-synthea-registration-cohort.sh \
  --population 100000 \
  --seed 20261017 \
  --age 18-80 \
  --state Massachusetts \
  --reference-date 20261001 \
  --keep-module data/synthea/modules/keep_registration_indication.json \
  --output data/synthea/registration-20261017
```

脚本要求：

- [ ] 校验 Java、JAR、Keep Module 和固定摘要。
- [ ] 在独立 temp workdir 运行，避免污染仓库根。
- [ ] 同时输出 FHIR、CSV 和 metadata。
- [ ] 计算患者数、年龄、性别、目标诊断、药物、检查、就诊和随访分布。
- [ ] 生成 `generation-manifest.json`，记录全部输入、版本、seed 和摘要。
- [ ] 目标诊断不足或输出为空时非零退出。

### 5. Cohort Sufficiency

按真实研究的样本量和外部对照可用性评估：

- [ ] 先做 sample-size/power 分析，不直接沿用 460 × 5,600。
- [ ] 生成人口规模至少为预计合格人群的 10–20 倍。
- [ ] 保证年龄、性别、疾病严重度和日历年度各格有足够样本。
- [ ] 生成结果报告每个关键分层的候选人数和预计可匹配率。
- [ ] 明确哪些层因样本不足而停止研究或合并。

### 6. Source Partition

把 Synthea 人群分成互斥的数据域：

- 申办方试验来源。
- 主外部对照医院。
- 可选第二外部对照医院。
- 保留集或 holdout 集用于生成器校准。

不得让同一 `linkKey` 同时出现在试验臂和对照臂。

### 7. Signal Injection

新增 `scripts/build-registration-eca-fixtures.mjs`，输入 Synthea CSV 和研究配置，生成：

- `trial/records.json`
- `control-primary/records.json`
- `control-secondary/records.json`
- `answer-key.json`
- `generation-manifest.json`
- `data-quality-report.json`

注入以下结构：

- [ ] 入排资格：基于诊断、年龄、性别、既往治疗和研究期。
- [ ] Time zero：对 trial 和 controls 分别映射到同一语义。
- [ ] Treatment strategy：试验组接受试验干预；对照组接受明确历史策略。
- [ ] Confounders：年龄、性别、严重度、病程、合并症、既往治疗、生物标志物、年份和中心。
- [ ] 处理分配模型：让混杂变量同时影响入组/对照来源和结局。
- [ ] 结局模型：明确基线风险、已知效应参数、交互项和随机种子。
- [ ] Missingness：MCAR、MAR、MNAR 三种预置场景。
- [ ] Censoring：随机删失、竞争风险和不同随访长度。
- [ ] Site heterogeneity：不同外部来源的基线风险和医疗实践差异。
- [ ] Negative-control outcome：预期无处理效应的结局。

答案键必须包含：

- 真实 `rr` 或 `hr`。
- 真实风险差。
- 每个混杂变量的生成分布。
- 人群和排除计数。
- 每个分层的真值。
- 缺失和删失机制。
- 预期主分析结果范围。

### 8. Synthetic Data QA

- [ ] 日期逻辑：birth <= diagnosis <= time zero <= outcome/censor。
- [ ] 试验组和对照组的 linkKey 交集必须为空。
- [ ] 关键字段完整性和取值范围检查。
- [ ] 目标诊断和药物的编码检查。
- [ ] 每个研究分层的可匹配数和 overlap 检查。
- [ ] 对照事件率和注入参数一致性检查。
- [ ] 生成器重复运行必须逐字节或按固定规范化形式一致。
- [ ] 对数据做至少一次 ground-truth recovery：正确模型接近真值，错误模型偏离。

## Platform Implementation

### 1. Study Config and DSL

- [ ] 为注册型外部对照增加版本化 study profile，不复用简化 demo 参数。
- [ ] 使用 MDOP Plan DSL 表达 sources、roles、contract bundle、time-zero rule、estimand、estimator、diagnostics 和 release policy。
- [ ] DSL 由服务端生成或人工编辑，LLM 只能生成 `llm-draft`。
- [ ] 研究配置和 SAP 未冻结时禁止进入数据执行阶段。

### 2. Data Products and Contracts

- [ ] 每个数据源单独建 ContractBundle member。
- [ ] 合约写明 purpose、allowed operators、fields/projection、output policy、minCell、retention、validity 和 regulator review access。
- [ ] 所有成员合约的交集/最严策略按 ContractBundle 规则计算。
- [ ] 真实数据接入前完成 source-data agreements 和监管访问条款。

### 3. Data Projection

节点所需最小字段至少包括：

```text
subjectKey
linkKey
sourceId
age
sex
calendarYear
timeZero
eligibleAtTimeZero
treatmentStrategy
severity
diseaseDuration
comorbidityIndex
priorTreatment
keyBiomarker
outcome
outcomeDate
censorDate
followUpDays
intercurrentEvents
```

字段可用性随真实数据源调整，但缺失必须进入 `missingness report`，不能静默删除。

### 4. New Registration Operator

新增版本化算子，例如 `rws.external-control-registration@1.0.0`，保留原 `rws.external-control@1.0.0` 作为演示算子。

阶段拆分建议：

```text
source.dataset
→ build-analysis-cohort
→ build-covariates
→ fit-propensity-model
→ apply-weights
→ estimate-effect
→ diagnostics
→ declassify.small_cell
```

- [ ] 算子只接受预定义数值列和有限枚举。
- [ ] 模型、变量集、截尾规则、缺失处理和估计量由冻结配置决定。
- [ ] 随机过程使用固定 seed 和可复现随机数生成器。
- [ ] 输出只包含预定义聚合、诊断和答案键对照摘要。
- [ ] 出现 positivity 失败、权重失控、关键变量缺失或模型不收敛时 fail-closed。

### 5. MDOP and ContractBundle

- [ ] 一个 MDOP 作业引用一个 ContractBundle version 和所有成员合约。
- [ ] 每个 source/seal 阶段绑定自己的合约。
- [ ] TEE 聚合阶段使用 bundle 的合并策略。
- [ ] 接收方、有效期、minCell、TEE 策略和 allowed ops 按最严/交集规则执行。

### 6. UI and Evidence

- [ ] 研究设计页显示真实方案、SAP 版本、数据源和 ContractBundle，不显示合成参数为临床事实。
- [ ] 作业详情页显示 estimand、estimator、协变量、平衡诊断、overlap、缺失和敏感性分析。
- [ ] 结果页明确区分“主要分析”“敏感性分析”和“合成数据演练”。
- [ ] 证据包包括方案版本、SAP 版本、DSL 版本、数据源版本、算子摘要、plan_hash、执行凭证、结果摘要和回执链。

## Verification

### 1. Synthetic Conformance

- [ ] 正确答案恢复：预定义模型在答案键真值附近恢复。
- [ ] 负例：无处理效应场景的 CI 合理覆盖 null。
- [ ] 混杂负例：不调整时产生偏倚，调整后接近真值。
- [ ] 缺失/删失负例：错误处理导致偏倚，预定义方法恢复稳定。
- [ ] 外部来源异质性负例：单来源结论不稳健，多来源分析如实报告。
- [ ] 对 `rws.external-control-registration@1.0.0` 做 TypeScript 参考实现对拍。
- [ ] 模块构建可复现，SM3 固定。

### 2. Platform Security

- [ ] 平台不接收行级数据。
- [ ] C2 信封只能流向通过 TDX 证明的节点。
- [ ] ContractBundle 任一成员无效时 fail-closed。
- [ ] 发布审查执行 minCell 和更严输出策略。
- [ ] 作业结束收齐所有节点销毁回执后才进入 PURGED。
- [ ] 回执链可离线核验。

### 3. Statistical Review

- [ ] 临床和统计负责人逐项确认方案、SAP 和结果。
- [ ] 独立统计师在不知道结果的情况下审查程序。
- [ ] 运行第二套统计程序复现主要结果。
- [ ] 所有方案偏离、SAP 修改和敏感性分析后补都带时间戳与理由。

### 4. Regulatory Package

- [ ] 数据源适用性报告：relevance、reliability、traceability、missingness。
- [ ] 队列构建和排除流程图。
- [ ] 基线特征、SMD、PS 分布、overlap 和权重诊断。
- [ ] 主要和敏感性分析结果。
- [ ] 负例和偏倚分析。
- [ ] 监管访问源数据的合法路径。
- [ ] 研究方案、SAP、统计分析程序和可复现运行说明。

## Definition of Done

- [ ] 真实研究的产品、适应症、自然史、treatment strategy、estimand 和 SAP 已冻结。
- [ ] Synthea 生成器可固定 seed 重跑，输出患者、诊断、药物、时间和数据质量报告一致。
- [ ] 试验、主对照和可选第二对照数据集互斥，答案键完整。
- [ ] 新注册型算子通过参考实现、真值恢复、混杂、缺失、删失和异质性测试。
- [ ] MDOP 多数据源、ContractBundle、TDX、PEP、发布审查、销毁和审计全部通过。
- [ ] 报告明确合成数据的用途和边界，不把演示结果写成临床或监管结论。
- [ ] 真实数据替换前完成伦理、合约、数据源验证和监管沟通。
- [ ] 监管证据包可以从事务一追溯到一个具体源数据定义和一条执行回执。

## Risks

| 风险 | 影响 | 控制 |
|---|---|---|
| 适应症自然史不明确 | 外部对照不可解释 | P0 临床可行性门；必要时放弃 ECA |
| 混杂变量缺失 | 残余混杂 | 数据源适用性评估、proxy、敏感性分析、E-value |
| 历史数据与试验数据测量不同 | 结局误分类 | 统一 phenotype、结局验证、双人复核 |
| Time zero 不对齐 | immortal time/survivorship bias | 目标试验模拟和 time-zero 敏感性分析 |
| 样本量或 overlap 不足 | 无法估计 ATT | 先做 feasibility/power，不满足即停止 |
| Synthea 过于规则 | 误以为统计程序已被充分验证 | 注入缺失、删失、异质性、测量误差和负例 |
| 监管要求源数据访问 | 数据不出域与现场核查冲突 | 前置约定受控审阅/监管沙箱/源数据访问机制 |
| 模型选择事后漂移 | p-hacking 和不可复现 | SAP、代码冻结、结果盲态、变更留痕 |
| 多合约策略不一致 | 出域口径减弱 | ContractBundle 最严/交集规则 |
| 合成数据被误读为真实疗效 | 对外表述失真 | 报告固定标注 synthetic、非临床结论 |

## Open Decisions

- [ ] 选择真实产品和适应症。
- [ ] 选择主要终点和效应量。
- [ ] 决定单一外部对照还是多来源复制。
- [ ] 决定 ATT/ATE 和 primary estimator。
- [ ] 决定真实数据源的监管访问机制。
- [ ] 决定是否需要 HMA/CDISC SDTM/ADaM 输出及何时引入。
- [ ] 决定 GxP、Part 11、计算机化系统验证和电子签名范围。
- [ ] 与 CDE/FDA 的沟通节点和时间表。

## References

- FDA external control draft guidance: https://www.fda.gov/media/164960/download
- ICH E10: https://database.ich.org/sites/default/files/E10_Guideline.pdf
- FDA EHR/claims RWD guidance: https://www.fda.gov/media/152503/download
- NMPA RWE guidance: https://www.nmpa.gov.cn/xxgk/ggtg/ypggtg/ypqtggtg/20200107151901190.html
- NMPA/CDE RWS design guidance: https://www.nmpa.gov.cn/xxgk/ggtg/ypggtg/ypqtggtg/20230217143016157.html
- Target trial emulation: https://pubmed.ncbi.nlm.nih.gov/36508210/
- Estimand and target trial applied to external control: https://pmc.ncbi.nlm.nih.gov/articles/PMC10853363/
