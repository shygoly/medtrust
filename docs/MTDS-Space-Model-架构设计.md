# 医疗数据可信空间（Medical Trusted Data Space, MTDS）Space Model 架构设计

## 1. 文档定位

医疗数据可信空间（Medical Trusted Data Space, MTDS）不是一个单纯的数据汇聚平台，也不是"数据湖 + 隐私计算"的技术堆栈，而是一种面向多机构医疗数据协作、科研计算、人工智能和数据要素价值流通的基础软件系统。

其核心目标不是简单地"集中数据"，而是在**数据不必离开持有方**的前提下，实现：

- 跨机构数据发现与协作；
- 医疗数据语义统一；
- 数据使用目的与授权策略控制；
- 可信计算与执行证明；
- 联邦统计、联邦学习及其他分布式计算；
- 高质量医疗数据集制备；
- 医疗 AI 模型训练、验证与推理；
- 参与方贡献度度量和价值分配；
- 全流程可审计、可追溯、可证明。

因此，本系统可以定义为：

> **一个以 Semantic Kernel、Policy Kernel、Trust Kernel 和 Compute Kernel 为核心，通过 Space Model 组织参与方、数据、语义、策略、计算、可信执行、智能和价值流转的 Medical Data & AI Operating Space。**

---

# 2. 总体 Space Model

医疗可信空间定义为九个相互关联的领域空间：

$$
\boxed{
MTS =
\{
Participant,
Data,
Semantic,
Policy,
Trust,
Compute,
Intelligence,
Experience,
Value
\}
}
$$

九个 Space 分别回答九个核心问题：

| Space | 核心问题 |
|---|---|
| Participant Space | 谁在协作？ |
| Data Space | 有什么数据？ |
| Semantic Space | 数据到底代表什么？ |
| Policy Space | 谁可以为什么目的使用什么？ |
| Trust Space | 如何证明数据和计算过程可信？ |
| Compute Space | 对数据可以做什么计算？ |
| Intelligence Space | 如何从数据产生模型、知识和智能？ |
| Experience Space | 人如何发现、组合和使用这些能力？ |
| Value Space | 谁贡献了什么，价值如何度量和分配？ |

系统的核心逻辑可以表示为：

$$
\boxed{
Experience
\rightarrow
Semantic
\rightarrow
Policy
\rightarrow
Trust
\rightarrow
Compute
\rightarrow
Data
}
$$

同时：

$$
Participant
$$

决定协作网络中的主体和资源；

$$
Intelligence
$$

负责把数据和计算转化为模型、知识及 AI 能力；

$$
Value
$$

负责把协作产生的结果转化为可度量、可追踪、可分配的价值资产。

因此九个 Space 并不是简单的九层，而是：

$$
\boxed{
5\text{ 个核心执行空间}
+
3\text{ 个横向能力空间}
+
1\text{ 个价值空间}
}
$$

其中：

### 核心执行空间

$$
Experience
\rightarrow
Semantic
\rightarrow
Policy
\rightarrow
Trust
\rightarrow
Compute
\rightarrow
Data
$$

严格来说这里包含六个核心空间。

### 横向能力空间

- Participant Space
- Intelligence Space
- Value Space

它们与核心执行链形成交叉关系，而不是简单位于某一层。

---

# 3. Space Model 的统一形式化定义

为避免不同 Space 各自建立孤立的数据模型，整个系统采用统一的 Space Object Model。

任一 Space 定义为：

$$
Space_i =
\langle
E_i,
O_i,
P_i,
R_i,
S_i,
C_i,
V_i,
Ev_i,
Api_i
\rangle
$$

其中：

- $E_i$：实体类型 Entity Type；
- $O_i$：实体实例 Object；
- $P_i$：谓词、动作和操作 Predicate / Command；
- $R_i$：关系 Relation；
- $S_i$：状态 State；
- $C_i$：约束 Constraint / Policy；
- $V_i$：版本 Version；
- $Ev_i$：事件 Event；
- $Api_i$：对外提供的 API / Capability。

任意对象均具有统一对象标识：

$$
Object =
\langle
id,
type,
version,
owner,
state,
provenance
\rangle
$$

任意关系定义为：

$$
Relation =
\langle
source,
predicate,
target,
context,
version,
provenance
\rangle
$$

任意操作定义为：

$$
Command:
State \times Input
\rightarrow
State'
$$

任意状态变化产生事件：

$$
State_t
\xrightarrow{Event}
State_{t+1}
$$

因此，整个医疗可信空间不是由一组孤立服务拼成，而是由一个统一的：

$$
\boxed{
Entity + Relation + State + Policy + Event + Version
}
$$

语义系统组成。

---

# 4. Participant Space：参与方空间

