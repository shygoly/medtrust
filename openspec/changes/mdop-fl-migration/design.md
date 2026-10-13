# 设计：L4 联邦预测迁入 MDOP

## 1. 两条链的现状（事实，不凭印象）

| 面 | 旧链（当前） | MDOP 侧（本变更建成后） |
|---|---|---|
| 任务表 | `cp_fl_prediction_task` / `cp_fl_prediction_assignment` | `cp_mdop_job / fragment / stage / ticket / attestation / receipt` |
| 平台编排 | `apps/api/src/runtime/fl-orchestrator/`（service / persistence / admission / attestation） | `apps/api/src/mdop/`（jobs / ticket / scheduler / merge） |
| 任务规格 | `compute-task/dto/fl-prediction-task-spec.ts`（`FlPredictionTaskSpec`，HFL + `fedavg|secureboost` + 白名单产物） | **同一份规格**（模板输入复用，避免两套字段语义） |
| 院内训练 | `apps/connector/src/domain/fl-prediction/`：`fl-task-runner.ts`（LR+FedAvg 无 sidecar）、`local-logistic.ts`、`http-fl-adapter.ts`（其它模型走 connector-ml）、`fl-dp-gate.ts`、`fl-output-guard.ts`、`fl-tabular-materializer.ts` | L4 算子**注入**上述实现（`runLocalTrain` 等），wiring 形态同 `connector/src/mdop/operators/wire-l15.ts` |
| 出域 | `outputPolicy.allowedArtifacts`（`aggregate_and_model`）+ 小单元格抑制 + DP 闸门 | 同口径，走 MDOP 出节点守卫 |
| web | `/space/tasks/new/fl-prediction` → `/space/tasks/{id}?workload=fl_prediction` → `/space/infer/{taskId}` | 模板入口 → `/space/mdop/jobs/{id}`（推理入口不变，见 D5） |

## 2. 关键决策

### D1 复用而不是重写（并把它写进台账 `retained`）

> **D1 修正（2026-10-13，实施平台侧时发现——推翻"直接注入 TS 训练函数"的写法）**
>
> 平台算子 schema 明令：「承载受托分析逻辑的算子 MUST 是 `wasm` 或 `oci`；`system` 只许
> `source`/`declassify`/`merge`」（`packages/mdop/src/schema/operator.ts:19`，D-MDOP-5；另有
> `SYSTEM_ALLOWED_CATEGORIES` 与"system 不许冒充分析算子"的校验）。因此：
> - 节点侧的 `rws.l4-train@1.0.0` **必须**是一个**已准入的 wasm 模块**（可复现构建 + SM3，经
>   `AlgorithmModuleRegistry` → `MdopOperatorRegistryService.buildWasmManifest` 自动登记为 `kind: wasm`）；
> - 「复用」的准确含义是：**把 `apps/connector/src/domain/fl-prediction/local-logistic.ts` 的
>   LR 逻辑移植/编译成 wasm 模块**（同一算法、同一超参口径、同一随机种子），而**不是**在算子清单里
>   直接注入 TS 函数；连接器算子只做"接线 + 过 sandbox"（形态同 L1.5 的 `runProportionality`）。
> - TS 实现**仍进台账 `retained`**：它是 wasm 的**参考实现与对拍基准**（作用同 L1.5 的
>   `disproportionalityTables`，属 `test-reference`）。
> - 影响：在 wasm 模块落地前，`buildL4Plan` 产出的计划会在 `MdopJobsService#submit` 被
>   「阶段引用了未注册的算子」拒——**平台侧代码正确但不可端到端提交**（这是已实施的已知边界）。
院内训练与平台聚合都**已有实现**（`local-logistic.ts`、`mergeDisproportionalityAggregates` 式的
同源复用先例：MDOP 的 L1.5 合并算子直接 import 旧计算模块）。本变更沿用这条路线：
- `apps/connector/src/domain/fl-prediction/*` 里被 MDOP 算子注入的部分 → 台账
  `retained: [{ path, reason: "shared-runtime" }]`，守护 O6 保证「下线旧接线」时不会被整体删掉；
- `apps/api/src/runtime/fl-orchestrator/` 里**只属于旧通道**的部分（controller / persistence /
  旧 assignment 完成回传）才是 `legacyRefs` 的下线目标。

> 这条决策的教训来自 L1.5：我最初把共享计算模块写成了下线目标，会让 MDOP 一起坏（守护 O6 已拦）。

