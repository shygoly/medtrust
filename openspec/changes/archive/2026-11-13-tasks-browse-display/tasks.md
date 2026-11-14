# Tasks

## 1. P0 — 标题、状态、MDOP 行

- [x] 1.1 实现 `taskDisplayTitle`（含 MDOP project 占位过滤）与单测：真实 project 优先、占位回退 purpose、旧通道 title；验证测试通过
- [x] 1.2 扩展 MDOP list 摘要/`TaskRow` 映射（applicantOrg、consumerId、可推导的 providerCount）；验证 org 存在时发起方不为「—」、假 0 连接器 chip 不出现
- [x] 1.3 修正 `mdopBadge`（PURGED/CLOSED 等终态 ≠ running）并单测；验证 PURGED 主徽章不是「进行中」
- [x] 1.4 `/space/tasks` 行 UI：主标题用 displayTitle；单一主状态徽章；去掉与标题重复的目的 chip；验证填「肾内科…」类标题出现在列表主标题
- [x] 1.5 MDOP 详情页头临时改用同一 displayTitle（完整壳在 P2）；验证列表与详情标题规则一致

## 2. P1 — 可读名与页头

- [x] 2.1 列表发起方显示名（共享 helper 或 API 附带，失败回退 id）；验证有登记名时不裸奔 id 为唯一主文案
- [x] 2.2 创建时间本地 `YYYY-MM-DD HH:mm`；验证列表不再只显示生 ISO
- [x] 2.3 `/space/tasks` PageHeader 补 title；验证页头有可读标题

## 3. P2 — 共用详情壳与历史标记

- [x] 3.1 抽出共用任务浏览页头组件（displayTitle、通道、归一状态、发起方、时间）；RWS/L4、MDOP、Federated 详情接入；验证三处页头字段契约一致
- [x] 3.2 合约侧栏改为可读摘要（目的/产品名优先，id 次要）；验证不再仅超长 id 作为唯一主文案
- [x] 3.3 旧通道只读历史任务在列表加「历史」标记；验证与现行 MDOP 行可区分
- [x] 3.4 `DESIGN.md` 登记任务 ListCard、状态映射、详情壳；验证与实现一致
- [x] 3.5 跑相关单测/lint；浏览器对照：标题、PURGED、发起方、三通道页头；验证无回归分面/入站/轮询

## Workflow follow-up

- Archive after implementation and review; main specs gain `task-browse`.
- Optional P3（另立 change）：MDOP 正式 `title` 字段，停止用 `applicant.project` 冒充标题。
