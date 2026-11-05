# REGULATORY.md — 监管路径与合规资格契约（REG-x）

> **机器可校验的监管可接受性契约**。本册回答一个 TRUST 与 EVIDENCE 都不回答的问题：
> **同一份数据、同一个结论，能否被 FDA / MHRA / NMPA 接受为申报证据。**
>
> **锚点**（唯一权威，改动前先核原文）：
> FDA《Applications Covered by Section 505(b)(2)》 ·
> FDA《Considerations for the Design and Conduct of Externally Controlled Trials》(2023 草案) ·
> UK HMRs Reg 52 / 52B（原 Dir 2001/83/EC Art 10(3)） ·
> ICH E10《Choice of Control Group》 · ICH E9 / E9(R1) · ICH E6(R3) ·
> NMPA《真实世界证据支持药物研发与审评的指导原则（试行）》 ·
> NMPA《真实世界数据用于医疗器械临床评价技术指导原则》 ·
> 药监《真实世界数据支持药品安全性主动监测的研究设计和分析指导原则》（下称《指导原则》，RWS 方法学锚点在 EVIDENCE.md）
>
> **三册分工（勿混）**：
> - [TRUST.md](./TRUST.md) 管**数据可信**——威胁是泄露、重识别、信任虚标，控制点 `CTL-x`；
> - [EVIDENCE.md](./EVIDENCE.md) 管**结论可信**——威胁是偏倚、混杂、p-hacking、选择性报告，控制点 `EVD-x`；
> - **本册管合规资格**——威胁是"方法学正确但不被监管接受"，控制点 `REG-x`。
>   典型形态：结论算得对，但电子记录不被 21 CFR Part 11 承认、数据格式不是 CDISC、无 CSV 验证文档、
>   或申报路径的前提（参比制剂）根本不存在。**这三类失败互不覆盖**：EVIDENCE 全绿也可能 REG 全红。
>
> **读者**：注册事务 / 药物警戒 / 申办方统计师 / 平台产品负责人。
> **命名空间**：`REG-x` 与 `EVD-x` / `CTL-x` / `INV-x` / `D-x` / `FLOW-x` / `AGT-x` / `TD-x` 正交。
> **校验**：`node scripts/check-meta-docs.mjs`（已前置进根 `pnpm test`）。

---

## 1. 路径登记表

**申报路径不是可以自由选择的**。每条路径都有**法律前提**，前提不满足时"简化申报"从第一步就不成立。
本表的作用是：在投入任何数据工程之前，先确认产品落在哪一格。

| 路径 | 辖区 | 法律依据 | 硬前提 | 需提交的原始数据 | 与本仓适配 |
|---|---|---|---|---|---|
| 505(b)(2) | 美国 | FD&C Act §505(b)(2) | 存在 **listed drug**；申请人可引用 FDA 既有安全性/有效性认定与公开文献 | 桥接研究（差异影响 PK/PD 或疾病进程时必需）；专利认证（Paragraph IV 触发 30 个月遏制期） | 待前提确认 |
| hybrid | 英国 | HMRs Reg 52（UKMA(NI)）/ 52B（UKMA(UK)） | 活性成分与**参比制剂相同**，且符合四情形之一 | Module 4/5 **须含 appropriate original data**（不可仅引用） | 待前提确认 |
| hybrid | 欧盟 | Dir 2001/83/EC Art 10(3) | 同英国四情形 | 同上 | 待前提确认 |
| full / mixed | 英欧 | HMRs Reg 50 / Art 8(3) | 无（全量数据） | 完整药学 + 非临床 + 临床 | RWD 仅作支持性证据 |
| 附条件批准 | 中国 | NMPA 附条件批准程序 | 临床急需；已有替代终点或中期数据支持 | 上市后确证性研究承诺 | 中 |
| 乐城先行区试点 | 中国 | 国家药监局 + 海南省政府《临床真实世界数据应用试点工作实施方案》(2019) | 临床急需进口药械；在先行区内使用 | 区内真实世界研究数据 | **高** |
| 器械临床评价 | 中国 | NMPA《真实世界数据用于医疗器械临床评价技术指导原则》(2020) | 器械同品种/临床评价路径适用 | 真实世界数据可作临床评价资料 | **高** |
| 上市后安全性主动监测 | 中国 | 《指导原则》（本仓 RWS 方法学锚点） | 药品已上市 | 主动监测设计与分析 | **最高**（现行设计目标） |

