# Proposal

## Why

`mdop-job-detail-display` 已把详情做成「结论优先」，并修好 L1.5 失衡表的可读展开；但同页其它分析类型仍晦涩：配对队列几乎只有「队列 n=…」、联邦预测把 `auc=`/`modelHash` 当主文案、外对照注册堆 Estimand/SMD/PS 等 jargon、SCRI 只有分层计数而无效应解读。研究者扫读结论时仍要把缩写当密码解。需要把**多分析类型结果可读性**收成可验收契约，顺序补齐缺口，不重做页体骨架或计算语义。

## What Changes

按优先级扩展详情结果区（层 A）的可读呈现，不改 C3 字段语义、不改输出闸门：

1. **配对队列（`paired-cohort`）**：把 payload 中已有的聚合计数（队列规模、暴露、结局、暴露且结局等）展开为可读指标表或等价结构，MUST NOT 仅用「队列 n=…」敷衍。
2. **联邦预测（`fl-prediction` / L4）**：聚合与各方指标用中文标签呈现；摘要给一句面向研究者的结论（如轮次完成度 + 主指标方向）；模型哈希等技术指纹 MAY 次要展示，MUST NOT 作为唯一主文案。
3. **外对照注册（`external-control-registration`）**：在既有诊断面板上为 Estimand / SMD / PS / EES / 缺失机制等提供悬停或图例级术语注解；协变量与效应量保持可得数值，主文案偏向可读。
4. **疫苗 SCRI（`vaccine-scri`）**：在分层计数之上补充效应解读（如风险期相对对照期的方向/比值或「不可估计」说明，以 payload 已有字段为限）；分层键尽量可读。

### 非目标

- 不改 MDOP/RWS 状态机、C3 存证、发布审查算法或节点内计算。
- 不强制本期把患病率 / 因果 PSM / 生存等尚未有专用 C3 视图的类型一次性做完（可后续增量）。
- 不重做 `task-browse` 页头/列表；不新增外部 AI；结果解读面板仅可受益于更清晰的事实区，不改 AGT 边界。
- 不发明 payload 中不存在的效应量；缺字段时回退「—」或「不可估计」，不得用 0 冒充。

## Capabilities

### New Capabilities

无。本 change 扩展详情呈现能力，不另起 capability 名。

### Modified Capabilities

- `task-detail`: 在既有「结论优先 / L1.5 指标展开 / 结果区内阅读顺序」之上，**ADDED** 配对队列、联邦预测、外对照注册、SCRI 的结果可读要求（表头/摘要白话、术语注解、效应一句）。前提：`mdop-job-detail-display` 已引入（或即将归档同步）主规格中的 `task-detail`；本 change 写 delta，不重复其基线需求。

## Impact

- Web：`mdop-result-view` / `MdopResultPanel`、`ScriExtras` / `FlExtras`（`mdop/jobs/[id]`）、`registration-result-panel`（及 `registration-result-view` 文案辅助）；单测按类型补样本 payload。
- API：只读现有 `GET /mdop/jobs/:id` 的 `result`；本期不强制新字段。
- 治理：`DESIGN.md` 任务详情结果区补「多分析类型可读」约定；与 `task-browse` 正交。
- 依赖：建议先归档/同步 `mdop-job-detail-display`（或并行时以该 change 的 `task-detail` 为基线），再 apply 本 change。