### D1b L4 的 wasm 模块必须是"整数核心"（2026-10-13 审计出的硬约束，**待裁决**）

审计 `packages/wasm-algorithms` 的既有模块后确认一条**贯穿性设计规则**：

- wasm 模块**只做整数计数**：`modules/ve-tnd-as/assembly/ve-tnd.ts` 只有 `store<u32>` 计数，
  **无** `f64/f32/exp/log/sqrt`；浮点统计一律留在 **TS 参考模型**（`src/ve-tnd-model.ts` 用 `Math.exp/log` 由计数派生 OR/CI）。
- 对拍是**逐字节相等**（`scripts/*-parity.test.mjs` 用 `assert.deepEqual`/`equal`，无容差）；
- 另有**可复现构建闸**（`scripts/check-reproducible.mjs`：源码重建必须逐字节同 SM3）。

LR 训练天然是浮点，而 AssemblyScript 的 `exp/log` 与 V8 **不保证逐位一致**，所以 L4 的
`rws.l4-train` 不能照搬现在的 TS 训练实现。四个选项（**需产品/研究侧裁决**）：

| 选项 | 做法 | 代价 |
|---|---|---|
| **A 定点整数 LR** | wasm 用 Q16.16 定点做梯度下降，TS 参考做同一算法 | 模型数值口径变定点，精度影响需研究侧接受 |
| **B 拆分（推荐）** | wasm 只出**整数充分统计量**（每特征梯度累加和整数值、混淆矩阵计数、样本数）；FedAvg 与指标在平台侧 TS 做（整数和 → 精确、可逐字段对拍） | 需设计梯度累加和的量化方案；L4 协议从"聚合模型权重"改成"聚合充分统计量" |
| **C 放开浮点** | wasm 内用 f64，parity 改**容差** | 破"逐字段一致"口径；与既有 parity/可复现文化冲突，须先改政策 |
| **D 用 `oci`** | 镜像算子 | `DISABLED_KINDS` 本期禁用，不可行 |

> **未裁决前 3.0 不得开工**（否则等于替研究侧决定模型数值口径）。推荐 **B**：它与仓库既有
> "wasm 出计数、TS 出统计量"的架构完全同构，且不牺牲逐字段对拍。

### D1c 定点原型的实测（2026-10-13，为 D1b 的裁决提供数据）

原型：[`apps/connector/src/domain/fl-prediction/local-logistic-fixedpoint.proto.spec.ts`](../../../apps/connector/src/domain/fl-prediction/local-logistic-fixedpoint.proto.spec.ts)
（Q16.16 + 整数 sigmoid 查表 + 可累加批量梯度下降；**原型非生产实现**，wasm 版会把查表烘焙成常量）。

同一夹具、同一超参下的实测（`console.log` 直接打在测试输出里，可复跑）：

| 数据集 | aucFloat | aucFixed | \|Δauc\| | max\|Δθ\| | 符号一致 |
|---|---|---|---|---|---|
| 200 例（可分） | 0.9177 | **0.9177** | **0.0000** | 0.0273 | 9/10 |
| 4000 例（低事件率；线上 AUC 0.418 那次出事的队列） | 0.8328 | **0.8328** | **0.0000** | 0.0071 | 9/10 |

- 唯一符号不一致的是 `sex=male`：浮点 **+0.0093** / 定点 **−0.0053** —— 两者都 ≈0（噪声底），
  不是「精度掉了」，而是「这个系数本来就没有信息」。
- 低事件率组的关键暴露系数：`insulinFloat=0.3019` vs `insulinFixed=0.2979`（Δ≈0.004）。
- 定点实现有两个**结构性好处**：① 同输入 → 逐字节同输出（可复现、可对拍）；
  ② 整数 FedAvg 可**精确累加**（原型用 120:80 加权验证 `agg == 单院`，无浮点误差）—— 正是选项 B 要的性质。

**结论（供裁决）**：定点替换优化器在这组数据上**不损失 AUC**（4 位小数一致），系数偏差 ≤0.03 且只出现在噪声底系数上。
因此 A（定点 LR）与 B（整数充分统计量 + 平台聚合）都**可行**；差别只在「聚合什么」——
B 要把 IRLS/阻尼牛顿换成可累加的 GD，而本原型已经证明**这个替换的代价可接受**（AUC 不变、系数微移）。

### D1d 推荐选项 B 的具体形态（ABI 草案 + 聚合协议 + 对拍计划）

