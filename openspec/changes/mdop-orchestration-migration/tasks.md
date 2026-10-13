## 1. 治理先行

- [ ] 1.1 DECISIONS.md 新增 **D-MDOP-7**（迁移台账为唯一事实源；`legacy` 只减不增；单一通道 fail-closed）与 **D-MDOP-8**（FL 家族走节点间安全聚合；平台只收聚合后总和；与 D-MDOP-2 互链）。
- [ ] 1.2 DOMAIN.md：旧表（`cp_rws_*`、`cp_fl_prediction_*`）标注「迁移期只读、由 MDOP 逐步接替」，并指向 D-MDOP-1 / D-MDOP-7；不动覆盖矩阵的平面归属。
- [ ] 1.3 FLOWS.md：旧的 L1.5 通道相关步骤标注 deprecated 并在 3.x 下线时改写成 MDOP 单通道；给 FL 相关 FLOW（FLOW-RWS-04 / FLOW-RWS-06）加「迁移中」注记。
- [ ] 1.4 `docs/tech-debt.md` 记 A2（L1.5 双通道详情）的收敛路径与本变更的兑现点。
- [ ] 1.5 `node scripts/check-meta-docs.mjs` 为 0 error。

## 2. 迁移台账与解析单点（机制层）

- [ ] 2.1 新增 `apps/api/src/runtime/orchestration/orchestration.migration.json`，登记全部分析类型：已迁的 L1.5（`channel=mdop`）、有主的旧链（`legacy`：`cp_rws_*`、`cp_fl_prediction_*`、SecretFlow LoRA 内存态）与 `state`、`legacyTables`、`legacyRefs`、`equivalenceEvidence`、`sunset`。
- [ ] 2.2 `resolveChannel(analysisType)` + 类型化读取层（`lib/orchestration.ts`），全仓唯一通道解析点；`grep` 证明控制器/服务里不再有按分析类型硬编码的通道分支。
- [ ] 2.3 运行时断言：走 MDOP 的作业写旧表即抛（规矩 1）；跨通道 resume 即拒（规矩 2）。
- [ ] 2.4 `scripts/check-orchestration.mjs`：台账 schema；每个 `key` 恰好一条通道；**legacy 只减不增**（与 git 基线比）；`legacy-removed` 无残留代码引用；`mdop` 条目必须有等价性证据；`verification` 态必须带未过期的 `expires`。
- [ ] 2.5 负例自检 `scripts/check-orchestration.test.mjs`（注入违规须报红、回滚须转绿），连同守护接入根 `package.json` 的 `test` 链。
- [ ] 2.7 收口唯一未设闸的入口：通用 `POST /mdop/jobs` 接受任意逻辑计划，**没有能判定"属于哪个分析类型"的字段**，台账对它失效（5 个模板入口已由 2.6 覆盖）。给它加 `analysisKey`（或由计划算子反推），接上 `assertEntryAllowed(key, "mdop")`，否则「未迁类型不得走 MDOP」在这条入口上留了口子。
- [ ] 2.6 fail-closed 落地：`MDOP_ENABLED` 与台账 `channel` 不一致时拒绝作业，错误码区分 `E_MDOP_DISABLED` / `E_CHANNEL_LEGACY`；**MUST NOT 回落**。

## 3. 批次 0：L1.5 旧路径下线（兑现「迁完才下线」）

- [x] 3.1 归档等价性证据（[evidence/l15-equivalence/](../evidence/l15-equivalence/README.md)）：平台合并两条通路 deep-equal + 黄金数字（PRR 30.901099 / ROR 43.251553 / IC 3.034507），院内 2×2 由既有逐字段对拍覆盖。**关键发现**：`disproportionality.ts` 是两条通道**共用的计算实现**（MDOP 合并算子 import 它），故 L1.5 下线的是**通道接线而非计算模块**——台账已拆出 `sharedCompute`，守护 O6 禁止它进 `legacyRefs`。
- [ ] 3.2 闸门逐条留证：② 旧表零写入、③ 零代码引用、**④ 连续稳定运行 ≥5 天（2026-10-13 裁决的观察窗）**、⑤ 回滚演练（5 天窗内用 `ORCHESTRATION_FORCE_CHANNEL=<key>=legacy` 在旧通道跑通一次并留证；台账不改）、⑥ 治理同步完成。
- [ ] 3.3 删除旧执行分支与旧端点（**MUST NOT 删 `sharedCompute` 里的共享计算实现**——MDOP 通道正在用它）：`apps/api/src/runtime/rws-orchestrator/disproportionality*` 的旧通道执行路径、`rws-analytics-ladder` 的 L1.5 旧入口及其单测（保留纯计算单元若仍被 MDOP 复用，须在台账 `legacyRefs` 之外说明）。
- [ ] 3.4 前端收敛：L1.5 只有一个入口与一个详情页；旧详情页**直接删除**（用户裁决：不留只读期）并在 `nav.manifest.json` 的 `redirects` 登记永久重定向（`check:nav` 绿）。
- [ ] 3.5 台账把 `rws.disproportionality` 置 `state=legacy-removed`，`channel=mdop`，`legacyRefs` 清空。
- [ ] 3.6 验收：真实数据上经 MDOP 跑通 L1.5；旧地址重定向可达；`check:orchestration` / `check:nav` / `check:meta` 全绿。

