# 提案：FL 批次 1A —— L4 联邦预测迁入 MDOP

> 上游：`mdop-orchestration-migration`（台账、守护、闸门、L1.5 切换）把 L4 登记为
> `in-migration` 并写好闸门；**本变更负责把 L4 真正迁过去并下线旧链**。批次 1B（LoRA FedAvg）
> 被 D-MDOP-8 的节点间安全聚合挡着，不在本变更内。

## Why

- 迁移台账（D-MDOP-7）里 `fl.l4-prediction` 仍是 `channel=legacy` / `state=in-migration`：
  L4 走的是**另一套编排**（`apps/api/src/runtime/fl-orchestrator/` + 连接器
  `domain/fl-prediction/` + `cp_fl_prediction_*` 表），与 MDOP 的「片段下发 → 本地复核 →
  执行凭证 → C3 → 合并」不是一条链。
- 不迁的代价：两套作业生命周期与两套表长期并存；每加一个 FL 能力都要在两条链上各做一遍
  （`aggregate_and_model` 出域口径、DP 闸门、模型哈希存证都要重复实现）。
- L4 **不受** D-MDOP-8 约束（它聚合的是系数/梯度，最终形态由本变更定；安全聚合留给 1B），
  所以它是 FL 家族里**现在就能迁**的那一条 —— 这也是 §6 裁决「先 L4」的理由。

## What Changes

1. **台账推进**：`fl.l4-prediction` 从 `legacy/in-migration` 走到 `mdop`（新增 `mdopTemplate`
   `rws.l4.fl-prediction`），并按既有六条闸门走完 `migrated → legacy-removed`。
2. **节点侧**：把现有的院内训练实现接成 MDOP 算子（**优先复用**已存在的
   `apps/connector/src/domain/fl-prediction/local-logistic.ts#trainLocalLogisticParty` 与
   `fl-task-runner` 的 LR+FedAvg 路径，而不是重写；这些实现进台账 `retained` 的
   `shared-runtime`，守护 O6 保证不被误删）。
3. **平台侧**：新增计划模板 `buildL4Plan`（`source.dataset` → 院内训练 → `declassify` →
   `merge.fedavg@1.0.0`）与合并算子 `mdop/operators/merge-fedavg.ts`，复用
   `apps/api/src/runtime/fl-orchestrator/` 里已验证的聚合口径（`localModelHash`、样本数加权）。
4. **入口**：`POST /api/v1/mdop/jobs/fl-prediction`（模板入口，经 `assertTemplateAllowed`）；
   web 的 `/space/tasks/new/fl-prediction` 提交后落 MDOP 作业详情。
5. **等价性证据**（闸门①）：固定 fixture 下**同一样本数、同一超参**，旧链与 MDOP 链的
   `auc / f1 / precision / recall / 样本数 / localModelHash` 逐字段一致，归档到
   `evidence/l4-equivalence/`。
6. **治理同步**：DOMAIN（新表/关系若变）、FLOWS（FLOW-RWS-04 指向 MDOP）、DECISIONS
   （若引入新决策）、TRUST（出域口径）、ARCHITECTURE（状态行）。

## 本期不做

- **LoRA FedAvg / SecretFlow（批次 1B）**：被 D-MDOP-8 的节点间安全聚合与协议 v0.3 挡住。
- **节点间安全聚合**：本变更的 L4 按合约 `outputPolicy.allowedArtifacts` 出域（`aggregate_and_model`）；
  安全聚合形态若要覆盖 L4，另立变更（会改 D-MDOP-8 的适用范围）。
- **多轮/部分参与的重定义**（见 design D3）：本变更先按 MDOP 语义把轮次与幂等说清，不引入新协议。
- **不删旧表数据**（规矩 3）。

## Capabilities

- `rws-compute`：L4 的执行链从「旧 FL 编排」改为「MDOP 作业」，出域与合并口径不变。
- `orchestration-kernel`：台账 `fl.l4-prediction` 的推进与闸门留证（机制已就位，本变更消费它）。

## Impact

- 新增：`plan-templates` 的 L4 模板、`mdop/operators/merge-fedavg.ts`、连接器 L4 算子与 wiring、
  `POST /mdop/jobs/fl-prediction`、`evidence/l4-equivalence/`。
- 改动：台账 `fl.l4-prediction`；web `tasks/new/fl-prediction` 与任务详情；FLOWS/ARCHITECTURE 状态行。
- 未迁类型不受影响（台账里其余 7 个 RWS 类型与 `fl.lora-fedavg` 保持 `legacy`）。