## 4.1 定位

Participant Space 描述医疗可信空间中的所有协作主体，以及主体所拥有、提供和承担的责任。

它解决：

> 谁参与可信空间？谁拥有数据？谁提供计算？谁申请使用数据？谁承担责任？

医疗可信空间的第一属性不是"数据"，而是：

$$
Multi\text{-}Party\ Collaboration
$$

---

## 4.2 核心实体

```text
Participant
Organization
Institution
Hospital
Pharma
CRO
ResearchTeam
AICompany
DataController
DataProcessor
Researcher
Application
```

---

## 4.3 主体属性

```text
Identity
Credentials
Certificate
Contract
Registration
Role
Responsibility
Jurisdiction
```

---

## 4.4 核心关系

$$
Participant
\overset{owns}{\rightarrow}
DataAsset
$$

$$
Participant
\overset{offers}{\rightarrow}
ComputeCapability
$$

$$
Participant
\overset{governedBy}{\rightarrow}
Policy
$$

$$
Participant
\overset{participatesIn}{\rightarrow}
ResearchProject
$$

$$
Participant
\overset{contributesTo}{\rightarrow}
Computation
$$

---

## 4.5 Space Contract

### Input

```text
Organization Identity
Credentials
Registration
Contract
Capability Advertisement
```

### Output

```text
Participant Identity
Data Capability
Compute Capability
Trust Credential
Participation Status
```

### Events

```text
ParticipantRegistered
ParticipantVerified
ParticipantSuspended
CapabilityPublished
CapabilityRevoked
ContractActivated
ContractExpired
```

---

# 5. Data Space：医疗数据空间

## 5.1 定位

Data Space 管理医疗数据资产及其计算可用性，而不是把所有数据强制汇聚到中心数据库。

核心原则：

$$
\boxed{
DataAsset \neq DataContent
}
$$

Data Asset 表示：

> 有什么数据、谁拥有、在哪里、什么结构、什么质量、什么敏感性、允许通过什么方式计算。

Data Content 才是实际数据记录。

---

## 5.2 核心实体

```text
DataSource
DataAsset
Dataset
DatasetVersion
Database
Table
Column
Record
Document
Image
ImagingStudy
ClinicalEvent
LabResult
Medication
BiologicalSample
GenomicData
```

---

## 5.3 Data Asset 属性

```text
Location
Schema
Owner
Quality
Sensitivity
Coverage
Freshness
Availability
PolicyBinding
ComputeCapability
SemanticMapping
```

---

## 5.4 典型数据源

```text
HIS
EMR
EHR
LIS
PACS
RIS
Pathology
CDR
Clinical Trial System
RWD
Genomic Platform
IoT / Wearable
```

---

## 5.5 核心关系

$$
Participant
\overset{owns}{\rightarrow}
DataAsset
$$

$$
DataAsset
\overset{hasSchema}{\rightarrow}
Schema
$$

$$
DataAsset
\overset{mappedTo}{\rightarrow}
Concept
$$

$$
DataAsset
\overset{boundBy}{\rightarrow}
Policy
$$

$$
DataAsset
\overset{supports}{\rightarrow}
ComputeCapability
$$

---

# 6. Semantic Space：医疗语义空间

## 6.1 定位

Semantic Space 是医疗可信空间的：

$$
\boxed{
Semantic\ Kernel
}
$$

它解决跨机构数据的核心问题：

> 不同医院的字段、编码、临床术语、检查项目和业务对象，到底是不是同一个医学概念？

因此，数据治理的目标不再只是：

```text
字段统一
```

而是：

```text
概念统一
+
上下文统一
+
语义来源可追踪
```

---

## 6.2 核心实体

```text
Concept
Ontology
CodeSystem
ValueSet
Terminology
Term
Mapping
Relation
Context
SemanticVersion
Provenance
```

---

## 6.3 语义映射

例如：

```text
Hospital A:
HbA1c

Hospital B:
Glycated Hemoglobin

Hospital C:
糖化血红蛋白
```

统一映射：

```text
                    ┌───────────────┐
HbA1c ──────────────┤               │
Glycated Hemoglobin ┤ HbA1c Concept │
糖化血红蛋白 ────────┤               │
                    └───────────────┘
```

形式化表示：

$$
LocalConcept
\xrightarrow{SemanticMapping}
StandardConcept
$$

---

## 6.4 Semantic Kernel 的扩展

医疗语义不能只使用静态本体，因此：

$$
\boxed{
MedicalSemanticKernel
=
StandardConcept
+
Context
+
Provenance
}
$$

例如对于一项检验：

```text
HbA1c
+
患者年龄
+
检测时间
+
空腹/随机
+
设备型号
+
单位
+
机构
+
检测方法
```

