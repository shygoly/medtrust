# L4 联邦预测迁移的等价性证据（闸门①）

> 批次 1A（change `mdop-fl-migration`）。**两类对拍，标准不同，别混**（design D1d §4）。

## 1. wasm(定点) vs TS(同一算法) —— **逐字段相等**

- 模块：`packages/wasm-algorithms/modules/fl-logistic-as/assembly/fl-logistic.ts`
- TS 孪生体：`packages/wasm-algorithms/src/fl-logistic-model.ts#trainFlLogisticQ16`
- 对拍：`packages/wasm-algorithms/scripts/fl-logistic-parity.test.mjs`（已挂进包默认测试链）
- 复现：`cd packages/wasm-algorithms && pnpm test`

**结果（2026-10-13 实测）**：`# tests 5 · pass 5 · fail 0` ——
可分数据 / 非可分带噪（会产生负梯度）/ 单特征全正标签（退化）/ **宿主自定义查表** / 非法入参错误码（n=0→1、d=0→2、域非法→3、outOff 越界→4）全部逐字段一致。

**产物可复现**：`fl-logistic.wasm` 930 bytes，**SM3=`3137d92c5a4bb24d3d871e9c9408b20ee7e57b94e3986cd7a1a587d431d8d21c`**，
`check-reproducible` 源码重建**逐字节一致**、只导入 `env.memory`（零能力）。

## 2. 定点 vs 浮点 IRLS（旧链参考）—— **容差**

- 复现：`cd apps/connector && npx jest src/domain/fl-prediction/local-logistic-fixedpoint.proto.spec.ts`
- 实测（同一夹具同一超参）：

| 数据集 | aucFloat | aucFixed | \|Δauc\| | max\|Δθ\| | 符号一致 |
|---|---|---|---|---|---|
| 200 例（可分） | 0.9177 | 0.9177 | **0.0000** | 0.0273 | 9/10 |
| 4000 例（低事件率，线上 AUC 0.418 那次出事的队列） | 0.8328 | 0.8328 | **0.0000** | 0.0071 | 9/10 |

唯一符号不一致的是 `sex=male`（浮点 +0.0093 / 定点 −0.0053，两者都≈0，噪声底）。

**结论**：定点替换**不损失 AUC**（4 位小数一致）；系数偏差 ≤0.03 且只出现在噪声底系数上。

## 3. 注册与提交链路（3.0 → 平台可提交）

`apps/api/src/mdop/l4-fl-e2e.spec.ts` 的里程碑用例：用**真实** `AlgorithmModuleRegistry` 读
`packages/wasm-algorithms/build/manifest.json`（按 SM3 校验）→ `rws.l4-train@1.0.0` 以
**`kind: wasm`** 登记 → `MdopJobsService.submit(buildL4Plan(...))` **成功**。
无模块时的拒绝路径作为回归保留。

## 4. 连接器侧接线（3.1，2026-10-13）

- 算子：`apps/connector/src/mdop/operators/l4.ts`（编码 → 沙箱 → 解码 → C0）+ `wire-l4.ts`（接线，`app.module.ts` 已注册）。
- 执行器：`MdopStageExecutor.registerWasmOperator(前缀, runner)` —— 一个执行器承载多个 wasm 算子（`setWasmRunner` 保留为兜底）。
- 沙箱：`AlgorithmSandboxExecutor.runFixedCompute` —— 通用定点路径，调用形状 `table@1` = `run(0, n, k, outOff)`；
  **worker 未改**（输入写偏移 0、形状由 abi 决定，L4 正好复用 table@1）。
- 复现：`cd apps/connector && npx jest src/mdop/operators/l4.spec.ts` → **3/3**
  （编码头部与 ABI 一致 / L4 与 L1.5 分派互不顶掉 / 摘要不符·缺 spec·缺上游都拒）。

## 5. 出域环与单节点端到端（2026-10-13）

- `buildL4PartyResult`（`l4.ts`）：C0 模型 → **C3 参与方结果**；队列门槛 `n < minCell` **拒绝出域**（fail-closed，不伪造脱敏模型）；
  `localModelHash` 沿用旧链公式（浮点 θ 派生）以便与旧链可比；只有 `allowedArtifacts` 含 `model_weights` 才带 `modelParams`。
- 执行器**处理器链**（`appendSystemHandler`）：同一个 `declassify.small_cell` 由 L1.5 环与 L4 环**按载荷语义分派**，
  注册是追加不是覆盖（此前 `registerSystem` 同 op 会互相顶掉）。
- 复现：`cd apps/connector && npx jest src/mdop/operators/l4.spec.ts` → **6/6**，其中一条是
  **单节点 L4 端到端**：`source.dataset` → `rws.l4-train` → `declassify.small_cell`，
  断言 L4 环认领模型载荷（`sampleCount/localModelHash/moduleSm3` 正确、**没有**被 L1.5 环处理过），
  且 L1.5 的四格表仍由 L1.5 环处理。

