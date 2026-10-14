## Why

现有联邦 RWS 只支持 **L1 描述统计**(队列计数 / 患病率 / AE 频次),连接器仅允许 `{count, rate}` 聚合出域(`rws-executor` + 输出闸门)。药企的四类核心诉求——上市后安全监测(失衡信号)、标签扩展与竞品对比(比较研究)、高级注册与外部对照(因果推断)、精准医疗与药物发现(预测建模)——都需要更高阶分析,但"原始行不出域、只有聚合过闸"的约束不能变。

本 change 在**同一约束**下把 RWS 提升为四级分析阶梯,复用既有单发通道与多轮 FL 轨道,新增跨站 meta 分析聚合器,并为高阶统计量补齐输出闸门。

## What Changes

- **`rws-compute` 扩展分析类型分类**,新增四档估计量(均在连接器 TEE 内本地计算,只吐充分统计量):
  - **L1.5 失衡信号**:每站输出 drug×event 的 2×2 计数,中心汇总 PRR / ROR / 信息成分(IC)。
  - **L2 比较**:分层 2×2 → Mantel-Haenszel 合并 OR/RR;或局部 logistic → β + 协方差。
  - **L3 因果**:站内 PSM/IPTW → 局部 ATE + SE;局部 Cox → HR + SE;可选 pooled GLM(迭代)。
  - **L4 预测**:联邦 XGBoost / SecureBoost / FedAvg,复用现有 `fl-prediction` 轨道。
- **两种联邦执行模式确立为一等概念**:模式 A(本地全量 + 中心随机效应 meta,单发,复用现有 RWS 通道);模式 B(迭代联邦拟合,多轮,复用 SecretFlow FSM + Python agent)。
- **新增 `federated-meta-analysis` 能力**:控制面对站点级效应量(β / HR / ATE + SE/协方差)做随机效应合并,产出 pooled 效应 + 异质性(I² / τ²)+ 森林图数据。这是模式 A 的中心聚合器。
- **`usage-control` 输出闸门增强**:从小单元格抑制扩展到——效应量小样本分层抑制;生存曲线尾部最小在险数 + KM 分箱(防末段单点重识别);模型产物差分隐私(ε 预算)+ 成员推断防护;新增 `allowedArtifacts` 类别(`disproportionality` / `effect_estimate` / `hazard_ratio` / `km_curve` / `meta_pooled` 等)。
- 设计上 L3 采用**目标试验仿真(target trial emulation)**作为因果研究的方法学框架(对齐 FDA/EMA 外部对照 RWE 现行实践)。

无 **BREAKING**:L1 现有行为与产物不变,四级阶梯为纯增量。

## Capabilities

### New Capabilities
- `federated-meta-analysis`: 控制面对多站点效应量的随机效应 meta 合并(β/HR/ATE 汇总、异质性 I²/τ²、森林图数据),作为模式 A 的中心聚合器;输入为各连接器过闸后的站点级效应量,输出为 pooled 效应,全程不接触个体行。

### Modified Capabilities
- `rws-compute`: 连接器本地分析从 L1 描述扩展到 L1.5/L2/L3/L4 估计量,并确立模式 A/B 两种联邦执行路径。(当前定义于未归档的 change `federated-data-space-rws`,本 change 的 delta 叠加其上,归档时统一 reconcile。)
- `usage-control`: 输出闸门从小单元格抑制扩展到效应量/生存尾部/模型产物(DP)的抑制规则,并扩充 `allowedArtifacts` 白名单类别。(同上,叠加于 `federated-data-space-rws`。)

## Impact

- **代码**:
  - `apps/connector` — `rws-executor`(新估计量)、`output-gate`(新抑制规则)、`connector-task-runner`(analysis 类型路由)、`fl-prediction/*`(L4 收尾)。
  - `apps/api` — `runtime/rws-orchestrator`(新增 `MetaAnalysisService`)、`compute-task` DTO(analysis 类型 + artifact 白名单校验)。
  - `apps/agent` — 复用多轮 FL/LoRA 轨道 + `HeSecureAggregator` + DP-SGD(模式 B / L4)。
- **依赖**:需评估 Mantel-Haenszel、随机效应 meta、局部 Cox 拟合用现有栈手写还是引入轻量统计库。
- **监管对齐**:L3 以 TTE 为设计框架;所有 RWE 出域产物须有 spec 留痕(等保 + RWE 申报)。
- **外部阻塞**:药物警戒岗需确认"信号检测 vs 队列疗效"优先级——决定 L1.5 与 L2/L3 的先后。
