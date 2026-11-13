# Proposal

## Why

`task-browse` 已收齐列表与详情**页头/侧栏**，但 MDOP 作业详情页体仍是运维流水账：阶段表、片段哈希、凭证等默认铺开，研究结论（C3 合并结果）排在后半且 L1.5 等指标展开不足。以已走完的 `job-mwee2lv4`（标题 `26-11-13-04`）为例，平台侧已有 PRR/ROR/CI/`signal`，页面却几乎只显示类型原文与「a=…」一行；页头「已完成」与正文裸 `PURGED` 叙事分裂。需要把详情**结果区与信息分层**收成可验收契约，与浏览壳正交、不重做状态机。

## What Changes

- 定义作业详情页体的信息架构：**结论优先**（C3/分析结果）→ 执行进度（人话）→ 合规/证明与审计（默认可折叠或次级分区），禁止与结论同权默认全开技术 dump。
- 合并结果展示：分析类型可读名；失衡（L1.5）等 MUST 展开 payload 中已有的关键指标与信号（不低于旧 RWS 详情可读性）；有结果时不得仅用「N 行四格表」敷衍。
- 状态叙事：正文状态与 `task-browse` 四态徽章一致；`PURGED` 须可理解（中间制品销毁 ≠ 无结论；C3 仍在时须能看到结果）。
- 参与方/节点显示名（`participantLabel` 或等价）；加载/错误/无结果空态完备。
- `DESIGN.md` 登记 MDOP（及可复用的）任务详情结果区约定。

### 非目标

- 不改 MDOP 作业状态机、销毁策略或 C3 存证语义。
- 不重做 `TaskBrowseHeader` / 列表（已属 `task-browse`）。
- 不强制本期把 SecretFlow / 全部 RWS 详情一次性迁到同一组件（可先 MDOP，设计上预留复用）。
- 不新增外部 AI；结果解读面板仅调整位置/可见性，不改 AGT 边界。

## Capabilities

### New Capabilities

- `task-detail`: 控制台编排/联邦任务**详情页体**的呈现契约——结果区信息架构、分析指标可读展示、状态与销毁说明、运维细节分层。与 `task-browse`（列表 + 页头/侧栏）正交。

### Modified Capabilities

无。

## Impact

- Web：`apps/web/src/app/(console)/space/mdop/jobs/[id]/page.tsx` 为主；可能抽出结果区组件；复用 `participantLabel`、`mdopBadge`、既有 `ResultInterpretationPanel` / registration 面板。
- API：通常只读现有 `GET /mdop/jobs/:id` 的 `result`（platform delivery）；本期不强制新字段。
- 治理：`DESIGN.md` Detail 原型下任务详情结果区；单测覆盖结果视图模型（如 L1.5 指标抽取）。
- 依赖：假定 `task-browse` 已归档；页头继续用 `TaskBrowseHeader`。
