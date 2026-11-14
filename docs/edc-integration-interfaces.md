# MedTrust ↔ EDC 接口清单（可信空间取哪一段，EDC 保留哪一段）

定位前提：**MedTrust 不替代 EDC**。EDC 保有 eCRF 录入、SDV、query 管理、医学编码、锁库、稽查轨迹与电子签名；
MedTrust 只接**上游（eSource 采集 / 可行性探索）**与**下游（出域分析 / 申报数据集生成 / 存证）**。

因此接口设计只有一条主线：

> **唯一交换格式 = CDISC ODM（1.3.2 的 `Metadata` / `Snapshot` / `Transactional` 三个 FileType，向 ODM 2.0 XML+JSON 过渡）；
> 唯一语义 = CDISC CT（CDASH → SDTM → ADaM）+ MedDRA / WHODrug；
> 唯一传输协议族 = REST+JSON（厂商 API）/ ODM-XML over HTTPS / 文件投递（SFTP·MFT·AS2）。**
> 不新造格式，不做"字段级对齐"——对齐单位永远是 ODM 的 `ItemGroupDef` / `ItemDef` / `CodeList`。

---

## 1. 接口全表（按面分组，A–G）

方向栏：`E→M` EDC 到可信空间；`M→E` 可信空间回写 EDC；`双向`。

### A. 元数据面（建库 / 映射 / 申报注释）

| # | 接口 | 方向 | 载荷 | 载体 | MedTrust 侧落点 |
|---|---|---|---|---|---|
| A1 | 试验设计摄取（Casebook → ODM Metadata） | E→M | `MetaDataVersion`：`ItemGroupDef`（访视/表单/域）× `ItemDef`（字段）× `CodeList`（CT 版本）× `StudyEventDef` | Veeva CDE（Casebook Design Export，JSON 结构遵 ODM）/ Rave ODM Adapter / Castor ODM export / REDCap `exportProjectXml` | `apps/connector/src/domain/catalog-product.ts` + `data-product-local-source.ts`（把设计登记为数据产品） |
| A2 | 变量可得性回推（Feasibility → 建库） | M→E | CDASH 变量 × 站点 × {可得性 yes/no、缺失率、时间窗、粒度的单位} | 文件（CSV/XLSX）/ ODM Metadata 注解版 | `missingness.ts`（缺失画像）+ `cohort-definition.ts`（入排可执行性）→ 导出可行性包 |
| A3 | 注释 CRF / Define-XML 生成 | M→E | `define.xml`（Define-XML 2.1）+ 注释版 CRF | 文件投递 | REG-04 落地点（当前 `spec: TODO`），建议新增 `packages/cdisc` |

### B. 数据面（eSource 与院内数据流向 EDC）

| # | 接口 | 方向 | 载荷 | 载体 | 备注 |
|---|---|---|---|---|---|
| B1 | EHR → eCRF 预填 | M→E | ODM `FileType="Transactional"`，按 `SubjectData`/`FormData` 增量投递 | EDC ODM import / IHE QRPH **[CRD]**（Clinical Research Data，Rev 3.2 TI，以 ODM 文档供数） | 投递前必须 `deidentifier.ts` 之外再做 **受试者标识映射**：`SubjectKey` 用站点内假名，原标识留在 `local-store.ts` |
| B2 | FHIR → ODM 变换 | M→E | Patient↔`SubjectKey`、Encounter↔`StudyEventData`、Observation↔`ItemGroupData`(LB/VS/EG)、QuestionnaireResponse↔`FormData`(ePRO)、AdverseEvent↔AE | 院内 FHIR R4/R5 | 已有 `apps/api/src/fhir/transforms/{patient,observation}.transform.ts`；Vulcan 加速器与 CDISC Healthcare Link 是同层参考 |
| B3 | 第三方数据加载（Lab / ECG / 影像 / ePRO 设备） | E→M 或 M→E | ODM `ItemGroupData`（LB/EG）+ 原始件 | 中央实验室 SFTP、aECG XML、DICOM | 只做"到 ODM 的规范化"，不做 EDC 的 Lab 范围管理 |
| B4 | 出域闸（唯一允许出域的形态） | M→出域 | 聚合值 / 去标识 ODM Snapshot | 经 `output-gate.ts`（小细胞抑制 + 行级阻断） | 红线：含受试者标识的 ODM 不经任何跨域边（TRUST `raw-local`） |

### C. 分析面（EDC → 可信空间的数据授权提取）

