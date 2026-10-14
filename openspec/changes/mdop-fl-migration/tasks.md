## 1. 台账与前置（机制已就位，本变更消费）

- [ ] 1.1 台账 `fl.l4-prediction`：补 `mdopTemplate=rws.l4.fl-prediction`、`retained`（`shared-runtime`：`apps/connector/src/domain/fl-prediction/` 的院内训练实现）、`legacyRefs`（旧 `fl-orchestrator` controller/persistence/assignment 回传）；`state` 在证据齐之前保持 `in-migration`。
- [ ] 1.2 清点旧链隐藏消费者（照 A4/A5）：结算、存证、RBAC、nav 清单里对 `cp_fl_prediction_*` 与 `fl-orchestrator` 的引用，列成清单。
- [ ] 1.3 确认 `fl.lora-fedavg` 仍为 `in-migration` 且带 `blockedBy`（D-MDOP-8），防本变更顺手打开批次 1B。

## 2. 平台侧

- [x] 2.1（2026-10-13）`plan-templates`：新增 `L4_TEMPLATE_ID` 与 `buildL4Plan`（`source.dataset` → 院内训练 → `declassify.small_cell` → `merge.fedavg@1.0.0`），输入复用 `FlPredictionTaskSpec`（不另立字段语义）。
- [x] 2.2（2026-10-13）`mdop/operators/merge-fedavg.ts`：样本数加权 FedAvg，复用旧链已验证口径（`localModelHash`、样本数），产物按合约 `allowedArtifacts`（`aggregate_and_model`）出域。
- [~] 2.3（2026-10-13 部分完成）：`merge.fedavg` 已登记进 `SYSTEM_OPERATORS`（system/merge）；`POST /mdop/jobs/fl-prediction` 已就位（过 `assertTemplateAllowed`）；**节点算子 `rws.l4-train@1.0.0` 仍需一条"已准入模块"记录**——L1.5 的 `rws.disproportionality@1.0.0` 就是 `kind: "wasm"` 的已入库模块（见 `operator-registry.spec.ts`），L4 要么走同一路径（可用 wasm/sidecar 模块），要么另定登记方式。
- [x] 2.2c（2026-10-13）**平台链路端到端证明**（`apps/api/src/mdop/l4-fl-e2e.spec.ts`）：用测试替身驱动 `mergeIfReady`，钉住①`merge.fedavg` 分派**优先于** `analysisType`（故意传 L1.5 形态 analysis）②L1.5 计划仍走失衡合并（分派不误伤）③wasm 未落地时的提交期边界。**该测试抓到并修掉一个真缺陷**：旧链返回带 `undefined` 成员，交付摘要的 JCS 规范化会抛 `CanonicalizationError` → 已在算子边界 `dropUndefinedDeep`。
- [x] 2.2b（2026-10-13）**合并分派**：`mdop-merge.service` 改为按计划里的 `merge.fedavg` 阶段分派，且**优先于** `analysisType` 三元——L4 的 per-node payload 是 `FlPartyRunResult`（无 `analysisType`），不这样改会错落到 L1.5 的 `mergeProportionality`。
- [x] 2.5（2026-10-13 审计完成）复核 L1.5 专属逻辑对 L4 的适用性，结论：① `expectedNodes` 按"谁真的产出 C3 的阶段"推导，**与算子/分析类型无关** → L4 适用；② 交付路径**不按 `analysisType` 校验** → L4 适用；③ `mdop-messages.controller.ts:596` 用 L1.5 形态的 `l15AnalysisOf(job)` 触发合并 —— **必须靠"merge.fedavg 分支优先于 analysisType 三元"兜住**（已实现），已在该处加注释说明。
- [ ] 2.6 原始条目（保留）：`mdop-messages.controller.ts#l15AnalysisOf`（按 `rws.disproportionality` 阶段取 drug）、发布审查清单汇总、`expectedNodes` 的参与方集合来源。
- [ ] 2.4 出域口径复核：`model_weights` 为**聚合后**产物；合约未列平台时 MUST NOT 投递（D-MDOP-2）。落 TRUST 控制点引用。

