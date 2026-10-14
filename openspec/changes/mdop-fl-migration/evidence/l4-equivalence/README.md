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

## 尚未覆盖（如实列出）

- **多轮/多院轮次语义**（3.3）：当前 ABI 一次调用完成本地训练；跨院轮次见 design D3（1A 不新增节点到平台的新通道）。
- **真实连接器进程**参与的作业级 e2e：本仓内是「平台真实 + 节点按协议扮演」；线上真机形态见 TDX 试点复跑证据。
