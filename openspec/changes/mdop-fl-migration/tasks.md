## 1. 台账与前置（机制已就位，本变更消费）

- [ ] 1.1 台账 `fl.l4-prediction`：补 `mdopTemplate=rws.l4.fl-prediction`、`retained`（`shared-runtime`：`apps/connector/src/domain/fl-prediction/` 的院内训练实现）、`legacyRefs`（旧 `fl-orchestrator` controller/persistence/assignment 回传）；`state` 在证据齐之前保持 `in-migration`。
- [ ] 1.2 清点旧链隐藏消费者（照 A4/A5）：结算、存证、RBAC、nav 清单里对 `cp_fl_prediction_*` 与 `fl-orchestrator` 的引用，列成清单。
- [ ] 1.3 确认 `fl.lora-fedavg` 仍为 `in-migration` 且带 `blockedBy`（D-MDOP-8），防本变更顺手打开批次 1B。

## 2. 平台侧

- [ ] 2.1 `plan-templates`：新增 `L4_TEMPLATE_ID` 与 `buildL4Plan`（`source.dataset` → 院内训练 → `declassify.small_cell` → `merge.fedavg@1.0.0`），输入复用 `FlPredictionTaskSpec`（不另立字段语义）。
- [ ] 2.2 `mdop/operators/merge-fedavg.ts`：样本数加权 FedAvg，复用旧链已验证口径（`localModelHash`、样本数），产物按合约 `allowedArtifacts`（`aggregate_and_model`）出域。
- [ ] 2.3 算子注册与白名单（D-MDOP-5 三类 kind 归属）；`mdop.controller` 新增 `POST /mdop/jobs/fl-prediction`（必过 `assertTemplateAllowed`）。
- [ ] 2.4 出域口径复核：`model_weights` 为**聚合后**产物；合约未列平台时 MUST NOT 投递（D-MDOP-2）。落 TRUST 控制点引用。

## 3. 节点侧（复用优先，不重写）

- [ ] 3.1 `connector/src/mdop/operators/l4-train.ts`：注入 `trainLocalLogisticParty` / `fl-task-runner` 的 LR+FedAvg 路径、`fl-dp-gate`、`fl-output-guard`、`fl-tabular-materializer`；**未接入即 fail-closed**，不回退内置实现。
- [ ] 3.2 wiring（照 `wire-l15.ts` 形态）+ 算子白名单；单测用替身逐段对拍。
- [ ] 3.3 轮次语义（design D3）：轮次 = 作业内 stage 序列，幂等键 `jobId+round`；任一片段未回执 → 不进入 `RELEASING`，**不产生部分结果**。

## 4. 等价性证据（闸门①，先于切换）

- [ ] 4.1 固定 fixture + 固定种子，LR+FedAvg 两链路对拍：`auc / f1 / precision / recall / 样本数 / localModelHash` 逐字段一致。
- [ ] 4.2 `localModelHash` 若不同，必须给出可复核解释（张量顺序）并把口径写进证据档——**不得**用「差不多」结论。
- [ ] 4.3 结算/存证输入不因换通道而变：按 §1.2 清单逐项验证。
- [ ] 4.4 归档 `evidence/l4-equivalence/`（含复现命令与明确未覆盖项）。

## 5. 切换、观察、下线

- [ ] 5.1 置 `cutoverAt`（与 5.2 同批）：旧入口对 `fl.l4-prediction` 行 409 `E_CHANNEL_MDOP`。
- [ ] 5.2 web 收敛：`/space/tasks/new/fl-prediction` 提交后落 MDOP 作业详情；历史 FL 任务在任务详情**只读**并标注（照 L1.5 的 C 类处理，不删共用页、不加重定向）。
- [ ] 5.3 5 天观察 + 回滚演练（`ORCHESTRATION_FORCE_CHANNEL=fl.l4-prediction=legacy`）留证；闸门②：静态 O8 + 真实作业后旧表行数比对。
- [ ] 5.4 删旧接线（**MUST NOT 删 `retained`**）→ `state=legacy-removed`；台账 legacy 计数随之下降（O2 允许下降）。

## 6. 治理同步

- [ ] 6.1 FLOWS（FLOW-RWS-04 指向 MDOP）· ARCHITECTURE 状态行 · TRUST（出域） · `docs/tech-debt.md` 的 TD-9 收敛 FL 部分 · DOMAIN（若新增实体才需改）。
