# MDOP 批次 2：RWS 阶梯 L0–L3 逐类迁入 + compose 页改为计划编辑器

> 上游：`mdop-orchestration-migration`（台账、守护、闸门、L1.5 切换）的 tasks 6.1/6.2 **只登记裁决**；
> 本变更承接那份登记，把批次 2 真正做出来。裁决出处：D-MDOP-1（按分析类型逐类迁移）、
> D-MDOP-7（台账是唯一事实源）、以及 2026-10-13 的实施枚举（design D5「批次 2 包含 compose 页改为计划编辑器」）。

## Why

台账 `orchestration.migration.json` 目前的状态：L1.5 已迁（`rws.disproportionality` = mdop/migrated），
L4 在迁移中（`fl.l4-prediction`），四个 MDOP 原生场景已上线；**其余 7 个 RWS 类型仍在 legacy**：

| 阶梯 | 台账 key | 现状 |
|---|---|---|
| L0/L1 描述与信号 | `rws.adverse-event-signal`、`rws.cohort-count`、`rws.condition-prevalence` | legacy/pending |
| L2 比较效果 | `rws.comparative-effect` | legacy/pending |
| L3 因果 | `rws.causal-psm`、`rws.causal-survival` | legacy/pending |
| 模型校验 | `rws.algorithm-validation` | legacy/pending |

不迁的话，「两套表并存」会永久化：旧路径每多跑一天，就多一天的双通道分叉风险（同一分析类型
两条通道各执行一次、旧表继续增长）。另外 `mdop-kernel` 留了一条尾巴 —— compose 页目前产出的是
**演示形状**的编排，不是 MDOP 逻辑计划，导致「页面上能编的」与「平台能跑的」是两套东西。

## What Changes

1. **L0/L1 三型迁入**（`rws.adverse-event-signal` / `rws.cohort-count` / `rws.condition-prevalence`）：
   它们是描述性聚合，**在平台侧合并**（各院同形状计数相加），不需要节点内计算；
   每型一个计划模板 + 一个收集器 + 一个提交入口 + 等价性对拍。
2. **L2 比较效果迁入**（`rws.comparative-effect`）：站点级效应量 + 标准误，平台做随机效应合并
   （复用既有的 meta 合并）；三闸门（效应量/CI/异质性）在平台侧呈现。
3. **L3 因果两型迁入**（`rws.causal-psm` / `rws.causal-survival`）：站内 PSM/IPTW 或局部 Cox **在连接器侧**完成，
   只出站点级效应量（ATE/HR）+ 标准误；生存曲线按高阶统计量闸门**分箱 + 在险人数过阈值**后才出域。
4. **`rws.algorithm-validation` 迁入**：模型校验指标（AUC/校准/决策曲线）站点级出域 + 平台汇总。
5. **compose 页改为计划编辑器**：页面直接编辑 **MDOP 逻辑计划**（阶段、算子、`at` 放置、合约），
   产出物经 `parseLogicalPlan` + 编译期校验；不再维护第二套「演示形状」的编排模型。
6. **台账与守护同步**：每型迁完把 `channel` 置 `mdop`、`state` 置 `migrated`（或 `verification`），
   按 O3 附等价性证据（`mdop-native` 型例外见条目 note）；旧接线的删除按 O7 的日期闸与观察窗执行。

## 本期不做

- **FL 家族**（`fl.lora-fedavg`）：前置是 D-MDOP-8 落册 + 协议 v0.3 的聚合阶段与节点间通道（见 `mdop-fl-migration`）。
- **L1.5 旧接线删除**：受 O7 日期闸（观察窗 2026-10-13 起算、最早 2026-10-18）约束，由 `mdop-fl-migration` 5.4 与
  `mdop-orchestration-migration` 3.x 收口，本变更不动。
- **旧表的物理删除**：`state=legacy-removed` 只表示「不再接线」，表保留到归档期结束（D-MDOP-7 的保留口径）。

## Capabilities

- `plan-editor`：compose 页产出的计划**就是** MDOP 逻辑计划（新增能力，见 `specs/plan-editor/spec.md`）。
- 七个分析类型的能力沿用既有 spec（L0–L3 的计算语义不变），本变更只改**执行通道**与**入口形状**。

## Impact

- `apps/api/src/mdop/`：七个模板入口 + 计划模板常量 + 台账条目与模板→key 映射。
- `industries/med/src/{templates,collectors}/`：七型的计划模板与平台侧收集器（基座不认行业类型，经 SPI 注册面反转）。
- `apps/web/src/app/(console)/space/`：compose 页改为计划编辑器；各型的提交入口收敛到同一处。
- `apps/connector`：L2/L3 的站内计算（PSM/IPTW、局部 Cox）与高阶闸门分箱复用既有算子。
- 守护：`check-orchestration` 的 legacy 计数随迁移逐项下降（O2 允许下降）。
