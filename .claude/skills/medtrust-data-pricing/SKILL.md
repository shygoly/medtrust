---
name: medtrust-data-pricing
description: >
  Use when pricing a MedTrust 数据产品/数据服务, valuing a dataset or cohort, designing or
  reviewing 贡献分账/收益分配 (settlement) across participating hospitals, or checking whether a
  price or split is compliant. Encodes a medical-data pricing theory (9-dimension value model;
  cost/income/market three methods; the legal price band; delivery-form choice; contribution-based
  three-layer settlement) and maps every step to MedTrust's real modules — catalog (`cp_data_product`),
  digital-contract (`Pricing`), settlement (`cp_settlement_record/line`), output-policy. Triggers:
  数据定价, 数据产品/数据服务定价, 数据资产估值, 队列/病例估值, 贡献分账, 收益分配, settlement 分账系数,
  定价是否合规/能否入表, 为什么这份数据值这个价.
---

# MedTrust 数据定价与分账

医疗数据定价的第一性原理（贯穿全篇）：**"一条数据"不是定价单元。真正的定价单元是"面向某个用途的可交付语义包"，其边际贡献随可得样本量急剧衰减、随组合完整度急剧上升。** 深度理论、公式推导、公版/现代/制度出处见 [reference/pricing-theory.md](reference/pricing-theory.md)（十部分 + 附录）。本文件是**落到 MedTrust 代码上的可执行版**。

## 三条不可违反的前提

1. **定价单元 = 面向用途的语义包，不是"条"。** 先定「买方 × 用途 × 交付形态」三元组，再定价；缺任一项无法定价。按"条"报价是头号反模式（高价值病例的价值会被切碎）。
2. **MedTrust 的交付形态天然是最合规、区间最宽的那两种。** 数据不出域 ⇒ 定价对象不是"卖数据集"，而是**卖查询/结果**（`aggregate_only`）与**卖贡献分成**（联邦建模）。这正是理论里的"主战场"，直接绕开"卖原始数据不赚钱"的成本地板陷阱。
3. **合规先于算钱。** 不合规的数据，价格无意义。定价流程第 2 步（合规预审）在任何算钱之前——对齐 TRUST.md 敏感字段分级与 `cp_data_product.classification`。

## MedTrust 现状诊断（这是"应用到我们系统"的核心）

| 环节 | 代码现状 | 与理论的差距 | 升级路径 |
|---|---|---|---|
| 计价条款 | `Pricing { model: 'per-record'\|'per-task'\|'subscription', amount, currency }`（`packages/database/src/control-plane` + 连接器 `domain/settlement.ts`） | `per-record` = 理论明令避免的"按条定价"，对高价值数据系统性贱卖 | 高价值数据禁用 `per-record`；用 `per-task`（=查询/结果计费）或走联邦分账。`amount` 应由下方**统一价格函数**得出，而非拍脑袋 |
| 分账 | `cp_settlement_record/line`，`收益占比 = 贡献占比`，且**贡献 = 队列规模（cohort size）单一代理**（`settlement.service.ts`） | 只实现了三层分账的**第一层（ρ 贡献）**，且贡献只用了 VolumeShare，漏掉质量与独特性 → 稀缺小样本中心被低估 | ① 贡献系数升级为 `η_i = QualityScore_i × VolumeShare_i × Uniqueness_i`（把稀缺度/质量并入，不只数量）；② 补第二层 σ 投入补偿、第三层 τ 公共回馈（ρ+σ+τ=1） |
| 价值维度 | `cp_data_product`: `classification` / `classificationTag` / `recordCount` / `productType` / `fhirSchema` | 只有零散字段，无统一价值密度 V | 用九维打分卡（下）把这些字段喂进 `V`；缺的维度（时效、代表性、独特性）需补为产品元数据 |
| 合规裁剪 | `classification` 分级 + `digital-contract` 用途/输出范围 + 连接器输出闸门 | 已有合规闸门，但未与定价上/下界联动 | 把合规成本计入价格地板、把制度上限计入价格天花板（见"合法区间"） |

> 一句话：**MedTrust 的分账台账结构是对的（按贡献、可上链、可审计），但贡献只用了"队列规模"这一个代理，且计价还停留在 per-record。这份 skill 的主要作用就是把这两处升级到理论要求。**

## 八步定价法（每步对应 MedTrust 落点）

