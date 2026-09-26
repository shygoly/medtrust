# MedTrust × 丝路数港 × 深圳数交所 · 全业务闭环流程图

> 前提：丝路数港（区域功能节点）与深圳数据交易所（交易场所）**均已对接**
> 图基于代码中的真实状态机绘制，非示意：`OrgCertificationStatus` / `ContractStatus` / `DataProduct.status` / `RwsOrchestrationStatus` / `RwsAssignmentStatus`
> 渲染：GitHub / Typora / VS Code 直接渲染 Mermaid；若需 PNG，用 <https://mermaid.live> 粘贴导出（本机未装 `mmdc`）

---

## 0. 读图前必须建立的两个前提

### 前提一：两个外部节点不是同类，不二选一

| 外部节点 | 类型 | 职责 | 在闭环中的位置 |
|---|---|---|---|
| **丝路数港**（国家数据流通利用基础设施·西安节点） | **区域功能节点** | 主体注册 · 身份互认 · 目录同步 · 日志上报 | 管**注册**与**跨域可见** |
| **深圳数据交易所** | **交易场所** | 产品挂牌 · 交易撮合 · 交易凭证与结算 | 管**挂牌**与**交易** |

同一家机构可以**同时在区域功能节点完成注册、在多个交易所挂牌**——这是层次关系，不是地区分店。「一点接入、全国通行」「一点发布、全域可见」说的正是这个。

### 前提二：两条贯穿全程的不变量

1. **原始数据出域 0 行**——数据永在院内，出域的是聚合量、计算结果与元数据
2. **每个关键动作上链存证**——签约、准入、修订、出域均可核验

---

## 图 1 · 五阶段闭环总览

```mermaid
flowchart LR
  S1["① 注册<br/>主体入驻 + 身份互认"] --> S2["② 上架<br/>数据产品发布"]
  S2 --> S3["③ 合约<br/>用途前置写死"]
  S3 --> S4["④ 任务<br/>多中心计算"]
  S4 --> S5["⑤ 交易<br/>交付结算分账"]
  S5 -.->|"运营反馈：新场景 / 新产品"| S2

  N1["丝路数港<br/>区域功能节点"] -.->|"主体注册/互认"| S1
  S2 -.->|"目录推送<br/>一点发布·全域可见"| N1
  S2 -.->|"产品挂牌"| N2["深圳数交所<br/>交易场所"]
  S5 -.->|"交易凭证/结算"| N2
  S5 -.->|"审计摘要上报"| N1

  classDef stage fill:#0F6E6A,stroke:#0B5450,color:#fff,font-weight:bold
  classDef node fill:#E7F4F1,stroke:#0F6E6A,color:#17303A
  class S1,S2,S3,S4,S5 stage
  class N1,N2 node
```

**闭环的含义**：交易不是终点。分账结果与买方反馈回流到运营侧，产生新的数据产品与新场景，回到「上架」——这才是数据空间的飞轮。

---

## 图 2 · 注册阶段（主体入驻 + 双身份）

```mermaid
flowchart TD
  A["机构发起入驻"] --> B["提交机构认证申请<br/>OrgCertificationApplication"]
  B --> C{"本空间审核"}
  C -->|"rejected"| B2["退回修改<br/>可重新提交"]
  B2 --> B
  C -->|"approved"| D["生成参与方<br/>cp_participant"]

  D --> E["同步区域功能节点主体注册<br/>cp_interop_subject<br/>nodeId = silk-road"]
  E --> F{"节点是否已有该主体"}
  F -->|"已注册"| G["按 USCC 检索带入<br/>免重复提交"]
  F -->|"未注册"| H["在节点完成主体注册"]
  G --> I["身份互认完成"]
  H --> I

  I --> J["本空间 SM2 CA 签发<br/>连接器证书"]
  J --> K["部署院内连接器<br/>标识/密钥/能力登记"]
  K --> L["参与方 active<br/>可发布产品"]

  note1["双身份不冲突：<br/>节点只做主体注册与跨域互认；<br/>密码学身份仍由本空间 CA 签发"]
  L --- note1

  classDef ok fill:#E7F4F1,stroke:#0F6E6A
  classDef ext fill:#FBEFD8,stroke:#F2A93B
  class E,G,H,I,J ext
  class L ok
```