| # | 接口 | 方向 | 载荷 | 载体 | 备注 |
|---|---|---|---|---|---|
| C1 | 锁库快照提取 | E→M | ODM `FileType="Snapshot"` + `AuditRecord` + `MetaDataVersion@OID` | 厂商 Jobs/Export（Veeva `Data and Definition Export` 已废弃 → 改 `casebook_design_export__v` + 数据 Job；Rave RWS） | 快照哈希上链（`blockchain` 存证）= "分析数据集冻结"证据 |
| C2 | 分析就绪数据集交付 | M→申办方/监管 | SDTM/ADaM：`Dataset-XML` + `define.xml`（+ FDA 侧 XPT） | eCTD 递交包 | REG-04；国内 eCTD 自 2021 年分阶段实施，SDTM/ADaM + define 随递交成为事实要求 |
| C3 | 结果回收（TLF / 分析集回写） | M→E | 分析结果表 + 程序 + 日志 | 文件 + 哈希 | 与 `result-endorsement.ts` 对齐 |
| C4 | 质量画像（探索用，只读旁路） | E→M | 行×列剖面、缺失模式、访视窗偏差、query 周转 | C1 的 ODM Snapshot | `data-audit.ts` / `missingness.ts`；**这是"可信空间用于数据质量探索"的主入口** |

### D. 安全性 / 编码 / 术语面

| # | 接口 | 方向 | 载荷 | 载体 |
|---|---|---|---|---|
| D1 | SAE 外发 | E→安全库（MedTrust 只观测不接管） | E2B(R3) XML | Veeva `Safety Follow-Up Scan` Job / Argus 接口；MedTrust 侧只取"已发送"状态作质量指标 |
| D2 | 编码字典版本 | 双向 | MedDRA（版本+层级）、WHODrug Global（B3/C3/DDD） | ODM `CodeList` 的 `def:StandardName/Version` |
| D3 | 术语映射 | 双向 | LOINC / SNOMED CT（RWD 侧）↔ CDASH 变量（EDC 侧） | 映射表 + NCI EVS CDISC CT 版本锁定 |

### E. 协议面（怎么连）

| # | 通道 | 适用 | 要点 |
|---|---|---|---|
| E1 | REST + JSON | Veeva Vault CDMS EDC API（v26.x）/ Rave Web Services / Castor / Medable | OAuth2 `client_credentials` + 站点级 scope；分页 + Job 轮询 |
| E2 | ODM-XML over HTTPS | OpenClinica、Castor、Rave RWS 载荷、国产 EDC（Clinflash / 百奥知 / 太美 / Viedoc，逐家核实） | XML 命名空间 `http://www.cdisc.org/ns/odm/v1.3`；`ds:Signature`（XML-DSig） |
| E3 | 文件投递 | 定期全量/增量 | SFTP / MFT / AS2；文件名与清单（manifest）必须带 `MetaDataVersion@OID` + sha256 |
| E4 | 轮询合成事件 | EDC 普遍无 webhook | 用 Job 状态 + Snapshot 差异比对合成 `query.created` / `subject.enrolled` 事件 |
| E5 | HL7 v2 / FHIR Subscription | 院内 HIS→connector | 只到 connector 边界，不进跨域边 |

### F. 治理面（决定这套接口能否用于申报）

| # | 接口 | 方向 | 内容 |
|---|---|---|---|
| F1 | 身份与授权 | 双向 | MedTrust `participant-identity`（SM2 CA）↔ EDC 用户/角色；授权粒度落到 `study × site × 域`，由 `digital-contract.ts` + `policy-enforcement.ts` 执行 |
| F2 | 稽查轨迹对拍 | 双向 | EDC 的 `AuditRecord`（`UserRef`/`DateTimeStamp`/`ReasonForChange`/`SourceID`）导出 ↔ MedTrust 存证哈希；两侧必须能逐条对上，否则不构成 Part 11 / 《药品记录与数据管理要求》证据 |
| F3 | 电子签名 | 双向 | ODM `ds:Signature` + 时间戳；Part 11 Subpart C、EU Annex 11 |
| F4 | 版本冻结 | 双向 | `MetaDataVersion@OID` + Snapshot 哈希 + 生成程序版本 = 可复现三元组 |
| F5 | 可核查性通道 | 监管→院内 | **REG-08 阻断项**：现场核查需触达原始记录。接口层必须先定"核查视图"（谁、在哪、看到什么），再定数据是否出域 |

---

## 2. 主流 EDC 的实际接口能力（照抄合同前的核实清单）

| 产品 | 设计导出 | 数据导出 | ODM 导入（eSource 写入） | API |
|---|---|---|---|---|
| Veeva Vault CDMS | Casebook Design Export（JSON，遵 ODM 结构，`casebook_design_export__v`） | Jobs Management 端点族（Form/Event/Subject Progress Listing、Query Detail Listing）；旧 `Data and Definition Export` 已废弃 | 需核实（Studio/ODM import） | REST，版本化（26.2 GA / 26.3 Beta），另有 CDB API、DQS API |
| Medidata Rave EDC | Rave ODM Adapter | Rave Web Services（RWS） | Rave ODM Adapter（需许可） | HTTP + ODM XML 载荷 |
| Castor EDC | ODM export | ODM / CSV | **ODM import 原生支持** | REST |
| REDCap | `exportProjectXml`（整项目 ODM XML） | 同左 + CSV/JSON | 支持 ODM XML 导入 | token 制 REST（`content=odm\|metadata\|record\|file`） |
| OpenClinica | ODM | ODM / 自定义 | 支持 | REST + ODM |
| Oracle Clinical One / InForm | 以合同为准 | 以合同为准 | 以合同为准 | REST；InForm 旧线走 Adapter/ODM |
| 国产（Clinflash、百奥知 BioKnow、太美 TrialOS、Viedoc、医云） | 多数支持 ODM 1.3.2 导出 | ODM / Excel | 逐家核实 | 部分有开放 API，多数靠文件 |