## 4. 批次 1：联邦学习登记与前置（本期不实现迁移）

顺序已裁决：**4A（先）L4 联邦预测 → 4B（后）LoRA FedAvg**（design §6 说明两者定位差异与顺序理由）。

### 4A. L4 联邦预测（先）

- [ ] 4A.1 台账登记 `fl.l4-prediction` 为 `state=in-migration`：`cp_fl_prediction_task` / `cp_fl_prediction_assignment`、`apps/api/src/runtime/fl-orchestrator/`、`/space/federated`、`/space/infer/[taskId]`，写明 `legacyRefs` 与前置。
- [ ] 4A.2 等价性判据写进 spec（AUC / F1 / 样本数 / `localModelHash` 口径），供实现变更直接继承，避免各自重定义。
- [ ] 4A.3 出域口径复核：模型参数与聚合指标按合约 `allowedArtifacts`（`aggregate_and_model`）；**安全聚合下出域的只能是聚合后参数**（D-MDOP-8），落 TRUST 控制点引用。
- [ ] 4A.4 UI 不并列：旧入口标 `deprecated` + 预计下线日期，不新增第二个入口（D-UI-2 清单驱动）。

### 4B. LoRA FedAvg（后，被安全聚合前置挡住）

- [ ] 4B.1 台账登记 `fl.lora-fedavg` 为 `state=in-migration`：SecretFlow 内存态 + 轮次队列（`fl-round-queue`）+ 结算/贡献计量，写明 `legacyRefs`。
- [ ] 4B.2 **开工前置**：D-MDOP-8 落册 + 协议 v0.3 的聚合阶段/消息/`kind` + 节点间通道方案选定（design D5 推荐②：复用旧 LoRA 已有的 `encrypted_delta_ref` 密文增量，平台只搬运与合并，明文更新不出节点）。前置未定前 4B MUST NOT 开工。
- [ ] 4B.3 多轮语义：轮次幂等键、超时重派、`partial` 参与在安全聚合下的语义——按 MDOP 重写，**不复用**旧管线的 partial 合并。
- [ ] 4B.4 交付物口径：`lora_delta_hash` / `encrypted_delta_ref` / `model_card` 与 `lora-deliverable-verify` 的校验口径迁移后保持不变。

### 4C. 共同

- [ ] 4C.1 把两条链的就绪条件与阻塞项整理成 `mdop-fl-migration` 变更的输入（本变更不做实现）。

## 5. 验收

- [ ] 5.1 `pnpm test` 全绿（含新守护与负例）；`check:meta` 0 error。
- [ ] 5.2 台账与代码一致：任一分析类型的实际执行通道与台账 `channel` 相等（守护 + 抽查）。
- [ ] 5.3 手工走查：L1.5 全绿；FL 旧通道照常（迁移期不得被打断）；旧 L1.5 入口不再可达。
- [ ] 5.4 文档口径一致：README / CLAUDE / ARCHITECTURE 中「三条编排并行」的表述改为「迁移中，逐类接替」。

## 6. 批次 2（下一变更，本变更只登记裁决）

- [ ] 6.1 登记批次 2 范围：RWS 阶梯 L0 / L1 / L2 / L3 逐类迁入 MDOP。
- [ ] 6.2 登记 **compose 页改为计划编辑器**（用户裁决：包含在批次 2）：`mdop-kernel` 留的这条尾巴在本批次收口，compose 产出的计划直接就是 MDOP 逻辑计划。