前提：wasm 只做整数（D1b）；定点替换不损失 AUC（D1c 实测 |Δauc|=0）。**裁决后即可照此实施。**

#### 1. 职责切分（谁变、谁不变）

| 层 | 旧链 | L4 迁入 MDOP 后 |
|---|---|---|
| 节点内训练 | 浮点 IRLS/牛顿（TS） | **wasm 模块** `rws.l4-train@1.0.0`：定点 GD（Q16.16），输出定点权重 + 整数计数 |
| 节点内派生统计 | 同一 TS 函数 | **保持 TS**（连接器侧，非算子）：定点权重转浮点指标，`evaluateLogistic` 口径不变 |
| 平台聚合 | `mergeFlPartyResults` 按样本量加权 | `merge.fedavg`：**同一份**函数（口径不变） |
| 出域判定 | outputGate + DP 闸门 + allowedArtifacts | **不变** |

#### 2. 隐私边界（写这一节时发现的，必须守住）

**1A MUST NOT 新增任何「节点→平台」的数据通道。** L4 的既有协议里，平台只收到**本地指标 + 本地模型哈希 + 样本数**
（`FlPartyRunResult`）；`mergeFlPartyResults` 也只对指标做加权平均，**不合并权重、不收梯度**。
因此选项 B 的准确含义是：**定点化只发生在节点内**（把 IRLS 换成定点 GD，换取「整数 = 可复现 + 可对拍」），
**不是**把梯度或充分统计量送到平台聚合 —— 那等于新增出域通道，与 D-MDOP-8「平台只收聚合和」以及
「节点间安全聚合未落册前不得开工」直接冲突（那是批次 1B 的范围）。

> 因此 B 与 A 的差别**不在隐私面**（两者出域都与今天一致），而在 wasm 出什么：
> 1A 里 B 就是 A（wasm 出定点权重，节点内接着算指标）；**只有当将来需要跨院合并权重时**才升级为
> 「整数加权合并 + 安全聚合」，那一步必须等 D-MDOP-8。

#### 3. ABI 草案（与既有 wasm 模块同形：宿主给 memory，模块只读写固定偏移）

输入（宿主写入，全部整数）：`n` 行数 · `d` 特征数 · `epochs` · `stepQ` · `l2Q` ·
`scaleQ[d]`（各特征缩放，Q16.16）· `XQ[n*d]`（特征，Q16.16）· `y[n]`（0/1）。

输出（模块写入 `outOff`）：`thetaQ[d]` · `interceptQ` · `nSamples` · `positives`（后两者供平台按样本量加权用）。
返回 `status`（0 正常 / 非 0 错误码）。

**sigmoid 查表烘焙成模块常量**（构建期由同源 TS 生成同样一张表）—— 绕开 AS 与 V8 在 `exp` 上的差异，
这正是 D1b 要求整数核心的原因。

#### 4. 对拍计划（闸门①；两条不同标准，不要混）

| 对拍 | 标准 | 为什么 |
|---|---|---|
| wasm(定点) vs TS(**同一**定点算法) | **逐字段相等** | 与既有 `*-parity.test.mjs` 同标准：算法只有一份，任何不一致都是 bug |
| 定点 vs 浮点 IRLS（旧链参考） | **容差**：|Δauc| ≤ 0.005、|θ|>0.05 处符号一致 | 换的是数值口径（D1c 实测 |Δauc|=0、max|Δθ| ≤ 0.03、唯一符号翻转在 ≈0 的噪声底系数上） |

#### 5. 裁决后要做的最小改动清单

1. `packages/wasm-algorithms/`：新增 `modules/fl-logistic-as/assembly/fl-logistic.ts` + `src/fl-logistic-model.ts`（TS 定点孪生）+
   `PLATFORM_MODULES` 加一条（`analysisType: fl-logistic`，`operator: { id: rws.l4-train, category: local, environments: [plain], inputs: C0 表, outputs: C0 表 }`）+ `scripts/fl-logistic-parity.test.mjs`；
2. `scripts/build.mjs` 重建 → `build/fl-logistic.wasm` + `manifest.json` 的 sm3（可复现闸自动验收）；
3. 连接器 `mdop/operators/l4-train.ts` 经 sandbox 调该模块（形态同 `wire-l15.ts`）；TS 参考留作 `retained.test-reference`；
4. 台账 `fl.l4-prediction.retained` 已写好，无需再改；
5. 证据档 `evidence/l4-equivalence/README.md` 记录上述两类对拍的实测数字。

