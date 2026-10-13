## ADDED Requirements

### Requirement: 分析类型迁移台账为唯一事实源

「哪个分析类型由哪条通道执行」SHALL 只由 `apps/api/src/runtime/orchestration/orchestration.migration.json` 决定。每个 `key` MUST 恰好出现一次且 `channel` 取值唯一（`mdop` | `legacy`）。代码里 MUST NOT 出现按分析类型硬编码的通道分支。

`legacy` 条目数 MUST 单调不增：任何新增 legacy 通道的改动 MUST 被判红。`state=legacy-removed` 的条目 MUST 不再被任何源码引用。`channel=mdop` 的条目 MUST 附等价性证据引用。

#### Scenario: 新增一条 legacy 通道

- **WHEN** 某变更把某分析类型的 `channel` 从 `mdop` 改回 `legacy`，或新增一个 `legacy` 条目
- **THEN** `pnpm check:orchestration` MUST 报红并指出该 `key`，CI MUST 失败

#### Scenario: 已下线条目仍有代码引用

- **WHEN** 台账某条目已是 `legacy-removed`，而源码中仍能匹配到其旧路由、旧页面或旧执行分支
- **THEN** 守护 MUST 报红并给出引用位置

#### Scenario: MDOP 条目缺少等价性证据

- **WHEN** 某条目 `channel=mdop` 但未登记 `equivalenceEvidence`
- **THEN** 守护 MUST 报红

### Requirement: 通道解析单点与 fail-closed

平台 SHALL 提供唯一解析点 `resolveChannel(analysisType)`，控制器与服务 MUST NOT 自行判断通道。走 MDOP 的条件 MUST 同时满足：平台 `MDOP_ENABLED=true`、台账 `channel=mdop`、该作业的合约与算子前置就绪。任一不满足时 MUST 拒绝作业并返回可区分的错误码；MUST NOT 自动回落到旧通道。

#### Scenario: 总开关关闭但台账指向 MDOP

- **WHEN** 台账 `channel=mdop` 而 `MDOP_ENABLED=false`，收到该分析类型的作业
- **THEN** 作业 MUST 被拒绝并返回 `E_MDOP_DISABLED`，MUST NOT 在旧通道上执行

#### Scenario: 台账指向旧通道却提交 MDOP 模板

- **WHEN** 某分析类型台账 `channel=legacy`，请求携带 MDOP 计划模板
- **THEN** 请求 MUST 被拒绝并返回 `E_CHANNEL_LEGACY`

### Requirement: 迁移期并存的硬规矩

迁移期允许新表（`cp_mdop_*`）与旧表（`cp_rws_*`、`cp_fl_prediction_*`）同时存在，但 MUST 遵守三条规矩：

1. **不双写**：走 MDOP 的作业 MUST NOT 写旧表；走旧通道的作业 MUST NOT 写 `cp_mdop_*`。
2. **不过桥**：MUST NOT 支持跨通道续跑（旧作业切 MDOP 重跑、MDOP 作业从旧表 resume）。
3. **旧数据只读保留**：迁移 MUST NOT 删除旧数据；删除归既有留存策略。

#### Scenario: MDOP 作业试图写旧表

- **WHEN** 某 MDOP 作业的代码路径尝试向 `cp_rws_*` 或 `cp_fl_prediction_*` 写入
- **THEN** 运行时断言 MUST 抛出，且守护 MUST 报红

#### Scenario: 跨通道 resume

- **WHEN** 对一条旧通道作业发起 MDOP resume，或对 MDOP 作业发起旧通道 resume
- **THEN** 请求 MUST 被拒绝

### Requirement: 下线闸门与回滚窗口

删除任一旧路径前，以下六条 MUST 全部满足并有留证：① 台账 `channel=mdop` 且等价性证据在册；② 旧表零写入；③ 旧路由/页面/端点零引用；④ 生产切至 MDOP 后**连续稳定运行满 5 天**（2026-10-13 裁决的观察窗）；⑤ 回滚演练通过（这 5 天内 `channel` 切回 `legacy` 仍可用）；⑥ 治理同步（DOMAIN / FLOWS / DECISIONS / TRUST / ARCHITECTURE）。

对拍态 `state=verification` MUST 带 `expires`；到期未推进 MUST 报红。切换通道 MUST 审计留痕。

#### Scenario: 闸门未全绿即删除旧路径

- **WHEN** 某变更在②或③未满足时把条目置为 `legacy-removed` 并删除代码
- **THEN** 守护 MUST 报红，评审 MUST 拒绝

#### Scenario: 观察窗内回滚

- **WHEN** 某分析类型已切至 MDOP，在观察窗内把 `channel` 切回 `legacy`
- **THEN** 该分析类型 MUST 仍能在旧通道上执行（回滚通道可用），且该次切换 MUST 留审计记录

#### Scenario: 对拍态长期不收敛

- **WHEN** 某条目的 `verification.expires` 已过期而 `state` 未推进
- **THEN** `pnpm check:orchestration` MUST 报红

#### Scenario: 观察窗未满即删除旧路径

- **WHEN** 某分析类型切至 MDOP 后连续运行不足 5 天，就被置为 `legacy-removed` 并删除旧代码
- **THEN** 守护 MUST 报红，评审 MUST 拒绝