## 6. 跨节点夹具（4.x，2026-10-13）：两端各自钉住同一条边界

两个 workspace 不能互相 import，所以边界用**提交进版本库的夹具**钉：

- **产出方（连接器）**：`apps/connector/src/mdop/operators/l4-cross-node.spec.ts` —— 用**真 wasm 模块**
  （`packages/wasm-algorithms/build/fl-logistic.wasm`，SM3 `3137d92c…`）+ **真零能力沙箱**（`WasmSandboxRunner`，形状 `table@1`）
  跑两个参与方的训练，再过 `buildL4PartyResult`（`minCell=5`）产出 C3；
  断言：① 与 `evidence/l4-equivalence/c3-payloads.json` **逐字段相等**（真实字节可复现）② C3 **不含**本地行/规格（那两样是 C0，只在节点内）。
- **消费方（平台）**：`apps/api/src/mdop/l4-fl-e2e.spec.ts` 的跨节点用例 —— 读**同一份夹具**当作各院投递的 C3，
  走 `MdopMergeService.mergeIfReady` → `merge.fedavg` 分派 → 平台交付物 = `mergeFlPartyResults` 对该夹具的结果。

复现：`cd apps/connector && npx jest src/mdop/operators/l4-cross-node.spec.ts`（2/2）·
`cd apps/api && npx jest src/mdop/l4-fl-e2e.spec.ts`（5/5）。

夹具内容：2 个参与方（`p-demohospa`/`p-demohospb`，各 6 行 CKD 表）、`minCell=5`、模块 SM3；
每方是平台合并需要的 `FlPartyRunResult` 形状（`taskId/participantId/roundsCompleted/sampleCount/localMetrics/localModelHash`，
按 `allowedArtifacts` 决定是否带 `modelParams`），外加 `moduleSm3` 供存证追溯。

## 7. 分账与存证的输入核对（4.3，2026-10-13）

**分账：换通道不改变输入。** 依据（可复跑）：
`grep -rn 'settlement\|Settlement' apps/api/src/runtime/fl-orchestrator/*.ts apps/api/src/mdop/*.ts` → **空**。
即两条 L4 通道都**不喂**控制面结算；在跑的唯一结算是 SecretFlow 轨道的预算制（口径不同）。
RWS 轨道控制面结算未接线是**既知 TD-6**，与本次迁移无关，也未被本次迁移改变。
→ 已在 TD-6 加补注：**偿还该债时 MUST 同时覆盖 MDOP 通道的 L4**（否则只补旧通道、漏掉已迁移的）。

**存证：输入按设计变化（不是回归）。**

| | 旧 L4 链 | MDOP 链 |
|---|---|---|
| 锚什么 | 每个任务一次**报告哈希**（`fl-attestation.service.ts` → `attestation.anchor(reportHash)`） | 每个**阶段回执/报价**（`mdop-attestation.service.ts` → `anchorQuoteDigest`、`chain.anchor({source:'mdop-attestation', kind:'node-attestation'})`） |
| 粒度 | 任务级 | 阶段级（更细，迁移的目的） |
| in-migration 期间 | 不受影响（只在旧链完成时触发） | 与旧链并存、各锚各的 |

## 7b. 出域口径复核（2.4，2026-10-14）

**结论：换通道不放松出域口径，且平台无法「把没投递的东西补回来」。** 依据：

- **裁剪在源头强制**：连接器 `apps/connector/src/mdop/operators/l4.ts`（`allowWeights = policy.allowedArtifacts.includes('model_weights')`）——
  只有合约 `outputPolicy.allowedArtifacts` 含 `model_weights` 时，C3 参与方结果里才有
  `modelParams`（`theta`/`intercept`/特征名）；否则那份结果里**根本没有**这些字段。
  正反两例在 `apps/connector/src/mdop/operators/l4.spec.ts`。
- **平台合并不可能新增**：`mergeFlPartyResults`（`apps/api/src/compute-task/dto/fl-run-result.ts`）只按样本量加权
  指标、拼 `modelHash`/贡献列表与隐私摘要，**从不读 `modelParams`** → 聚合口径的合约，合并产物里不会有权重。
  回归保护：`apps/api/src/mdop/l4-fl-e2e.spec.ts` 的 2.4 用例断言合并结果序列化后不含
  `modelParams`/`theta`/`featureNames`，且与 `mergeFlPartyResults` 逐字段相等。
- **接收方（D-MDOP-2）**：平台作为 C3 接收方被写进合约条款（`mdop-contract.service.ts` 的 `withPlatformRecipient`），
  **由持有方签署后才生效**：「平台收到 C3」是合约明示事实，不是默认外发。