> **命名冲突必改**：本仓 `RWS` = Real World Study；Medidata 的 `RWS` = Rave Web Services。
> 接口文档、代码标识、契约字段里必须一分为二（建议 MedTrust 侧改名 `rws-study` / `rave-ws`），否则工程与商务沟通都会串。

---

## 3. 三种部署形态（按 EDC 侵入度递增）

1. **旁路只读（P0，零 EDC 改造）** —— EDC 定期导出 ODM `Snapshot` + `Metadata` → 院内 connector → 质量画像 + 可行性。
   产物：变量可得性报告、缺失/访视窗/query 画像、可入组人数上界。**这就是"可信空间探索数据质量与可行性"的全部所需。**
2. **前置写回（P1，需 EDC 支持 ODM import）** —— connector 在院内生成 `Transactional` ODM → EDC 摄取 → 仍需人工 SDV。
   前提：eSource 与 SDV 流程要重新定义（哪些字段免 SDV、SDV 的对象变成"映射程序 + 原始件"），这不是接口问题而是 SOP 问题。
3. **共库不出域（P2，与 REG-08 冲突需先解）** —— EDC 数据落 `ConnectorDataSource`，MedTrust 只带聚合出域。
   `tee-confidential-node`（C2）一旦启用，数据控制者/处理者关系改变，核查可及性必须重新论证。

---

## 4. 分期与判据

| 期 | 交付 | 通过判据 |
|---|---|---|
| P0-1 | ODM `Metadata` 解析器 + 设计登记为数据产品 | 任一厂商 ODM Metadata 进 → 生成 `ItemGroupDef/ItemDef/CodeList` 目录，round-trip 无损 |
| P0-2 | ODM `Snapshot` 摄取 + 质量画像 | 缺失模式 / 访视窗偏差 / query 周转 三项指标对同一快照可复现 |
| P0-3 | 可行性回推包（CDASH × 站点 × 可得性） | 申办方可直接据此改 CRF；字段级"不可得"有明确原因码 |
| P1-1 | `define.xml` 生成（Define-XML 2.1） | REG-04 转绿：`check:meta` 有 `spec` 指向实现 |
| P1-2 | `AuditRecord` 双向对拍 | 抽 100 条 EDC 稽查记录，哈希与存证逐条一致 |
| P2 | eSource 回写 + E2B(R3) | 与一家 EDC 厂商签接口附件跑通端到端 |

---

## 5. 参考

- CDISC ODM（1.3.2 / 2.0 XML+JSON）与 Define-XML：<https://www.cdisc.org/standards/data-exchange/odm>
- IHE QRPH [CRD] Clinical Research Data Suppl Rev 3.2 TI：<https://www.ihe.net/uploadedFiles/Documents/QRPH/IHE_QRPH_Suppl_CRD_Rev3.2_TI_2015-10-27.pdf>
- CDISC Healthcare Link（EHR→SDTM 的 ODM 变换）：<https://www.cdisc.org/system/files/all/standard/HealthcareLinkUserGuide-23Oct2014fin_0.pdf>
- HL7 Vulcan 加速器（FHIR → 研究；含 eSource / SDTM 自动化方向）：<https://confluence.hl7.org/display/VUL/Vulcan+Accelerator>
- Veeva Vault CDMS EDC API（Casebook Design Export 遵 ODM 结构）：<https://developer-cdms.veevavault.com/rn/24.1/>
- Medidata Rave ODM Adapter / Rave Web Services：<https://www.medidata.com/wp-content/uploads/2019/01/Remote-Outline-Medidata-Rave-ODM-Adapter-Training-Workshop-ENG.pdf>
- Castor CDISC ODM 导入：<https://helpdesk.castoredc.com/hc/en-us/articles/27218112426013-Do-you-support-CDISC-ODM-format-for-importing-data>
- i-HD eSource Scale-Up Task Force 年报（EHR-to-EDC / eSource 落地现状）：<https://www.i-hd.eu/uploads/eSource/Publications/eSource-Annual-Report-2025_Final-July-18.pdf>
- NMPA《临床试验数据管理工作技术指南》（2016 年第 112 号通告）；《临床试验的电子数据采集技术指导原则》（2014）；《药物临床试验质量管理规范》（2020 年第 57 号）；《药品记录与数据管理要求（试行）》（2020）
- 仓内：[`REGULATORY.md`](../REGULATORY.md) REG-02/03/04/08 · [`TRUST.md`](../TRUST.md) 出域闸 · [`DOMAIN.md`](../DOMAIN.md) 连接器实体 · [`docs/omop-cdm-onboarding.md`](./omop-cdm-onboarding.md)（RWD 侧另一套语义，与 CDISC 并存）
