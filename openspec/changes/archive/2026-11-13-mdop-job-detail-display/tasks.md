# Tasks

## 1. 结果视图与展示

- [x] 1.1 实现 `mdop-result-view`（或等价）纯函数：分析类型可读名、`disproportionality` 指标行（count/PRR/ROR/CI/signal）；单测覆盖样本 payload（含 signal=true）；验证缺字段时列回退「—」且不丢已有指标
- [x] 1.2 抽出结果区组件并按骨架渲染：结论摘要 → 指标表 → 发布审查 → 解读；接入 MDOP 详情；验证有 C3 的 L1.5 作业不再仅显示「N 行四格表 a=…」
- [x] 1.3 SCRI/FL/registration 现有块挂入同一层 A 顺序（可不重写内部）；验证解读入口位于指标之后

## 2. 页体分层与状态叙事

- [x] 2.1 重组 `mdop/jobs/[id]`：层 A 结论置顶（有 result 时）→ 层 B 阶段进度 → 层 C 运维/审计默认折叠；验证首屏主路径先见结果而非片段哈希
- [x] 2.2 正文状态与 `mdopBadge` 四态一致；`PURGED` 次要说明 +「有 C3 仍展示」；验证成功销毁作业不表现为无结论取消
- [x] 2.3 阶段/见证/回执节点 `participantLabel`；ContractBundle 明细移入层 C；验证显示名可得时不单靠 URN

## 3. 空态与文档

- [x] 3.1 加载/错误/无 result 空态（按作业状态区分文案）；验证无 result 时有明确说明
- [x] 3.2 更新 `DESIGN.md`：任务详情结果区（结论优先、L1.5 指标、PURGED 说明）；验证与实现一致
- [x] 3.3 回归：用已走完 L1.5 作业（如含 PRR/signal 的 C3）浏览器对照；验证页头 `task-browse` 行为无回归

## Workflow follow-up

- Archive after review；主规格新增 `task-detail`。
- 可选后续：RWS 详情复用同一结果表组件；SecretFlow 详情挂同一分区骨架。