这些上下文信息将直接影响数据比较、统计分析和模型训练。

因此 Semantic Space 必须支持：

```text
Contextual Semantics
Temporal Semantics
Measurement Semantics
Provenance
```

---

# 7. Policy Space：数据使用策略空间

## 7.1 定位

Policy Space 负责回答：

> 谁可以以什么目的、使用哪些数据、执行什么算法、在什么环境中进行计算？

所以权限模型不能只是：

```text
User → Role → Permission
```

而应该升级为：

$$
\boxed{
Participant
+
Data
+
Purpose
+
Algorithm
+
Environment
+
Time
\rightarrow
Decision
}
$$

---

## 7.2 核心实体

```text
Policy
Consent
Purpose
Permission
Restriction
RetentionRule
GeographicRestriction
ResearchScope
Contract
Authorization
Approval
```

---

## 7.3 核心决策函数

$$
CanCompute(
Participant,
Data,
Algorithm,
Purpose,
Environment
)
\rightarrow
Allow/Deny
$$

更完整地表示：

$$
PolicyDecision =
f(
Subject,
Data,
Purpose,
Algorithm,
Environment,
Time,
Consent,
Contract
)
$$

---

## 7.4 动态 Consent

医疗数据授权具有时序性：

```text
Consent Granted
       ↓
Compute Allowed
       ↓
Consent Revoked
       ↓
Compute Blocked
       ↓
Impact Analysis
       ↓
Model / Dataset Handling
```

因此系统必须支持：

```text
ConsentVersion
ConsentEvent
Revocation
PolicyRe-evaluation
DownstreamImpact
```

对于特定场景，还可以进入：

```text
Machine Unlearning
Dataset Withdrawal
Model Retraining
```

但这些属于后续执行策略，不应在 Policy Space 中直接承担模型训练职责。

---

# 8. Trust Space：可信执行空间

## 8.1 定位

Trust Space 是整个医疗可信空间区别于普通数据平台的核心。

它负责回答：

> 如何证明数据访问、计算环境、计算过程和计算结果值得信任？

因此：

$$
\boxed{
Trusted\ Space
\neq
Federated\ Learning
}
$$

更准确地说：

$$
TrustedSpace =
Identity
+
Attestation
+
SecureCompute
+
Evidence
+
Governance
$$

---

## 8.2 两条信任轨道

### 技术信任

```text
Identity
Credential
Attestation
TrustedNode
TEE
MPC
DifferentialPrivacy
Encryption
SecureAggregation
AuditProof
```

### 机构与合规信任

```text
IRBApproval
ComplianceCredential
InstitutionCredential
Contract
Certification
Jurisdiction
```

因此：

$$
\boxed{
TrustedExecution
=
TechnicalTrust
\times
ComplianceTrust
}
$$

必须同时满足两个维度。

---

## 8.3 Trust Decision

一个任务进入执行阶段前必须完成：

```text
Identity Check
      ↓
Policy Check
      ↓
Consent Check
      ↓
Environment Check
      ↓
Attestation
      ↓
Secure Execution
      ↓
Proof / Evidence
```

---

# 9. Compute Space：医疗计算空间

## 9.1 定位

Compute Space 负责定义：

> 对医疗数据执行什么计算。

核心不是某一个计算引擎，而是：

$$
Logical\ Computation
$$

到：

$$
Trusted\ Execution
$$

的转换。

---

## 9.2 核心实体

```text
Workflow
FederatedJob
Task
Algorithm
Query
Node
ComputeResource
Execution
ExecutionPlan
StatisticalOperator
MLOperator
PrivacyOperator
AggregationOperator
```

---

## 9.3 Workflow Compiler

科研人员提交：

```text
Logical Medical Computation
```

系统经过：

```text
Semantic Validation
        ↓
Policy Validation
        ↓
Data Capability Validation
        ↓
Trust Validation
        ↓
Operator Validation
        ↓
Physical Planning
        ↓
Trusted Execution Plan
```

最终：

$$
\boxed{
LogicalMedicalComputation
\xrightarrow{Compiler}
TrustedExecutionPlan
}
$$

---

## 9.4 分布式统计计算一致性

对医疗科研计算，必须注意：

$$
Result_{Distributed}
\approx
Result_{SingleNode}
$$

但不能假设二者天然完全一致。

因此 Compute Space 应定义：

```text
NumericalPolicy
PrecisionPolicy
AggregationPolicy
DeterminismPolicy
ReproducibilityPolicy
```

尤其对于：

* 方差；
* 协方差；
* 分位数；
* 回归；
* 迭代算法；
* 浮点聚合；
* 随机算法；

应定义明确的计算规范。

---

# 10. Intelligence Space：医疗 AI 空间