- **控制点引用**：TRUST **CTL-01**（OutputGate 产物出域）；C2 侧硬件证明与密钥释放见 **P-CTL-8**。
- 仍未覆盖：**真实连接器进程**级验证（见文末「尚未覆盖」）。

## 8. 作业级：经节点消息投递路径的闭环（2026-10-14 补齐）

`apps/api/src/mdop/l4-fl-node-e2e.spec.ts`（真实服务：提交 → 编译 → 票据 → 下发 → 消息 → 合并 → 销毁）：

- 提交期过**真实 wasm manifest** 的模块闸（`rws.l4-train@1.0.0`，kind=wasm，来自 `packages/wasm-algorithms/build/manifest.json`）；
- 编译后各院片段 = `source.dataset` + `rws.l4-train` + `declassify.small_cell`；**合并片段落在平台**；
- 凭证**冻结全部三个片段的哈希**；
- **L4 计划没有 C2 边**（本地训练直接读本地数据集，不经信封）→ 凭证不冻「C2 接收方」的执行环境期望：这是与 C2 形态作业的**结构性差别**，用例里显式钉住（`core.attestation` 为 undefined）；
- 各院阶段状态 + `ArtifactReady`/`ResultDeliver` 投递的是**连接器真 wasm + 真沙箱**产出的黄金夹具（见 §6）；
- 平台按计划里的 `merge.fedavg` 合并（即使消息控制器传的是 L1.5 形态 analysis 也优先 L4）→ 合并结果与 `mergeFlPartyResults(夹具, spec, {runtime:'connector-ml'})` **逐字段相等** → 作业 `SUCCEEDED`；
- 销毁：两院都在范围内，收齐（排除平台自身）才 `PURGED`。

边界：平台侧是**真实实现**；各院节点按协议扮演。真实 TDX 节点的作业级形态另见
[../../tdx-attestation-pilot/evidence/rerun-20261014/](../../tdx-attestation-pilot/evidence/rerun-20261014/README.md)。

## 9. web 收敛（5.2，2026-10-14）

照 L1.5 的 C 类处理（**不删共用页、不加重定向**）：

- **新任务页** `apps/web/src/app/(console)/space/tasks/new/fl-prediction/page.tsx`：改调
  `api.submitMdopFlPrediction`（`POST /mdop/jobs/fl-prediction`，载荷字段与 `L4TemplateInput` 逐字段一致：
  `purpose/applicant/contracts/hospitals/spec/minCell/notBefore/notAfter`），提交后跳
  `/space/mdop/jobs/<jobId>`（与 L1.5 页同一落点）。迁移期平台侧对「未到切换日」的 key **仍放行**（只记告警，
  `mdop.controller` 的 `assertEntryKeyAllowed`），所以它能先于 5.1 的 `cutoverAt` 生效。
- **历史任务详情** `apps/web/src/app/(console)/space/tasks/[id]/page.tsx`：对 FL 任务显示
  「迁移前经旧通道产生 / 只读历史」标注（与 L1.5 那一块同形）；旧 `cp_fl_prediction_*` 行保持只读可见。
- **MDOP 作业详情页** `apps/web/src/app/(console)/space/mdop/jobs/[id]/page.tsx`：补 L4 结果分支 ——
  `FlRunResult` 没有 `analysisType`/`buckets`，原页面会**什么都不显示**；现展示跨院合并模型 hash、轮次、
  样本量加权的聚合指标，以及参与方贡献表（样本数/轮次/AUC/`localModelHash`），并按合约是否交付
  `model_weights` 如实标注「含/未含权重包」（与 7b 的出域口径同源）。
- **客户端** `apps/web/src/api/client.ts`：`getMdopJob` 的 `result` 类型补 L4 字段。

仍未做：旧通道 API 与 FL 旧列表页（`space/federated`，在台账 `legacyRefs` 里）**保留到 5.4**；
`cutoverAt` 与观察窗属 5.1/5.3，未动。
## 尚未覆盖（如实列出）

- **多轮/多院轮次语义**（3.3）：1A 可执行的部分已强制并有用例——**阶段 id 作业内唯一**（提交期 fail-loud，否则主键 `jobId#stageId` 会静默合并两轮）、**任一片段未回执不放行且无平台结果**、**合并幂等**（`apps/api/src/mdop/l4-rounds.spec.ts`）。跨院多轮（轮间把聚合权重发回各院）需要节点到平台的新通道与安全聚合，属 **1B / D-MDOP-8**；1A 的 `spec.rounds` 仍是院内 epochs（wasm 内一次调用完成）。
- **真实连接器进程**参与的作业级 e2e：本仓内是「平台真实 + 节点按协议扮演」；线上真机形态见 TDX 试点复跑证据。
