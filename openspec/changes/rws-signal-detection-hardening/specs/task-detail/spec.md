## MODIFIED Requirements

### Requirement: 失衡类合并结果展开关键指标
当合并结果的分析类型为失衡/L1.5（如 `disproportionality`）且 payload 含分层或信号字段时，详情结果区 SHALL 以可读表格或等价结构展示关键指标（至少包括结局键、计数、payload 中已有的 PRR/ROR 及其置信区间、`chiSqYates`、`ic` 及其 95% 可信区间 `ic025~ic975`、Evans/BCPNN 信号标志，以及部分站点小单元格抑制提示与无日期口径提示），MUST NOT 仅用「N 行四格表 a=…」类单行摘要或隐藏已有抑制告警。

#### Scenario: 含 PRR/ROR/IC025/signal 的 C3 可读展开
- **WHEN** 平台合并结果为 `disproportionality`，且某 bucket 含 `prr`/`ror`/`chiSqYates`/`ic`/`ic025`/`ic975` 与 `signal`
- **THEN** 结果区 MUST 展示上述指标列与可信区间，并在 `partialSuppression` 或 `temporalMode === "undated-cooccurrence"` 时显示清晰提示

## ADDED Requirements

### Requirement: 区分展示描述性器官分布计数与药物安全信号
新建研究任务表单与结果详情面板 SHALL 将 `adverse-event-signal` 清晰命名为「不良事件器官分布（描述性计数）」，不得为其提供或预填无效的「结局」信号字段；结果面板 SHALL 以器官系统频次表展示其计数与占比，并标明「无对照组、非因果安全信号」。

#### Scenario: 任务表单切换到描述性器官分布
- **WHEN** 用户在 RWS 新建任务页选择 `adverse-event-signal`
- **THEN** 界面显示「不良事件器官分布（描述性计数）」，隐藏「结局」输入框并仅提供可选用药过滤