**要点**：`OrgCertificationStatus` 是 `draft → submitted → approved / rejected`，**被驳回可修改重提**，不是一次性判定。

---

## 图 3 · 上架阶段（一次发布，两处可见）

```mermaid
flowchart TD
  A["医院连接器<br/>本地数据资源"] --> B["资源接入<br/>对象存储/数据库/文件"]
  B --> C["元数据抽取<br/>+ 数据分类分级"]
  C --> D["封装数据产品<br/>附带使用控制策略"]
  D --> E["上架<br/>DataProduct.status = active"]

  E --> F1["推送丝路数港目录<br/>元数据 only"]
  E --> F2["深圳数交所挂牌"]

  F1 --> G1["一点发布 · 全域可见<br/>跨域需求方可检索"]
  F2 --> G2["交易场所可见<br/>可被撮合交易"]

  G1 -.->|"外部目录拉取<br/>cp_remote_catalog"| H["外部产品进入本空间目录"]
  G2 -.-> H

  INV["不变量：上传的只有元数据<br/>（URN/标题/提供方/类型/分级/记录数）<br/>没有任何行级数据"]
  E --- INV

  classDef ext fill:#FBEFD8,stroke:#F2A93B
  classDef inv fill:#F4F7F7,stroke:#5F787F
  class F1,F2,G1,G2 ext
  class INV inv
```

**要点**：上架的**同一份元数据**分别流向两类节点，用途不同——丝路数港解决"被别人看见"，深数所解决"被交易撮合"。

---

## 图 4 · 合约阶段（含真实状态机）

```mermaid
stateDiagram-v2
  [*] --> draft: 买方发起申请 · 供方起草
  draft --> draft: 协商用途/留存/输出范围
  draft --> active: 双方签署 + SM3 哈希 + 上链存证
  active --> active: 合约下发至连接器 PEP
  active --> expired: 期限届满
  active --> revoked: 任一方解除
  expired --> [*]
  revoked --> [*]
```

```mermaid
flowchart LR
  A["买方申请使用"] --> B["供方审核"]
  B --> C["数字合约起草<br/>目的·期限·留存·输出范围"]
  C --> D["SM3 哈希<br/>+ 双方签署"]
  D --> E["合约 active<br/>+ 备案 + 上链存证"]
  E --> F["下发连接器 PEP"]
  F --> G{"任务准入校验"}
  G -->|"有有效合约"| H["放行"]
  G -->|"无合约 / 合约失效"| I["403 fail-closed<br/>任务根本不开始"]

  J["关键设计：拒绝者是院内策略执行点，<br/>不是平台管理员。"]
  I --- J

  classDef deny fill:#FBE9E4,stroke:#E4694F,color:#7A2E1E
  classDef ok fill:#E7F4F1,stroke:#0F6E6A
  class I deny
  class H ok
```

**这是全系统最有说服力的一环**：合规不是事后稽查，而是**运行时的硬约束**——没有合约，任务在物理上无法开始。

---

## 图 5 · 任务阶段（多中心计算 + 出域闸门）