## 3. 节点侧（复用优先，不重写）

- [x] 3.0（**2026-10-13 完成**，裁决选 B；见 design D1b/D1d）：定点整数 wasm 模块已落地 ——
  `packages/wasm-algorithms/modules/fl-logistic-as/assembly/fl-logistic.ts`（Q16.16 批量梯度下降、sigmoid 查表由宿主传入、零能力、无堆分配）
  + TS 孪生体 `src/fl-logistic-model.ts` + `PLATFORM_MODULES` 条目（`operator.id = rws.l4-train`，category `local`，plain，C0→C0）
  + 对拍 `scripts/fl-logistic-parity.test.mjs`（已挂进包测试链）。**实测**：parity 5/5 逐字段一致；
  包测试链 102/102；`fl-logistic.wasm` 930B、SM3 `3137d92c…`、可复现闸逐字节一致；
  `l4-fl-e2e.spec.ts` 用真实 manifest 注册出 `rws.l4-train@1.0.0` 且 **`submit(buildL4Plan)` 成功** → 「不可提交」边界解除。证据档 `evidence/l4-equivalence/`。
  - [x] 定点原型（2026-10-13）：`local-logistic-fixedpoint.proto.spec.ts` 给出可复跑数据（AUC 一致、整数 FedAvg 精确累加）
  - [x] 选项 B 具体形态（2026-10-13，design D1d）：ABI 草案 + 两条对拍标准 + **隐私边界**（1A 不新增节点→平台通道；跨院合并权重必须等 D-MDOP-8）
  - [x] 选项 B 具体形态（2026-10-13，design D1d）：ABI 草案 + 两条对拍标准 + **隐私边界**（1A 不新增节点→平台通道；跨院合并权重必须等 D-MDOP-8）在 `packages/wasm-algorithms` 新增 L4 训练模块
  （LR 逻辑移植自 `apps/connector/src/domain/fl-prediction/local-logistic.ts`），走**可复现构建 + SM3**
  并登记进 `AlgorithmModuleRegistry`，使 `rws.l4-train@1.0.0` 以 `kind: wasm` 出现在算子注册中心
  （否则 `MdopJobsService#submit` 的"阶段引用了未注册的算子"会立即拒——平台侧已实施的边界）。
  TS 实现转为 `retained.test-reference`（wasm 的对拍基准）。
- [x] 3.1（**2026-10-13 完成**）`connector/src/mdop/operators/l4.ts` + `wire-l4.ts`：**经 sandbox 调 wasm 模块**——
  `MdopStageExecutor.registerWasmOperator(前缀, runner)`（新增：一个执行器承载多个 wasm 算子，`setWasmRunner` 保留为兜底，L1.5 不被顶掉）
  → `AlgorithmSandboxExecutor.runFixedCompute`（新增通用定点路径，形状 `table@1`，与 `runProjection` 同一套闸：内存上限/双重校验/ABI 一致/审计）
  → 编码复用旧链同一 `encodeTabularRows` 再乘 Q16.16 取整 → 解码定点系数 → 输出 **C0**。未接入即 fail-closed。
  **实测**：`l4.spec.ts` 3/3（编码头部与 ABI 一致 / L4 与 L1.5 分派互不顶掉 / 摘要不符·缺 spec·缺上游都拒）；连接器既有 29 suites/225 tests 无回归。
  **未完成**：L4 的 `declassify` 分派（共用的 `declassify.small_cell` handler 目前只认 L1.5 的四格表载荷）与端到端作业（4.x）。 / `fl-task-runner` 的 LR+FedAvg 路径、`fl-dp-gate`、`fl-output-guard`、`fl-tabular-materializer`；**未接入即 fail-closed**，不回退内置实现。
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
