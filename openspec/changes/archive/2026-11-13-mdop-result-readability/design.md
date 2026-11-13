# Design

## Context

基线：`mdop-job-detail-display` 已落地层 A 骨架与 L1.5 表；本 change 只补 **paired-cohort / fl-prediction / external-control-registration / vaccine-scri** 的可读性。对照实现：`mdop-result-view.ts`、`mdop-result-panel.tsx`、`mdop/jobs/[id]` 内 `ScriExtras`/`FlExtras`、`registration-result-panel.tsx`。服务端已有解读事实逻辑可参照：`apps/api/src/result-interpreter/c3-facts.ts`（配对粗率方向、`scriRelativeIncidence`），Web **不得**直接 import API 包；纯函数可在 `apps/web/src/lib` 镜像或抽极小副本。

## Goals / Non-Goals

**Goals:**

- 四种分析在层 A 均有：可读摘要一句 + 指标/诊断表 + 必要术语说明；缺字段「—」/「不可估计」，不伪造。
- 复用既有视图模型模式（纯函数 → 面板），单测按类型覆盖样本 payload。
- `DESIGN.md` 补「多分析类型结果可读」一句约定。

**Non-Goals:**

- 不改 C3 schema、合并算法、SCRI 窗口定义、注册诊断判定阈值。
- 不本期做患病率 / PSM / 生存等其它类型专用表。
- 不抽跨包 shared 库（除非实现时发现重复不可接受；默认 Web 侧镜像纯函数）。
- 不改结果解读 AGT 边界。

## Decisions

### D1 — 扩展 `mdopResultView`，按 kind 出摘要；表体可分组件

| kind | 摘要 | 主表/块 |
|------|------|---------|
| `paired-cohort` | 队列人数 + 粗率方向一句 | 四计数可读行（队列 / 暴露 / 结局 / 暴露且结局） |
| `fl-prediction` | 轮次 + 主指标（优先 AUC）一句 | 中文标签指标 dl + 各方表 |
| `vaccine-scri` | 风险/对照期窗口人话 | 分层表增加 RI（或不可估计）列；复用窗口文案 |
| `external-control-registration` | 仍由 `RegistrationResultPanel` 承担 | 术语 HELP 映射 + 效应/缺失机制中文 |

`MdopResultPanel` 对 paired 渲染表；SCRI/FL 继续 children extras，但 extras **改文案与列**，摘要由 `mdopResultView.summaryLine` 统一。

**备选**：各类型独立 `*-result-view.ts` → 否，先扩一个文件，避免四套骨架；registration 已独立保留。

### D2 — 配对队列：与解读事实同源语义

展示计数与方向句对齐 `pairedCohortFacts`：由四计数推导未暴露与粗率；组空则「无法比较」。不在 UI 宣称混杂调整或显著性。

### D3 — SCRI：镜像 `scriRelativeIncidence`

Web 侧移植相对发生率 + Clopper-Pearson 换算（或等价简化：仅点估计+方向，CI 与 API 一致为佳）。窗口天数由 `windows.risk/control` 两端差绝对值得到。`suppressed` 行不显示 RI。摘要必须含 `windowLabel` 式风险/对照期。

**备选**：只显示风险/对照事件比、不算 RI → 弱于 spec「相对发生率」，否决。

### D4 — FL：标签闭集 + 哈希降级

`METRIC_LABELS`: auc→AUC（区分度）、f1→F1、precision→精确率、recall→召回率、accuracy→准确率。主摘要：`轮次 a/b · 合并 AUC x.xx`（缺则跳过）。`modelHash` 放次要行。各方表列：参与方 / 样本数 / 轮次 / AUC / 本地哈希（次要）。

### D5 — 注册：`REGISTRATION_TERM_HELP` + 效应/机制文案

与 L1.5 `L15_METRIC_HELP` 同模式：`title`/图例。`registrationEffectText` 已偏中文；补 `risk-ratio`/`risk-difference` 不裸奔。MCAR/MAR/MNAR → 中文全称并列缩写。不改 `problems` 判定。

### D6 — 实现顺序（与 proposal 一致）

1. paired-cohort 视图 + 表 + 测  
2. FL extras/摘要 + 测  
3. registration 术语注解 + 测（文案辅助函数即可）  
4. SCRI RI 列 + 摘要 + 测  
5. DESIGN.md 一句

## Risks / Trade-offs

- [Risk] Web 镜像 SCRI RI 与 API 浮点微差 → Mitigation：单测钉住与 `scriRelativeIncidence` 同输入同输出（复制参考值）；或抽到未来 shared（本期不强制）。
- [Risk] 注册面板术语过多变吵 → Mitigation：悬停为主、表下短图例一条，不逐格长文。
- [Risk] `task-detail` 尚未进主 specs → Mitigation：本 delta 仅 ADDED；归档前先归档/同步 `mdop-job-detail-display`。

## Migration Plan

纯前端。回滚即恢复各类型旧摘要/英文堆叠。无数据迁移。

## Open Questions

无（窗口天数取绝对值差、主指标优先 AUC 已在 D3/D4 钉死）。
