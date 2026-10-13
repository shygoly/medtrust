# L1.5 失衡检测：新旧通道等价性证据（tasks 3.1）

日期：2026-10-13 · 对应台账条目 `rws.disproportionality`（channel=mdop, state=migrated）

## 结论

**计算层等价成立，且是结构性的**：两条通道的合并口径是**同一份代码**，节点侧的 2×2 出自**同一个
已登记 wasm 模块**。风险不在公式，而在**接线**（喂进同一个函数的输入是否一致、MDOP 算子有没有额外
后处理改写数字）——这一层已由本目录下的新测试用固定 fixture + 黄金数字钉住。

因此「下线 L1.5 旧路径」的正确含义是**收敛通道与接线，不是删除计算模块**。台账的 `retained` 记了两类
必须保留的实现（守护 O6 禁止它们作为 `legacyRefs` 的裸字符串出现）：

- `shared-runtime`：`apps/api/src/runtime/rws-orchestrator/disproportionality.ts`（MDOP 合并算子 import 它）
- `test-reference`：`apps/connector/src/domain/rws-executor.ts` 的 `disproportionalityTables`（上表右侧那层对照的**独立参考实现**——删了它，wasm 一致性闸就没有基准了）

## 两层对拍

| 层 | 旧通道 | MDOP 通道 | 关系 | 证据 |
|---|---|---|---|---|
| 平台合并（池化 2×2 → PRR/ROR/χ²/IC/信号） | `rws-persistence.ts` → `mergeDisproportionalityAggregates` | 阶段 `merge.disproportionality@1.0.0` → `mergeProportionality` | **同一函数**（算子第 1 行 import） | 本目录新增测试 `apps/api/src/runtime/orchestration/l15-equivalence.spec.ts` |
| 院内 2×2 计数 | `rws-executor.disproportionalityTables`（内置 TS） | `connector mdop/operators/l15.ts` 的 `runProportionality`（已登记 wasm 模块，未接入即 fail-closed） | **同一 wasm 模块**，且内置 TS 与 wasm 逐字段对拍 | 既有测试：`apps/connector/src/domain/sandbox/admission-gates.spec.ts:101`、`admission-e2e.spec.ts:142`（都在 `pnpm test` 里） |

## 固定 fixture

三院、同一 (drug=阿莫西林 × event=ALT升高)，逐格整数便于人工复核：

| 参与方 | cohortSize | a | b | c | d |
|---|---|---|---|---|---|
| hospital-1 | 465 | 20 | 40 | 5 | 400 |
| hospital-2 | 535 | 10 | 30 | 5 | 490 |
| hospital-3 | 610 | 8 | 22 | 4 | 576 |
| **池化** | **1610** | **38** | **92** | **14** | **1466** |

## 实测数字（测试运行输出，未做心算）

```json
{"pooled":{"a":38,"b":92,"c":14,"d":1466},"cohortSize":1610,"rate":0.0236,
 "prr":30.901099,"prrCi95":[17.198862045866353,55.5198309486409],
 "ror":43.251553,"rorCi95":[22.625327128853943,82.68153686916946],
 "chiSqYates":296.908501,"ic":3.034507,"signal":true}
```

两条通路对同一 fixture 的合并结果 **deep-equal**（`expect(mdop).toEqual(legacy)`）。

## 复现

```bash
cd apps/api && npx jest src/runtime/orchestration/l15-equivalence.spec.ts --forceExit
# 节点侧（既有）：
cd apps/connector && npx jest src/domain/sandbox/admission-gates.spec.ts --forceExit
```

## 本证据不覆盖（故不得据此直接删代码）

- **闸门②「旧表零写入」**：结构上 MDOP 的 L1.5 提交走 `mdop-jobs.service`（写 `cp_mdop_*`），不经过
  `rws-persistence`；运行时由 `assertNoLegacyWrite` 兜底。但要留证仍需在真实环境观测一次。
- **闸门③「旧路由/页面/端点零引用」**：web 的 `viaMdop` 开关与旧详情页仍在（tasks 3.3/3.4）。
- **闸门④⑤**：5 天观察窗与回滚演练（`ORCHESTRATION_FORCE_CHANNEL`）。
- 连接器侧**真实计划**端到端（本证据用的是同一模块的既有对拍，不是一次真实作业的快照对拍）。