1. **定义定价单元** — 明确「买方 × 用途 × 交付形态」。交付形态在 MedTrust = `output-policy` 预设：`aggregate_only`（查询/结果）/ `model_only` / `aggregate_and_model`（联邦）。⚠ 从"谁要用它做什么"出发，不从"我们有多少条"出发。
2. **权利与合规预审** — 授权链、伦理、去标识化、可交易层级。查 `cp_data_product.rightsConfirmed` + `classification` + TRUST.md 敏感字段分级。不合规 → 停，价格无意义。
3. **价值维度打分** — 填九维打分卡 → 得 `V`（价值密度）、`S`（稀缺乘数）、`A`（组合乘数）。
4. **成本法算地板** `P_floor` — 重置成本 + 风险成本 + 质量折价。医疗数据风险成本按**交易**计提，不按记录数（关键，否则小规模高价值数据定价被扭曲）。
5. **收益法算天花板** `P_buyer` — ΔR（买方增量收益）× 归属率 η × 捕获率 κ。⚠ 不做收益法 = 系统性贱卖，是医疗数据最常被跳过的一步。
6. **市场法校准** — 可比交易做 hedonic 回归得隐含价格 β_k。医疗可比交易稀缺 → 诚实标注置信度。
7. **定档与定价** — 三法交叉出区间 → 分档/捆绑（`productType` + 权利束）→ 议价力 θ 定成交价，写回 `Pricing.amount`。
8. **分账与留痕** — 三层分账（下）→ 写 `cp_settlement_record/line` → 上链存证（复用 attestation）→ 后续用途监控。

## 关键公式（可直接实现）

**统一价格函数（合法区间内的议价结果）：**
```
成交价 P* = 下界 + θ × (上界 − 下界)
  下界 = max( 成本地板 P_floor , 合规刚性成本 )
  上界 = min( 买方愿付 P_buyer , 制度上限 P_regulatory_cap )
  P_buyer = κ · η · Σ_t ΔR_t/(1+r)^t · S · A
  P_floor = ( 重置成本 × Π(1−δ_j) + 风险成本 ) × (1+最低毛利)
  为什么"几分钱"：ΔR≈0(被替代)、S≈1、A≈1、κ小
  为什么"上万"：  ΔR大(不可替代)、S×A高、κ大
```

**九维价值密度（几何加权，任一关键维=0 则清零）：**
```
V = V₀ · exp( Σ_{i=1..9} w_i · ln(d_i) ),  d_i∈[0.01,1], Σw_i=1
  d1 合规就绪  d2 组合完整  d3 标签质量  d4 稀缺度  d5 时效
  d6 人群代表性  d7 规模/功效  d8 可关联性  d9 独特性
  稀缺乘数 S = 1 + ln(N_ref/(N_avail+1)),  下限 1
  组合乘数 A = v(组合)/Σv(单模态),  多模态完整病例典型 2–5
```
权重按买方类型选（药企RWE / AI训练 / 保险精算三套，见 reference §3.2）。MedTrust 字段映射：`classification`+`rightsConfirmed`→d1；`fhirSchema` 模态数→d2；`recordCount`→d7；d5/d6/d9 目前缺，需补产品元数据。

**三层分账（MedTrust settlement 的升级目标）：**
```
R_i = R_deal × [ ρ·(η_i/Σηⱼ)  +  σ·(C_i/ΣCⱼ)  +  τ·公共 ]   , ρ+σ+τ=1
  建议 ρ=0.6–0.75(贡献) σ=0.15–0.25(投入补偿) τ=0.05–0.15(公共/患者回馈)
  贡献系数 η_i = QualityScore_i × VolumeShare_i × Uniqueness_i
              （严格版用 Shapley/β-Shapley，需可重训；MedTrust 数据不出域→用代理评分）
```
MedTrust 现状只实现了 `ρ=1 且 η_i=VolumeShare_i`。升级 = 把 `SettlementLine.contribution` 从"队列规模"改为三因子乘积，并加 σ/τ 两层。

## 合规闸门（算钱前必过，对齐制度与 TRUST.md）

```
□ 分类分级明确（是否含重要数据/敏感个人信息）— cp_data_product.classification/classificationTag
□ 授权链完整（患者单独同意/伦理/机构授权）— rightsConfirmed + 数字合约 purpose
□ 去标识化等级与再识别风险已评估 — 连接器 deidentifier + 风险成本 C_risk
□ 交付形态合法（原始数据能否出域？必须可用不可见？）— output-policy 预设
□ 定价模式正确（公共数据政府指导定价 / 企业·个人数据市场自主定价）
□ 分账符合"按贡献决定报酬"且有合约 — cp_digital_contract + settlement
□ 定价口径与入表口径分离（评估值不直接入账；财会〔2023〕11号）
□ 全程审计留痕 — audit + 上链存证
```

## 三个 MedTrust 最相关的反模式

- **对高价值数据用 `per-record`** → 价值被按条切碎。改 `per-task` 或联邦分账。
- **分账只按队列规模** → 20 例的极稀缺中心被当"零头"。把稀缺度/质量并入 η_i。
- **先谈价后审合规** → 谈成才发现不能出域。合规预审（第 2 步）前置。

## 深度与出处

需要公式推导、算例（普通门诊"几分钱" vs 罕见病"上万"的 6 数量级拆解）、Shapley 近似方法、制度原文要点、公版理论出处时，读 [reference/pricing-theory.md](reference/pricing-theory.md)。本 SKILL 是执行索引，reference 是完整依据。