**四条判读纪律**：

1. **505(b)(2) 与 hybrid 的前提是产品，不是平台。** 两者都要求存在参比制剂/listed drug（同活性成分、已过数据独占期）。
   若为全新分子，两条路均不成立，只能走 full application——此时 RWD 只能作**支持性证据**（见 REG-01）。
2. **hybrid 不是"引用即可"。** 英国指南原文要求 Module 4/5 包含 *appropriate original data*：
   引用既有证据的同时**必须**补原创数据，这正是"用既有证据补试验证据"的法律含义。
3. **外部对照臂（ECA）是设计要素，不是申报路径。** 它可以与任一申报路径组合，依据 ICH E10 与 FDA 2023 指南草案。
   **它不降低门槛，只提高门槛**：省掉同期对照的试验成本，换来必须把偏倚不确定性量化到监管可接受的程度。
4. **门槛最高的是注册级主要证据，最低的是上市后安全性监测。** 本仓当前设计目标（`EVIDENCE.md` 锚定的安全性主动监测）
   恰是门槛最低、政策最明确、最快产生监管价值的一格。

---

## 2. 监管要素覆盖矩阵

`承载` 非 `—` 时，须为反引号包裹的 `Type.field` 或已登记控制点 id（`EVD-xx` / `REG-xx`）；
`—` 必须配状态 `缺口`。**checker 强制**：`Type.field` 的字段名须在 RWS spec / DB 实体 / 编排器类型
三处之一检索得到（同 EVIDENCE §1 口径）；控制点 id 须在对应册中真实存在（防悬空引用）。

| # | 监管要素 | 依据 | 承载 | 状态 |
|---|---|---|---|---|
| 1 | 目标试验模拟框架·零时刻对齐 | ICH E10 §2.5 | `TteSpec.timeZeroRule` | 已承载 |
| 2 | 分析产物预先指定（防选择性报告） | FDA ECA 指南 | `RwsAnalysis.allowedArtifacts` | 已承载 |
| 3 | 暴露/结局操作性定义与识别算法 | FDA RWD 指南 | `ValidationMetrics.sensitivity` | 已承载 |
| 4 | 倾向评分变量预先指定并冻结 | FDA ECA 指南 | `RwsTaskEntity.frozenAt` | 已承载 |
| 5 | 方案版本与修订留痕 | ICH E6(R3) | `RwsTaskEntity.protocolVersion` | 已承载 |
| 6 | 统计分析计划（α / 效能 / 样本量假设 / 多重性） | ICH E9 | `SapPlan.multiplicityAlphaAdjustment` | 已承载 |
| 7 | 流行病学设计类型与选型理由 | 《指导原则》§2.5 | `RwsAnalysis.designType` | 已承载 |
| 8 | 未测量混杂稳健性分析随主结果报告 | FDA ECA 指南 | `RwsMetaPooledSuccess.unmeasuredConfounding` | 已承载 |
| 9 | 多中心异质性随合并结论报告 | ICH E9 §5.5 | `RwsMetaPooledSuccess.heterogeneity` | 已承载 |
| 10 | 中心级权重可复核（森林图可独立验证） | FDA ECA 指南 | `RwsMetaPooledSuccess.forest` | 已承载 |
| 11 | 缺失值机制与填补策略声明 | ICH E9(R1) | `EVD-11` | 部分承载 |
| 12 | 敏感性分析全报（声明项与回传项对账） | FDA ECA 指南 | `EVD-10` | 部分承载 |
| 13 | 因果方法按混杂结构选型（含 IV / G 方法） | 《指导原则》§3.3 | `RwsAnalysis.method` | 部分承载 |
| 14 | 金标准来源须为真实临床金标准 | FDA RWD 指南 | `EVD-05` | 部分承载 |
| 15 | 协变量按混杂结构分类（DAG） | 《指导原则》§2.8 | — | 缺口 |
| 16 | 定量偏倚分析（阴性对照 / 阳性对照） | 《指导原则》§2.8 | — | 缺口 |
| 17 | 外部对照臂可比性评估框架 | FDA ECA 指南 | — | 缺口 |
| 18 | 源数据可核查性（现场核查 vs 可用不可见） | ICH E6(R3) | — | 缺口 |
| 19 | 申报数据格式（CDISC SDTM / ADaM） | FDA / ICH M2 | — | 缺口 |
| 20 | 电子记录与电子签名合规资格 | 21 CFR Part 11 / EU Annex 11 | — | 缺口 |
| 21 | 计算机化系统验证与 GxP 质量体系 | ICH E6(R3) / GAMP 5 | — | 缺口 |
| 22 | 申报路径法律前提（参比制剂 / listed drug） | HMRs Reg 52B / §505(b)(2) | — | 缺口 |