## 10.1 定位

Intelligence Space 管理：

> 数据如何转化为模型、知识、特征和 AI 能力。

---

## 10.2 核心实体

```text
Feature
FeatureSet
Model
ModelVersion
Embedding
KnowledgeGraph
KnowledgeBase
Agent
TrainingJob
InferenceJob
Evaluation
Feedback
Prompt
```

---

## 10.3 Data-to-AI Lifecycle

$$
Dataset
\rightarrow
Training
\rightarrow
Model
\rightarrow
Inference
\rightarrow
Feedback
$$

进一步形成：

$$
RawData
\rightarrow
SemanticData
\rightarrow
HighQualityDataset
\rightarrow
FederatedTraining
\rightarrow
Model
\rightarrow
ClinicalAI
$$

---

## 10.4 与 Data Space 的关系

AI 不直接拥有原始医疗数据，而消费：

```text
Dataset Capability
Feature Capability
Inference Capability
Knowledge Capability
```

因此：

$$
DataAsset
\rightarrow
Dataset
\rightarrow
Training
\rightarrow
ModelAsset
$$

---

# 11. Experience Space：医疗科研与数据应用空间

## 11.1 定位

Experience Space 是整个医疗可信空间面向用户的交互层。

但 Experience Space 不直接暴露底层：

```text
Database
Table
SQL
Flink
MPC
TEE
```

而应该暴露：

```text
Data Asset
Research Resource
Compute Capability
Dataset
Model
Semantic Resource
```

因此：

$$
\boxed{
PhysicalData
\rightarrow
SemanticAsset
\rightarrow
AvailableCapability
}
$$

---

## 11.2 核心工作台

```text
Research Workspace
Data Asset Marketplace
Federated Analysis Workspace
Dataset Workspace
Model Workspace
Semantic Workspace
Policy Workspace
Audit Workspace
```

---

## 11.3 用户角色

```text
Doctor
Researcher
Pharma Scientist
CRO
Data Scientist
AI Engineer
Data Administrator
Compliance Officer
Auditor
```

不同角色通过不同的 Experience View 访问同一底层 Space Model。

---

# 12. Value & Incentive Space：价值与激励空间

## 12.1 定位

医疗可信空间最终不仅是"数据安全共享"，还必须解决：

> 谁贡献了数据？谁贡献了算力？谁贡献了模型？研究结果应该如何分配？

因此 Value Space 负责建立跨机构价值度量机制。

---

## 12.2 核心实体

```text
Contribution
ContributionEvidence
Pricing
Reward
Settlement
IPRight
License
RevenueShare
ShapleyValue
EconomicCredential
```

---

## 12.3 Contribution Model

一次联合计算：

$$
Compute(Data, Algorithm)
\rightarrow
Result
$$

应该扩展为：

$$
\boxed{
Compute(Data, Algorithm)
\rightarrow
Result
+
ContributionProof
}
$$

贡献来源可以包括：

```text
Data Contribution
Compute Contribution
Semantic Contribution
Algorithm Contribution
Model Contribution
Annotation Contribution
Infrastructure Contribution
```

---

## 12.4 Contribution Evidence

贡献度不应该通过人工申报，而应该与实际计算过程绑定。

例如：

```text
Participant A
   ↓
Data Contribution

Participant B
   ↓
Compute Contribution

Participant C
   ↓
Algorithm Contribution

Participant D
   ↓
Semantic Mapping Contribution
```

系统生成：

```text
ContributionEvidence
```

再计算：

$$
ContributionScore
$$

对于复杂科研协作，可以引入 Shapley Value 等公平分摊机制，但应作为可插拔的价值计算策略，而不是写死在核心计算引擎中。

---

# 13. 九个 Space 的核心关系

整个系统可以形成统一关系网络：

```text
Participant
     │
     ├──── owns ───────→ DataAsset
     │
     ├──── offers ─────→ ComputeCapability
     │
     └──── governedBy ─→ Policy
                              │
                              ↓
DataAsset ───── mappedTo ─→ SemanticConcept
     │
     │
     └──── supports ─────→ ComputeCapability
                              │
                              ↓
                        ComputePlan
                              │
                              ↓
                         TrustPlan
                              │
                              ↓
                      TrustedExecution
                              │
               ┌──────────────┴──────────────┐
               ↓                             ↓
            Dataset                        Result
               │                             │
               ↓                             ↓
          Intelligence                    Value
               │                             │
               ↓                             ↓
             Model                    Contribution
```

---

# 14. Space 之间的依赖规则

为了防止架构腐化，需要明确规定 Space Dependency。