### D2 等价性判据（闸门①）
固定 fixture（同一份合成表、同一超参、同一随机种子）、**同一样本数**下比较：
`auc / f1 / precision / recall / calibration_curve（若产物包含）/ 样本数 / localModelHash`。
- 逐字段一致 ⇒ 记通过；
- `localModelHash` 允许因**张量顺序**差异而不同，但必须能证明「哈希不同、指标一致」并写进证据档
  （否则改口径 = 静默改变存证语义）。
- 数学上：LR+FedAvg 的合并是**样本数加权平均**，与旧链 `finishMultiAgentFedAvg` 同式；测试要钉住这一点。

### D3 轮次与部分参与：按 MDOP 重定义，不复用旧 `partial`
旧链的 `partial`（部分参与即出结果）与 MDOP 的「片段要约 → 凭证 → 执行」不一致（D-MDOP-1 已否决复用）。
本变更定义：
- 一个作业的**参与方集合在编译期冻结**（计划里列明）；
- 任一片段未回执/超时 → 作业不进入 `RELEASING`（fail-closed），不产生「部分结果」；
- 多轮（若模型需要）：轮次是**作业内的 stage 序列**，每轮幂等键 = `jobId + round`，重派不重复计数。

### D4 模型参数的出域口径
`model_weights`（FedAvg 系数包）是**聚合后**产物，按合约 `outputPolicy.allowedArtifacts` 与
D-MDOP-2 接收方列表出域；**单院更新不出平台**这条由后续 D-MDOP-8 覆盖（1B 才强制）。
本变更**不**声称已具备节点间安全聚合——如实写在设计里，避免与 1B 混淆。

### D5 推理入口不迁（本变更边界）
`/space/infer/{taskId}`（本地推理，用 `fl_weight_bundle`）依赖的是**产物格式**而不是编排通道；
本变更新增 `migrated` 后仍保留该入口，仅把「任务从哪来」换成 MDOP 作业。若产物格式也要改，
另立变更。

### D6 下线顺序（沿用六条闸门）
`migrated`（双跑对拍 + 证据）→ `cutoverAt`（旧入口 409）→ **5 天观察窗**（O7 机检，
回滚用 `ORCHESTRATION_FORCE_CHANNEL=fl.l4-prediction=legacy` 演练）→ 删旧接线 → `legacy-removed`。
窗口内**不删** `cp_fl_prediction_*`（规矩 3：旧数据只读保留）。

## 3. 不变量

- **I1** 一条类型一条通道：`fl.l4-prediction` 任一时刻只有一个 `channel`，由台账唯一决定。
- **I2** 不双写：MDOP 的 L4 作业 MUST NOT 写 `cp_fl_prediction_*`（守护 O8 静态扫 + 写入边界断言）。
- **I3** 等价先于切换：闸门①的证据在案才允许置 `cutoverAt`。
- **I4** 旧数据只读：`cp_fl_prediction_*` 的历史行不下线，只下线代码路径。

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 训练非确定性导致对拍不稳 | 固定种子 + 同超参；若某指标天然抖动，先在两链路各跑 N 次取**同值区间**并把「区间口径」写进证据档，不得用「差不多」结论 |
| 连接器侧 `connector-ml`（sklearn sidecar）参与对拍 | 对拍范围先限 **LR+FedAvg**（无 sidecar、纯院内）；xgb/rf 走 sidecar 的对拍单列一轮 |
| 旧链有隐藏消费者（结算/存证按 assignment 计量） | 迁移前先跑 A4/A5 式清点（结算 5 处、存证 5 处），把「分账输入不因换通道而变」写成用例 |
| **L4 合并结果带 `undefined` 成员 → 交付摘要被 JCS 拒绝**（2026-10-13 e2e 实测抓到，链路会崩） | 已在**算子边界**加 `dropUndefinedDeep`（不动 canonicalizer 的严格、也不改旧链共享函数）；算子 spec 钉住"输出必须 JCS 可规范化且与 JSON 往返一致"；`l4-fl-e2e.spec.ts` 端到端复现 |
| 与 1B 混淆导致安全聚合被误认为已覆盖 | 设计与本变更标题都写明「不含节点间安全聚合」；台账 `fl.lora-fedavg` 保持 `in-migration` 且带 `blockedBy` |