**部分承载的四条口径**：

- 第 11 项：`MissingnessDeclaration` 已实装（机制 + 策略配对校验），但未按层级转必填，缺省仅告警。
- 第 12 项：声明字段与对账闸已就位，但**执行器尚未接线**——`validateRwsAnalysisLadder` 对非空
  `sensitivityAnalyses` 直接拒收（fail-closed），控制台禁用声明入口。这使 REG-07 成为**阻断项**。
- 第 13 项：值域仅 `psm | iptw | cox`；规范表 3 的 IV / G 方法无实现。ECA 场景下未测混杂往往只能靠 IV 补救。
- 第 14 项：L0 验证层与混淆矩阵 fail-closed 闸门已就位；但测试路径金标准为注入真值
  （EVIDENCE.md D-DATA-1 自认不得作为申报证据），生产路径须用医院本地金标准库并留验证报告。

---

## 3. 控制点登记（REG-x）

```yaml regulatory
id: REG-01
title: 申报路径法律前提须在数据工程投入前确认（参比制剂 / listed drug 存在性）
norm: [HMRs Reg 52B 活性成分须与参比制剂相同, FD&C Act §505(b)(2) 须存在 listed drug, Art 10(3) 四情形]
risk: 在无参比制剂/listed drug 的前提下按简化路径设计全部证据链，投入完成后才发现路径不成立，且 RWD 只能降级为支持性证据
enforcement:
  - ext:人工前置评审（产品/注册事务）；本册 §1 路径登记表为评审清单
spec: TODO
```

```yaml regulatory
id: REG-02
title: 电子记录与电子签名须满足 21 CFR Part 11 / EU Annex 11 方可提交
norm: [21 CFR Part 11 Subpart B/C 电子记录与电子签名, EU GMP Annex 11 计算机化系统]
risk: 全部结论正确但电子记录不被 FDA/MHRA 接受；系统审计轨迹、访问控制、签名与记录保留不满足监管要求
enforcement:
  - none
spec: TODO
```

```yaml regulatory
id: REG-03
title: 计算机化系统验证（CSV）与 GxP 质量体系文档
norm: [ICH E6(R3) GCP 数据完整性, GAMP 5 基于风险的 CSV, ALCOA+ 原则]
risk: 无 SOP、无 IQ/OQ/PQ 验证文档、无数据完整性正式声明；系统通过内部测试但不能通过监管审计
enforcement:
  - none
spec: TODO
```

```yaml regulatory
id: REG-04
title: 申报数据集须按 CDISC SDTM / ADaM 导出
norm: [FDA 数据标准要求, ICH M2 电子标准, CDISC SDTMIG / ADaMIG]
risk: 分析结论无法以监管要求的数据格式提交，申办方须在申报前重建数据集，平台产物无法直接进入 eCTD
enforcement:
  - none
spec: TODO
```

```yaml regulatory
id: REG-05
title: 外部对照臂可比性评估（人群 / 结局定义 / 时间零对齐 / 对照来源）
norm: [FDA ECA 指南草案 人群与结局可比性, ICH E10 外部对照的偏倚来源, 《指导原则》外部对照特殊考虑]
risk: 单臂试验的外部对照与试验臂不可比，效应量为构造而非发现；监管认为偏倚不可量化而拒绝该证据
enforcement:
  - none
spec: TODO
```

```yaml regulatory
id: REG-06
title: 定量偏倚分析（阴性对照 / 阳性对照）随主结果报告
norm: [《指导原则》§2.8 信息偏倚控制措施②, FDA ECA 指南 残余偏倚量化]
risk: 偏倚方向与量级无从验证，残余混杂的结论强度无法界定
enforcement:
  - none
spec: TODO
```