| From         | To          | 允许关系      |
| ------------ | ----------- | --------- |
| Experience   | Semantic    | 查询/创建语义对象 |
| Experience   | Policy      | 创建授权请求    |
| Experience   | Compute     | 提交计算任务    |
| Semantic     | Data        | 映射数据      |
| Policy       | Data        | 约束数据使用    |
| Policy       | Compute     | 授权计算      |
| Trust        | Compute     | 提供可信执行环境  |
| Compute      | Data        | 请求数据计算    |
| Intelligence | Data        | 消费数据资产    |
| Intelligence | Compute     | 使用计算能力    |
| Value        | Compute     | 获取贡献证据    |
| Value        | Participant | 结算贡献      |
| Participant  | Data        | 所有权       |
| Participant  | Trust       | 身份与凭证     |

禁止：

```text
UI → Database
UI → Flink
UI → TEE
Agent → Raw Database
Model → Raw Medical Table
Policy → Runtime Implementation
```

正确方式必须经过相应 Space 的语义和控制边界。

---

# 15. Trusted Execution 的完整 Operating Flow

一个完整的医疗联合科研任务可以表示为：

```text
Researcher
    │
    ▼
Experience Space
    │
    │ Define Research Task
    ▼
Semantic Space
    │
    │ Concept Alignment
    │ Dataset Qualification
    ▼
Policy Space
    │
    │ Consent
    │ Purpose
    │ Contract
    │ IRB
    ▼
Participant Space
    │
    │ Discover Data / Compute Capability
    ▼
Trust Space
    │
    │ Identity
    │ Attestation
    │ Secure Environment
    ▼
Compute Space
    │
    │ Compile
    │ Schedule
    │ Federate
    ▼
Data Space
    │
    │ Local Computation
    │ No Raw Data Export
    ▼
Result
    │
    ├──────────────→ Intelligence Space
    │                     │
    │                     └── Dataset / Model / Knowledge
    │
    └──────────────→ Value Space
                          │
                          └── Contribution Evidence
```

---

# 16. MTDS 的统一 Operating Flow

整个系统可以抽象为六个核心阶段。

## 16.1 Define

由 Experience Space 定义研究需求：

```text
Research Question
Dataset Requirements
Population Criteria
Algorithm
Output Requirements
```

---

## 16.2 Understand

Semantic Space 将研究需求转换成：

```text
Medical Concepts
Data Requirements
Semantic Constraints
```

---

## 16.3 Authorize

Policy Space 判断：

```text
Who
+
Why
+
What Data
+
What Algorithm
+
Where
+
When
```

是否允许执行。

---

## 16.4 Discover & Compile

Participant Space 发现：

```text
Qualified Data Assets
Qualified Compute Nodes
Qualified Institutions
```

然后 Compute Space 进行：

```text
Logical Plan
→
Physical Plan
→
Trusted Execution Plan
```

---

## 16.5 Execute

Trust Space 建立可信环境。

Data Space 在数据持有方本地进行计算。

Compute Space 完成：

```text
Federated Query
Federated Statistics
Federated ML
Secure Aggregation
```

---

## 16.6 Learn & Value

执行结果进入：

```text
Intelligence Space
```

形成：

```text
Dataset
Feature
Model
Knowledge
```

与此同时：

```text
Value Space
```

产生：

```text
ContributionEvidence
ContributionScore
EconomicCredential
```

最终重新沉淀：

$$
\boxed{
Result
\xrightarrow{Intelligence}
DerivedAsset
\xrightarrow{Registration}
Data/Semantic Space
}
$$

形成持续积累的数据与智能资产循环。

---

# 17. Metadata / Semantic Kernel 的核心地位

在传统数据平台中，Metadata 通常是：

```text
Table
Column
Schema
Owner
```

在 MTDS 中则应该升级为：

$$
\boxed{
Metadata/Semantic Kernel
=
Data
+
Participant
+
Policy
+
Compute
+
Trust
+
Intelligence
+
Value
}
$$

它管理的不只是：

> 数据是什么。

而是：

> 数据是什么、谁拥有、能否使用、为什么能使用、如何计算、在哪计算、由谁计算、产生什么结果、结果属于谁。

因此 Metadata/Semantic Kernel 是整个 MTDS 的统一语义核心。

---

# 18. Policy Kernel 与 Trust Kernel

整个医疗可信空间实际上存在三个核心 Kernel。

### Semantic Kernel

回答：

$$
What\ is\ it?
$$

### Policy Kernel

回答：

$$
Can\ it\ be\ used?
$$

### Trust Kernel

回答：

$$
Can\ we\ trust\ the\ execution?
$$

三者组合：

$$
\boxed{
Semantic
+
Policy
+
Trust
}
$$

之后才允许：

$$
Compute
$$

这形成：