```mermaid
flowchart TD
  A["发起 RWS 任务"] --> B["填写目标试验模拟方案<br/>入排/暴露臂/对照臂<br/>时间零点/洗脱期/协变量"]
  B --> C{"方案机器校验"}
  C -->|"不通过"| B
  C -->|"通过"| D["方案冻结 frozenAt<br/>+ SAP 声明 α/效能/样本量"]
  D --> E["派发至各院连接器<br/>pending"]

  E --> F1["A 院连接器<br/>running"]
  E --> F2["B 院连接器<br/>running"]
  E --> F3["C 院连接器<br/>running"]

  F1 --> G1["院内本地计算<br/>L1 描述 / L1.5 信号<br/>L2 比较 / L3 因果与生存"]
  F2 --> G2["院内本地计算"]
  F3 --> G3["院内本地计算<br/>TEE / 联邦学习 L4"]

  G1 --> H1["输出闸门<br/>小格抑制 · 效力警告"]
  G2 --> H2["输出闸门"]
  G3 --> H3["输出闸门"]

  H1 --> I["回传聚合量<br/>无行级数据"]
  H2 --> I
  H3 --> I

  I --> J["跨中心合并<br/>DerSimonian-Laird 随机效应<br/>森林图 + I²"]
  J --> K["completed / partial / failed"]
  K --> L["结果存证上链"]

  M["方案修订 → 新版本 + 旧版永久留痕"]
  D -.-> M
  M -.-> E

  classDef gate fill:#FBEFD8,stroke:#F2A93B
  classDef chain fill:#E7F4F1,stroke:#0F6E6A
  class H1,H2,H3 gate
  class L chain
```

**两种终止态要分清**：`partial`（部分中心完成）与 `failed`（失败）都保留在状态机里，因为多中心研究现实中经常不是全绿——**如实呈现比强行 completed 更重要**。

---

## 图 6 · 交易阶段（交付 · 结算 · 分账）

```mermaid
flowchart TD
  A["任务完成 · 结果可交付"] --> B{"按合约约定的交付形态"}
  B -->|"数据集授权"| C1["脱敏数据集交付"]
  B -->|"查询/结果交付"| C2["可用不可见 · 按查询计费"]
  B -->|"联合建模"| C3["模型参数/模型服务交付"]

  C1 --> D["计量计费"]
  C2 --> D
  C3 --> D

  D --> E["交易订单"]
  E --> F["结算<br/>SettlementRecord"]
  F --> G["按贡献分账<br/>SettlementLine"]

  G --> H1["各医院按贡献所得"]
  G --> H2["平台运营方所得"]
  G --> H3["公共/患者回馈"]

  F --> I["交易凭证 → 深圳数交所"]
  F --> J["审计摘要 → 丝路数港"]

  K["入表融资通道<br/>价值评估 → 资产入表 → 机构对接 → 质押融资"]
  H1 -.-> K

  L["闭环回流：分账与买方反馈 → 新数据产品 / 新场景"]
  G -.-> L
  L -.-> M["回到 ② 上架"]

  classDef ext fill:#FBEFD8,stroke:#F2A93B
  classDef loop fill:#E7F4F1,stroke:#0F6E6A
  class I,J,K ext
  class L,M loop
```

---

## 图 7 · 端到端时序（跨四方）

```mermaid
sequenceDiagram
  autonumber
  participant ORG as 机构<br/>(医院/药企)
  participant SP as 本空间控制面
  participant CON as 院内连接器
  participant SR as 丝路数港<br/>(区域功能节点)
  participant SZ as 深圳数交所<br/>(交易场所)

  Note over ORG,SZ: ① 注册
  ORG->>SP: 提交机构认证申请
  SP->>SR: 同步/检索主体注册
  SR-->>SP: 身份互认结果
  SP->>CON: 签发连接器证书 · 下发部署
  SP-->>ORG: 参与方 active

  Note over ORG,SZ: ② 上架
  CON->>CON: 本地资源接入 · 元数据抽取 · 分类分级
  CON->>SP: 上架数据产品（仅元数据）
  SP->>SR: 目录推送（一点发布·全域可见）
  SP->>SZ: 产品挂牌
  SR-->>SP: 目录同步回执
  SZ-->>SP: 挂牌结果

  Note over ORG,SZ: ③ 合约
  ORG->>SP: 申请使用某数据产品
  SP->>ORG: 供方审核（数据提供方）
  ORG->>SP: 签署数字合约（SM3 哈希）
  SP->>CON: 合约下发至 PEP
  SP->>SR: 合约备案存证

  Note over ORG,SZ: ④ 任务
  ORG->>SP: 发起 RWS 任务（TTE 方案）
  SP->>SP: 方案校验 → 冻结（版本留痕）
  SP->>CON: 派发至各参与中心
  CON->>CON: 院内本地计算（L1→L3）
  CON->>CON: 输出闸门（小格抑制/效力警告）
  CON-->>SP: 回传聚合量（无行级数据）
  SP->>SP: 跨中心合并（随机效应 + 森林图 + I²）
  SP->>SR: 审计摘要上报
  SP-->>ORG: 结果交付

  Note over ORG,SZ: ⑤ 交易
  SP->>SP: 计量计费 → 结算 → 按贡献分账
  SP->>SZ: 交易凭证与结算
  SP-->>ORG: 分账结果与入表通道

  Note over ORG,SZ: 不变量：原始数据出域 0 行 · 关键动作全程上链
```