```yaml regulatory
id: REG-07
title: 敏感性分析执行器接线前，声明敏感性分析的任务不得进入执行
norm: [FDA ECA 指南 预先声明的敏感性分析, 《指导原则》§3.5 完整报告所有敏感性分析结果]
risk: 主分析缺少配套偏倚敏感性分析，ECA 申报的核心要求落空；若为凑齐要求而事后补做，则违反预先指定
enforcement:
  - ts:apps/api/src/compute-task/dto/rws-analysis-spec.ts#validateRwsAnalysisLadder
spec: apps/api/src/compute-task/dto/rws-study-protocol.spec.ts
```

```yaml regulatory
id: REG-08
title: 源数据可核查性方案（现场核查 vs 原始数据不出域）
norm: [ICH E6(R3) 源数据与稽查轨迹, NMPA 核查要求]
risk: 监管现场核查无法触达原始记录，"可用不可见"架构与核查要求的结构性冲突在申报阶段才暴露；数据出域至可信空间节点（C2）会**改变"原始数据不出域"这一前提本身**——性质从本地留存变为委托处理，须先确定数据控制者/处理者关系、书面委托协议、可核查性如何在加密执行环境下成立（见 D-TEE-1、DECISIONS D-MDOP-6 落地补注）。**出域物是密文信封而非明文**（见 REG-12）；但"加密传输"不改变委托处理的定性——判据是控制边界与处理者，不是传输态
enforcement:
  - ext:架构与方案前置设计（TRUST 出域闸 / 连接器本地留存）；本册仅登记该冲突为阻断项
  - ext:openspec/changes/tee-confidential-node（C2 已立变更、未实现）· TRUST P-CTL-8 · EVIDENCE 方法学不受影响
spec: TODO
```

```yaml regulatory
id: REG-09
title: 申报用途下金标准必须为真实临床金标准，不得使用注入真值
norm: [FDA RWD 指南 算法验证须以真实金标准为准, EVIDENCE.md D-DATA-1]
risk: 以合成/注入真值对拍得到的 Se/Sp 被当作真实流行病学精度提交，构成数据真实性缺陷
enforcement:
  - ts:apps/connector/src/domain/algorithm-validation/synthetic-gold-standard.ts#resolveGoldStandard
  - ext:EVIDENCE.md D-DATA-1 · TRUST CTL-12（演示产物不得用于监管申报）
spec: apps/connector/src/testdata/injected-ladder-e2e.spec.ts
```

```yaml regulatory
id: REG-10
title: 未测量混杂稳健性（E-value）须随 L3 主结果一并出具，并附不可单凭 E-value 判定因果的解释
norm: [FDA ECA 指南 残余混杂, VanderWeele & Ding 2017 E-value]
risk: 观察性因果结论被当作已控全部混杂提交，因果强度虚标（与 EVD-04 同源，本册从"监管可接受性"侧登记）
enforcement:
  - ts:apps/api/src/runtime/rws-orchestrator/causal-effect-merge.ts#evalueForRatio
spec: apps/api/src/runtime/rws-orchestrator/causal-effect-merge.spec.ts
```

```yaml regulatory
id: REG-11
title: 产物用途分级——监测级产物不得宣称注册级证据效力
norm: [《指导原则》适用边界（上市后安全性主动监测）, FDA ECA 指南 外部对照证据强度的固有限制]
risk: 以主动监测口径产出的结论对外宣称可支持注册申报，越级宣称导致整批证据可信度受损
enforcement:
  - ext:EVIDENCE.md §1 测试数据注（D-DATA-1）· TRUST CTL-12 · 人工评审（对外材料文案）
spec: TODO
```