$$
\boxed{
Understand
\rightarrow
Authorize
\rightarrow
Trust
\rightarrow
Compute
}
$$

这是 MTDS 最核心的系统控制逻辑。

---

# 19. Compute Compiler

Compute Compiler 是系统控制中枢。

输入：

$$
ResearchIntent
$$

经过：

```text
Semantic Analysis
Policy Analysis
Participant Discovery
Capability Matching
Trust Analysis
Execution Optimization
```

输出：

$$
TrustedExecutionPlan
$$

完整形式：

$$
\boxed{
Compile(
Intent,
SemanticModel,
Policy,
Participants,
Capabilities,
TrustRequirements
)
\rightarrow
TrustedExecutionPlan
}
$$

---

# 20. Trusted Execution Plan

Trusted Execution Plan 不只是普通 DAG。

它至少包含：

```text
Participants
DataAssets
SemanticBindings
PolicyAssertions
ConsentAssertions
ComputeOperators
ExecutionNodes
PrivacyMechanisms
TrustRequirements
OutputRestrictions
AuditRequirements
ContributionRequirements
```

示例：

```yaml
research_task:
  id: research_001

purpose:
  type: clinical_research

participants:
  - hospital_a
  - hospital_b
  - hospital_c

datasets:
  - diabetes_dataset

semantic:
  concept: HbA1c

policy:
  consent_required: true
  irb_required: true
  purpose: research

execution:
  mode: federated
  privacy: secure_aggregation
  environment: tee

output:
  aggregation_only: true

value:
  contribution_tracking: true
```

这成为 Runtime 唯一需要理解的执行定义。

---

# 21. 技术架构映射

Space Model 最终需要还原成软件系统。

推荐技术映射如下：

| Space        | 核心服务                                 | 推荐技术                                |
| ------------ | ------------------------------------ | ----------------------------------- |
| Participant  | Identity / Registry / Capability     | PostgreSQL + IAM                    |
| Data         | Data Catalog / Connector             | PostgreSQL + Object Storage         |
| Semantic     | Semantic Registry / Ontology         | PostgreSQL + RDF/Graph DB           |
| Policy       | Policy Engine                        | OPA / 自研 Policy Service             |
| Trust        | Trust Gateway / Attestation          | TEE / MPC / PKI / KMS               |
| Compute      | Workflow Compiler / Federated Engine | Java/Go + Flink/K8s/联邦计算引擎          |
| Intelligence | Model / Dataset / Knowledge          | MLflow + Vector DB + Model Registry |
| Experience   | Web / Research Workspace             | React + TypeScript                  |
| Value        | Contribution / Settlement            | PostgreSQL + Evidence Store         |

---

# 22. 推荐底层基础设施

## 22.1 Control / Metadata

```text
PostgreSQL
Redis
Kafka
```

PostgreSQL：

```text
Entity
Relation
Policy
Version
Execution
Participant
Dataset
Model
```

Kafka：

```text
Metadata Events
Policy Events
Execution Events
Audit Events
Contribution Events
```

---

## 22.2 Data

```text
MySQL
PostgreSQL
Oracle
SQL Server
DM
HIS
LIS
PACS
Object Storage
```

通过 Connector / Gateway 接入。

---

## 22.3 Compute

```text
Apache Flink
Kubernetes
Python Runtime
SQL Engine
Federated Compute Engine
```

---

## 22.4 Trust

根据具体场景组合：

```text
TEE
MPC
Differential Privacy
Secure Aggregation
Encryption
PKI
KMS
Remote Attestation
```

---

## 22.5 Semantic

医疗本体与语义系统可以根据实际复杂度采用：

```text
FHIR
RDF
OWL 2
Terminology Service
Ontology Registry
Graph Database
```

---

## 22.6 Intelligence

```text
MLflow
Model Registry
Vector Database
Feature Store
Knowledge Graph
Training Runtime
Inference Runtime
```

---

# 23. 数据流、控制流与信任流

MTDS 需要同时理解三种流。

## Data Flow

$$
Data
\rightarrow
Computation
\rightarrow
Result
$$

## Control Flow

$$
Intent
\rightarrow
Policy
\rightarrow
Plan
\rightarrow
Execution
$$

## Trust Flow

$$
Identity
\rightarrow
Attestation
\rightarrow
Evidence
\rightarrow
Audit
$$

三个 Flow 汇聚为：

$$
\boxed{
Data
+
Control
+
Trust
}
$$

只有三者同时成立，计算结果才具备真正的可信属性。

---

# 24. Provenance Model

所有医疗数据、模型和计算结果都必须具备来源追踪。

定义：

$$
Provenance =
\langle
Source,
Process,
Agent,
Time,
Policy,
Environment
\rangle
$$

例如一个模型必须能够追溯：

