# Design

## Context

See proposal.md — Why。对照样本：`job-mwee2lv4-0b0f2490`（`applicant.project=26-11-13-04`），阶段全 `SUCCEEDED` → `PURGED`，`cp_mdop_delivery` platform 行仍有完整 C3（`disproportionality` + PRR/ROR/CI/`signal`）。现状页体见 `apps/web/src/app/(console)/space/mdop/jobs/[id]/page.tsx`：运维 Panel 先于结果；非 SCRI 仅 mono 一行。页头已用 `TaskBrowseHeader` + `mdopBadge`（`task-browse`）。旧 RWS 详情在 `orchestration-task-detail` 已展开 PRR/ROR，可作为结果表参照。

## Goals / Non-Goals

**Goals:**

- MDOP 详情主路径：结论 → 进度 → 运维/审计；L1.5 指标可读性对齐旧 RWS。
- 状态与销毁说明与四态一致；参与方显示名；空态完备。
- 结果区可抽视图模型 + 展示组件，便于单测与后续 RWS 复用。

**Non-Goals:**

- 不改 purge / delivery 持久化；不新增 C3 字段。
- 不重做页头/列表；不强制 SecretFlow 同页改造。
- 不改结果解读 AGT 边界（仅位置）。

## Decisions

### D1 — 三层分区（非强制 URL tab）

| 层 | 内容 | 默认 |
|----|------|------|
| A 结论 | C3 摘要 + 指标表 + 发布审查 + 解读 | 展开，置顶（有 result 时） |
| B 进度 | 阶段表（显示名、状态人话、错误） | 结论下展开 |
| C 运维/审计 | plan_hash、片段哈希、凭证、见证、回执链、Bundle 明细 | **默认折叠**或结论+进度之后的次级块 |

首版用「顺序 + `<details>`/折叠 Panel」即可，不必上路由 tab。失败作业：层 A 可显示失败原因摘要，仍先于哈希 dump。

### D2 — 结果视图模型（纯函数）

新增 `lib/mdop-result-view.ts`（名可微调）：

- 输入：`getMdopJob` 的 `result`
- 输出：`{ analysisLabel, summaryLine, rows[], signal?, kind }`
- `disproportionality`：每 bucket 一行 `key / count / prr / ror / prrCi / rorCi / signal`；缺字段则该列「—」，有则必显
- 分析类型表：`disproportionality` → 「失衡信号（L1.5）」等闭集；未知类型回退原文但标为次要

组件：`MdopResultPanel`（或 `TaskResultPanel`）只渲染该视图；SCRI/FL/registration 可暂时仍走现有分支，但挂在同一层 A 骨架下。

### D3 — 状态文案

正文「状态」行：主文案 = `mdopBadge` 四态中文；次行 mono = 原始 `status`（含 `PURGED`）。另加一句固定说明（仅 `PURGED`）：「中间制品已按策略销毁；下列为保留的合并交付物（若有）。」有 `rejectReason` 时在层 A/B 顶部用红色块展示。

### D4 — 显示名

阶段/见证/回执的 `node`：解析 participant id 后 `participantLabel`；完整 URN title 悬停。与列表一致。

### D5 — 合约信息去重

`TaskBrowseHeader` 侧栏已列合约摘要时，正文 ContractBundle 大表归入层 C（折叠），避免与侧栏双份抢视线。

### D6 — 加载与空态

- loading / error：优先 `AsyncBoundary`（或与 console Detail 一致的最小等价）
- `result == null`：按 `job.status` 文案分支——进行中「合并结果尚未就绪」；终态「无平台侧合并交付物」；勿空白省略

## Risks / Trade-offs

- [Risk] 折叠运维细节增加排障点击 → Mitigation：层 B 默认展开；层 C 折叠但一键可达。  
- [Risk] 只改 MDOP、RWS 仍两套结果 UI → Mitigation：视图模型先纯函数，组件名中性，tasks 记可选对齐。  
- [Risk] 未知 `analysisType` 无表 → Mitigation：摘要 + JSON 次要折叠，不假装有指标。

## Migration Plan

纯前端；无迁移。回滚即恢复长流水布局。

## Open Questions

- 层 C 用原生 `<details>` 还是 console 既有折叠样式——实现时跟 `DESIGN`/组件库选一种即可。  
- 是否本期把 RWS `orchestration-task-detail` 的 L1.5 表抽成共用——默认 **否**（MDOP 先落地），design 预留。