```yaml regulatory
id: REG-12
title: 可信空间节点（C2）的用途绑定口径：密文出域、委托处理、密钥只释放给被度量代码
norm: [ICH E6(R3) 数据治理与委托, NMPA 核查要求, 《数据安全法》委托处理, IETF RATS 证明模型（参考）, NIST 机密计算威胁模型（参考）]
risk: |
  两种表述都会被监管或审计击穿，且互相掩盖：
  ① 说成「数据没出医院」——数据已离开控制边界，属**委托处理**；无书面委托协议、无控制者/处理者定义即不合规（与 REG-08 同源）。
  ② 说成「密文出域所以平台拿不到、不会滥用」——**加密只解决传输与静态机密性**；若平台同时持钥、或能改度量白名单，密文等同明文，「只能用于特定算法」不成立。
  另需如实登记 TEE 的保证边界：它保证的是「**解密密钥只释放给被度量、且在策略内的代码**」，不保证代码正确性、不保证语义用途（科研 vs 营销）、不保证可用性（运营方可拒绝服务/限流/断网）、不防护侧信道（内存访问模式）。
enforcement:
  - ts:packages/mdop/src/attestation/release.ts#evaluateKeyRelease
  - ts:packages/mdop/src/schema/data-envelope.ts#parseDataEnvelope
  - ts:apps/connector/src/mdop/node/entry-guard.ts#TrustedNodeEntryGuard
  - ext:DECISIONS.md D-TEE-1（运营权与密钥释放权分离；平台 MUST NOT 持钥）· TRUST.md P-CTL-8 · docs/deploy/部署硬件需求-v2.md §4.4.1
spec: TODO
```

## 4. 阻断项与推进顺序

**阻断项**（不解决则"监管级申报"整体不成立）：REG-01 · REG-02 · REG-03 · REG-04 · REG-05 · REG-07。

阻断性缺口分两类，**不可互相替代**：

| 类别 | 控制点 | 补齐方式 | 性质 |
|---|---|---|---|
| **方法学完备** | REG-05, REG-06, REG-07 + 矩阵 #15 #16 | 工程投入（ECA 可比性框架、阴性对照、敏感性分析执行器接线、DAG、IV/G 方法） | 可迭代、可测试 |
| **合规资格** | REG-02, REG-03, REG-04 | **组织级投入**（质量体系、SOP、CSV 验证、CDISC 映射、接受监管审计的能力） | 非加模块可解决 |

**推进顺序（顺序反了会白做）**：

1. **方法学完备**——先补 REG-07（敏感性分析执行器）、矩阵 #15 #16（DAG、阴性对照）、#13（IV/G 方法）、REG-05（ECA 可比性框架）。
2. **证明合规**——再补 REG-02 / REG-03 / REG-04（Part 11 + CSV + CDISC）。
3. **最后才是申报**——且**按门槛从低到高**：上市后安全性主动监测 → 器械临床评价 → 支持性证据 → 附条件批准/乐城试点 → 注册级主要证据 + ECA。

> **先做合规而不补方法学，等于把一个不够严谨的系统认证成合规系统——认证完了仍然不能用。**

**当前该做什么**：本仓现行设计目标（`EVIDENCE.md` 锚定的《指导原则》= 上市后安全性主动监测）
是门槛最低、政策最明确的一格。**不建议**以 505(b)(2) / hybrid 的注册级 ECA 作为首个目标——
它同时要求方法学完备与合规资格，两项都不具备。

---

## 附录：格式契约

`check-meta-docs.mjs` 按以下契约解析本文件：

1. **regulatory 块**：围栏 info-string 恰为 `yaml regulatory`。必填字段 `id` / `title` / `norm` /
   `risk` / `enforcement` / `spec`。
2. **id 格式**：`REG-<NN>`，全册唯一。
3. **enforcement token**：语法同 DOMAIN / TRUST / EVIDENCE 附录
   （`ts:路径#符号` | `py:路径` | `ui:路径` | `ext:说明` | `none`）；`ts:` 做符号级存在性校验。
   **缺口项写 `none`**，并以 `spec: TODO` 标记（降级为 warning，不阻塞）。
4. **spec**：相对仓根的测试路径；`TODO` 降级为 warning。
5. **§2 覆盖矩阵**：表头恰为 `| # | 监管要素 | 依据 | 承载 | 状态 |`。
   `承载` 中的引用有两种合法形式：
   - `` `Type.field` ``——`Type` 须属白名单（RWS spec / DB 实体 / 编排器类型），
     `field` 须在上述三类文件中检索得到；
   - `` `EVD-xx` `` / `` `REG-xx` ``——须在对应册中真实存在（**悬空引用报错**，防跨册失效）。
   `—` 必须配状态 `缺口`；状态只许 `已承载` | `部分承载` | `缺口`。
6. **§1 路径登记表与 §4 推进顺序不校验**（业务判断，非契约）。