```text
Model v5
  ↓
Training Run 12
  ↓
Dataset v8
  ↓
Hospital A
Hospital B
Hospital C
  ↓
Semantic Mapping v3
  ↓
Policy v9
  ↓
Trusted Execution v21
```

因此：

$$
Model
\rightarrow
Dataset
\rightarrow
DataAsset
\rightarrow
Participant
$$

形成完整的数据与模型血缘。

---

# 25. Version Model

医疗可信空间中的版本必须是系统级概念。

至少需要支持：

```text
DataVersion
SchemaVersion
SemanticVersion
PolicyVersion
ConsentVersion
WorkflowVersion
ExecutionVersion
DatasetVersion
ModelVersion
```

一个结果必须能够表达：

$$
Result =
f(
DataVersion,
SemanticVersion,
PolicyVersion,
AlgorithmVersion,
ExecutionVersion
)
$$

这样才能真正实现：

> 可复现、可验证、可审计。

---

# 26. Audit Model

Audit 不只是记录用户登录。

应该记录：

```text
Who
Did What
To Which Asset
For What Purpose
Using Which Policy
In Which Environment
At What Time
With Which Algorithm
Produced Which Result
```

定义：

$$
AuditEvent =
\langle
Actor,
Action,
Object,
Purpose,
Policy,
Environment,
Time,
Result
\rangle
$$

进一步与 Provenance 和 Trust Evidence 关联。

---

# 27. Security Boundary

医疗可信空间必须建立明确安全边界：

```text
┌────────────────────────────────────────────┐
│              Experience                   │
├────────────────────────────────────────────┤
│         Semantic / Policy Layer            │
├────────────────────────────────────────────┤
│          Trusted Control Plane             │
├────────────────────────────────────────────┤
│        Trusted Execution Environment       │
├────────────────────────────────────────────┤
│       Participant Private Data Domain       │
└────────────────────────────────────────────┘
```

任何跨机构计算必须经过：

```text
Identity
→
Policy
→
Trust
→
Execution
```

不得直接跨越控制边界访问明文医疗数据。

---

# 28. Space Model 与软件服务映射

九个 Space 不意味着必须创建九个微服务。

建议按照领域边界实现：

```text
Participant Service
Metadata Service
Semantic Service
Policy Service
Trust Service
Compute / Orchestration Service
Intelligence Service
Experience Service
Value Service
```

但第一阶段可以采用 Modular Monolith + 独立 Runtime 的方式：

```text
MTDS Core
├── Participant Module
├── Metadata Module
├── Semantic Module
├── Policy Module
├── Trust Module
├── Compute Module
├── Intelligence Module
└── Value Module

Runtime
├── Federated Compute
├── TEE Worker
├── MPC Worker
└── ML Worker
```

等领域边界稳定之后，再根据吞吐和组织边界拆分微服务。

---

# 29. Space 与数据库映射

推荐：

```text
PostgreSQL
    ↓
System of Record
```

用于：

```text
Participant
DataAsset
Semantic
Policy
Workflow
Execution Metadata
Dataset
Model
Value
```

Kafka：

```text
Event Backbone
```

OpenSearch：

```text
Audit
Execution Log
Operational Search
```

Object Storage：

```text
Documents
Models
Datasets
Evidence
Reports
Artifacts
```

Graph / RDF Store：

```text
Ontology
Semantic Relations
Lineage
Knowledge Graph
```

---

# 30. MVP 版本建议

不要第一期同时实现九个 Space 的全部复杂能力。

推荐按照以下顺序建设。

## Phase 1：可信数据资产基础

```text
Participant
Data
Semantic
Policy
Experience
```

完成：

```text
机构注册
数据资产目录
元数据
医学语义映射
权限/用途控制
数据能力发现
```

---

## Phase 2：可信计算

加入：

```text
Trust
Compute
```

完成：

```text
联合统计
联邦查询
安全聚合
可信节点
执行证明
审计
```

---

## Phase 3：医疗 AI

加入：

```text
Intelligence
```

完成：

```text
高质量 Dataset
联邦训练
模型注册
模型验证
本地推理
知识图谱
```

---

## Phase 4：数据要素价值

加入：

```text
Value
```

完成：

```text
贡献度
收益分配
授权许可
数据/模型/IP 价值管理
```

---

# 31. 最终系统架构

最终 MTDS 可以浓缩成下面的架构：