---

## 图 8 · 状态机汇总（与代码一致）

| 对象 | 状态值 | 代码位置 |
|---|---|---|
| 机构认证 | `draft → submitted → approved \| rejected`（可驳回重提） | `OrgCertificationStatus` |
| 数据产品 | `active \| archived` | `DataProduct.status` |
| 数字合约 | `draft \| active \| expired \| revoked` | `ContractStatus` |
| 任务编排 | `pending \| running \| completed \| partial \| failed` | `RwsOrchestrationStatus` |
| 单中心作业 | `pending \| running \| completed \| failed` | `RwsAssignmentStatus` |
| 主体互认缓存 | `synced \| mapped \| ignored` | `InteropSubject.status` |

---

## 附 · Word / PPT 用的纯文本版（Mermaid 无法渲染时）

```
                    ┌─────────────── 丝路数港（区域功能节点）───────────────┐
                    │  主体注册 · 身份互认 · 目录同步 · 日志上报            │
                    └───────▲───────────────────────────▲─────────────────┘
                            │ 主体注册/互认              │ 目录推送 / 审计上报
                            │                           │
 ① 注册 ──▶ ② 上架 ──▶ ③ 合约 ──▶ ④ 任务 ──▶ ⑤ 交易 ──┴──▶ (回流) ──┐
   │          │           │           │           │                  │
 机构提交   连接器      数字合约     TTE 方案    计量计费             │
 认证申请   封装产品    用途写死     冻结派发    结算分账             │
   │          │           │           │           │                  │
 本空间     DataProduct  SM3 哈希   各院本地    按贡献分配           │
 审核       active      +上链      计算+闸门    SettlementLine       │
   │          │           │           │           │                  │
 SM2 CA    元数据推     下发 PEP    聚合回传    交易凭证 ──▶ 深圳数交所
 签证书    丝路数港     无合约      跨中心合并
           深圳数交所   → 403      森林图 + I²
                                                    │
                              ┌─────────────────────┘
                              ▼
                   新数据产品 / 新场景 ──▶ 回到 ② 上架

  贯穿不变量：原始数据出域 0 行 ｜ 关键动作全程上链存证
```

---

## 附 · 三处最容易被画错的地方

| 容易画错 | 正确画法 | 为什么 |
|---|---|---|
| 把丝路数港和深数所画成"二选一的分支" | 画成**两条并行的不同层次**：上架阶段同时流向两者 | 前者管注册与可见性，后者管交易与结算，不是替代关系 |
| 把"数据"画成在网络中流动 | 数据**永在院内**；流的是**元数据**（上架阶段）与**聚合量/计算结果**（任务阶段） | 这是全系统的第一性原理，图上必须体现，否则失去说服力 |
| 合约画成"走过场的一步" | 合约要画成**任务的前置闸门**，并画出 `403 fail-closed` 的分支 | 合规的价值在于"没有合约任务发不出去"，这是运行时强制而非文本承诺 |