```text
                         ┌───────────────────────────────┐
                         │       Experience Space        │
                         │ Research / Data / AI / Audit  │
                         └──────────────┬────────────────┘
                                        │
                         ┌──────────────▼────────────────┐
                         │      Medical Semantic Kernel  │
                         │ Concept / Ontology / Mapping   │
                         │ Context / Provenance          │
                         └──────────────┬────────────────┘
                                        │
                         ┌──────────────▼────────────────┐
                         │         Policy Kernel          │
                         │ Consent / Purpose / Contract  │
                         │ Authorization / Restriction   │
                         └──────────────┬────────────────┘
                                        │
                         ┌──────────────▼────────────────┐
                         │          Trust Kernel          │
                         │ Identity / Attestation / TEE  │
                         │ MPC / DP / Evidence           │
                         └──────────────┬────────────────┘
                                        │
                         ┌──────────────▼────────────────┐
                         │         Compute Kernel         │
                         │ Workflow Compiler / Scheduler │
                         │ Federated Compute / ML        │
                         └──────────────┬────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    ▼                   ▼                   ▼
             Hospital A          Hospital B          Hospital C
             Data + Compute      Data + Compute      Data + Compute
                    │                   │                   │
                    └───────────────────┼───────────────────┘
                                        │
                              Secure Aggregation
                                        │
                         ┌──────────────▼────────────────┐
                         │       Intelligence Space       │
                         │ Dataset / Model / Knowledge   │
                         └──────────────┬────────────────┘
                                        │
                         ┌──────────────▼────────────────┐
                         │          Value Space           │
                         │ Contribution / License / IP   │
                         │ Reward / Settlement            │
                         └────────────────────────────────┘


       ┌──────────────────────┐       ┌──────────────────────┐
       │   Participant Space  │       │ Governance / Audit   │
       │ Organization / Role  │       │横向贯穿全部流程       │
       └──────────────────────┘       └──────────────────────┘
```

---

# 32. 核心架构原则

整个 MTDS 最终可以收敛为十条原则。

### Principle 1 — Data Sovereignty

数据资产属于数据持有方。

$$
DataOwnership \neq DataCentralization
$$

---

### Principle 2 — Semantic First

所有跨机构数据计算必须建立语义映射。

$$
SemanticAlignment
\rightarrow
Computation
$$

---

### Principle 3 — Policy Before Compute

任何计算必须先通过 Policy。

$$
Policy
\rightarrow
Compute
$$

而不是：

$$
Compute
\rightarrow
CheckPolicy
$$

---

### Principle 4 — Trust Before Execution

执行前必须完成可信环境验证。

$$
Trust
\rightarrow
Execution
$$

---

### Principle 5 — Logical Before Physical

科研任务先描述逻辑意图，再编译成执行计划。

$$
LogicalPlan
\rightarrow
PhysicalPlan
$$

---

### Principle 6 — Capability Over Raw Data

用户消费的是数据能力，而不是数据库表。

$$
Data
\rightarrow
Capability
$$

---

### Principle 7 — Provenance by Default

所有数据、模型、计算和结果默认可追溯。

---

### Principle 8 — Version Everything

数据、语义、策略、模型、工作流和执行计划均必须版本化。

---

### Principle 9 — Intelligence as Derived Asset

模型、特征、知识和高质量 Dataset 都属于数据资产的衍生资产。

$$
Data
\rightarrow
DerivedAsset
$$

---

### Principle 10 — Value With Evidence

价值分配必须建立在可验证的贡献证据之上。

$$
Contribution
\rightarrow
Evidence
\rightarrow
Value
$$

---

# 33. MTDS 的最终抽象

整个医疗可信空间可以最终抽象为：

$$
\boxed{
MTDS =
Participant
+
Semantic
+
Policy
+
Trust
+
Compute
+
Data
+
Intelligence
+
Experience
+
Value
}
$$

其中四个最重要的 Kernel 是：

$$
\boxed{
Semantic\ Kernel
+
Policy\ Kernel
+
Trust\ Kernel
+
Compute\ Kernel
}
$$

它们共同形成医疗可信空间的核心控制系统。

从软件操作系统的类比来看：

```text
Participant
    = Users / Organizations

Data
    = Data Resources

Semantic
    = Type System / Knowledge System

Policy
    = Access Control / Governance

Trust
    = Security / Trusted Execution

Compute
    = Process / Scheduler

Intelligence
    = AI / Knowledge / Learning

Experience
    = Applications / User Interface

Value
    = Economic / Ownership / Incentive Layer
```

因此，医疗可信空间最终不是：

> "把医院的数据连接起来。"

而是：

$$
\boxed{
建立一个让多方医疗机构能够在明确语义、
明确策略、可信执行、可验证结果和可度量贡献的条件下，
共同使用数据、共同完成计算、共同产生 AI 资产、
并共同分享数据要素价值的医疗数据与 AI 操作空间。
}
$$

这也是这套 Space Model 最终可以指导产品、技术架构、数据模型、接口设计和商业模式的原因。
