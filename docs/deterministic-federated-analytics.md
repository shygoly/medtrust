# 监管级一致性联邦分析（Regulatory-grade Deterministic Federated Analytics）— 需求方案

> 状态：**需求草案（未实施）**。本文只定义"要什么、验收标准是什么、不做什么"，不含实现。
> 命名空间提案：`DET-x`（计算一致性控制点），与 `CTL-x`(TRUST) / `EVD-x`(EVIDENCE) / `INV-x`(DOMAIN) / `D-x`(DECISIONS) 正交。
> 定位分工：**TRUST 管数据可信（泄露/虚标）· EVIDENCE 管结论可信（偏倚/p-hacking）· DET 管数值可信（同输入是否同结果、联邦结果与基准差多少）**。

---

## 0. 结论先行

三条判断，决定这个方案怎么做：

1. **本仓大部分数值风险不是"浮点科学计算"问题，是"工程规范"问题。**
   控制平面与连接器的统计计算全部跑在 **单线程 V8（TypeScript）** 上——没有 Spark、没有 Dask、没有多线程 BLAS、没有 GPU、没有近似分位数。用户清单里的 MKL 线程调度、cuBLAS Tensor Core、`approxQuantile`、Ray 归约顺序，在这一层**一条都不适用**。真正的风险只有三个：**归约顺序（站点数组顺序）、迭代算法未锁收敛判据、舍入位置未定义**。这三个都能用几十行代码彻底消除，代价接近零。

2. **不要引入 ExBLAS / ReproBLAS / MPFR / Decimal128。** 站点数 k 通常 < 20，把归约输入按 `siteId` 排序后，双精度求和的顺序不确定性**直接归零**——不是"减小到 1e-15"，是**完全消失**。上超级累加器是拿高成本换零收益，且会引入一个我们无法验证的外部数值依赖，反而增加 GxP 验证负担。

3. **必须区分两个不同的承诺，绝不能混为一谈：**
   | 承诺 | 含义 | 适用范围 |
   |---|---|---|
   | **可复现（Reproducible）** | 同输入 ⇒ **bit-exact** 同输出，同哈希 | 明文聚合路径（L0/L1/L1.5/L2） |
   | **可核验（Verifiable）** | 联邦结果与单机基准的差在**预先声明的误差预算**内，且差值被报告 | 密态/迭代/学习路径（L3/L4、HE、FL、Python 平面） |

   HE 的定点编码、FL 的多轮聚合、torch/numpy 的多线程 BLAS，**在物理上做不到 bit-exact**。承诺 bit-exact 就是虚标——虚标本身是 TRUST 红线。方案必须让每个阶梯诚实地声明自己属于哪一类。

**对外能讲的东西不是"我们用了 ExBLAS"，是"我们对每个算子出具一致性验证报告"。** 报告才是能进标书、能进申报附件的交付物。

---

## 1. 现状盘点（代码实证）

### 1.1 两个数值平面

| 平面 | 代码 | 数值栈 | 确定性天然程度 |
|---|---|---|---|
| **TS 平面** | `apps/api/src/runtime/rws-orchestrator/`、`apps/connector/src/domain/` | V8 双精度，单线程，无 BLAS | 高——只差归约排序与判据锁定 |
| **Python 平面** | `apps/agent/`（torch / numpy / scikit-learn / lifelines）、`apps/connector-ml/` | 多线程 BLAS，可能 GPU | 低——需环境固定 + 误差预算 |

结论：**两个平面必须适用不同的一致性等级**，不能一刀切。

### 1.2 三个已确认的具体缺陷

**DEF-1 · 归约顺序未固定（TS 平面，L2）**
[meta-analysis.ts:131-150](apps/api/src/runtime/rws-orchestrator/meta-analysis.ts:131) 的 DerSimonian–Laird 合并，`effects` / `variances` / `feWeights` 的顺序直接来自 `sites` 数组；而 `sites` 由 [comparative-effect-merge.ts:10](apps/api/src/runtime/rws-orchestrator/comparative-effect-merge.ts:10) `extractSiteEffects` 从 `assignments` 顺序映射，**未排序**。站点回传先后顺序不同 ⇒ 加权和的累加顺序不同 ⇒ `pooledEffect` / `q` / `tau2` 在 ULP 级不同。

对照之下，[meta-analysis.ts:185](apps/api/src/runtime/rws-orchestrator/meta-analysis.ts:185) 的 `fingerprintSiteEffects` **却按 `siteId` 排序了**。即：**指纹声称输入是规范化的，计算实际上不是**。这是当前最尖锐的一处不自洽。

**DEF-2 · 结果哈希含时间戳，复现验证在结构上不可能**
[meta-analysis.service.ts:73-89](apps/api/src/runtime/rws-orchestrator/meta-analysis.service.ts:73) 的 `resultPayload` 包含 `mergedAt: new Date().toISOString()`，`resultHash` 由它算出并上链存证。后果：**同一份输入重跑，resultHash 必然不同**。存证证明的是"这次跑过"，不是"这个输入必然得到这个结果"。监管场景要的是后者。

**DEF-3 · 舍入位置未定义**
`rws-orchestrator/` + `connector/src/domain/` 共 **46 处** `toFixed(...)`，散落在中间量与输出量上（如 [comparative-effect-merge.ts:47](apps/api/src/runtime/rws-orchestrator/comparative-effect-merge.ts:47) 的 `rate` 用 `toFixed(4)`，指纹用 `toFixed(6)`，`i2Percent` 用 `toFixed(4)`，`weightPercent` 用 `toFixed(2)`）。没有统一规则说明**哪些是展示舍入、哪些进入哈希、哪些参与后续计算**。副作用之一：指纹的 `toFixed(6)` 会把 1e-8 级差异抹平——两次运行指纹相同但 `resultHash` 不同，验证逻辑自相矛盾。

### 1.3 已有的可复用基础

不是从零开始。`inputFingerprint` / `resultHash` / `attestation` 三件套已经存在于 meta 合并路径（`MetaMergeOutcome`），链上存证通道已通。**本方案主要是把这套机制做正确并推广到全部算子**，不是新建。

---

## 2. 一致性分级目标

对每个阶梯声明可达等级，写进任务结果，不达标就不许声称。

| 阶梯 | 算子 | 计算平面 | 目标等级 | 依据 |
|---|---|---|---|---|
| L0 | 算法验证（混淆矩阵、Se/Sp/PPV） | TS | **R0 bit-exact** | 整数计数 + 有理数除法 |
| L1 | 描述性计数 | TS | **R0 bit-exact** | 整数可加 |
| L1.5 | 失衡信号（2×2 逐格相加、ROR/PRR） | TS | **R0 bit-exact** | 池化是整数加法（[disproportionality.ts:22](apps/api/src/runtime/rws-orchestrator/disproportionality.ts:22)），排序后无歧义 |
| L2 | 站点 logistic/Firth → DL 随机效应 meta | TS | **R1 确定性复现**（固定顺序 + 锁迭代判据后可 bit-exact） | 迭代求解，需锁 tol/maxIter |
| L3 | 因果（PSM / IPTW / Cox） | TS + Python | **V1 误差预算内可核验** | lifelines/sklearn，多线程 BLAS |
| L4 | FL 预测（FedAvg / HE 聚合） | Python + 密态 | **V2 误差预算 + 收敛区间声明** | 多轮聚合 + 定点编码，bit-exact 不可达 |

等级定义：

- **R0 — Bit-exact 可复现**：同输入必然产出完全相同的 IEEE754 位模式与完全相同的 `resultHash`。
- **R1 — 确定性复现**：在锁定的运行时约定（顺序、迭代判据、舍入规则）下达到 R0；约定变更即视为算子版本变更。
- **V1 — 可核验**：与单机参考实现的差满足预先声明的误差预算，差值随结果报告。
- **V2 — 可核验（含随机性）**：在 V1 基础上额外固定 PRNG 算法与种子，并声明多次运行的结果离散度。

---

## 3. 需求条目

### DET-01 · 规范化归约顺序（必做，最高优先级）
所有跨站聚合在进入数值计算前，**必须**按稳定键（`providerId` / `siteId` / `stratum.key`）做确定性排序；排序发生在**计算入口**，而非仅在指纹/展示环节。
**验收**：把站点数组随机打乱 100 次，`pooledEffect`、`q`、`tau2`、池化 2×2 的输出必须 bit-exact 相同（`Object.is` 比较，不允许 `toBeCloseTo`）。

### DET-02 · 结果哈希去除非确定性字段
`resultHash` 的输入载荷**只允许包含由输入决定的量**。`mergedAt`、`taskId`、执行者标识等运行时元数据移出哈希载荷，改为与哈希并列的独立字段（仍上链，但不参与哈希）。
**验收**：同一输入相隔任意时间重跑两次，`resultHash` 相同。

### DET-03 · 舍入契约
定义三类数值并强制区分：
- `internal`——参与后续计算，**禁止**任何 `toFixed`；
- `attested`——进入指纹/哈希，采用统一的规范化序列化（固定有效数字位数或直接用 IEEE754 十六进制），全仓一个规则；
- `display`——仅供 UI/报告，舍入自由。
**验收**：`internal` 路径上出现 `toFixed` 即 lint 报错；`attested` 舍入精度与 R0/R1 断言精度一致（当前指纹 6 位 vs 断言 bit-exact 的矛盾必须消除）。

### DET-04 · 迭代算法判据锁定
IRLS / Newton / Firth / Cox 偏似然等一切迭代求解，必须显式声明并锁定 `tolerance`、`maxIterations`、初值策略、收敛判据（绝对/相对/梯度范数），且这些参数随结果一起回传与存证。未收敛必须 **fail-closed**，禁止静默返回最后一次迭代值。
**验收**：结果对象含 `solver: { tol, maxIter, iterations, converged }`；`converged=false` 的任务状态为失败而非完成。

### DET-05 · 可合并统计量（Mergeable Statistics）
凡涉及方差/协方差的联邦合并，**禁止**使用 `E(x²) − E(x)²`；站点侧回传 `(n, mean, M2)` 三元组，中心侧用 **Chan / Welford 合并**。当前 L2 走的是站点效应量 + meta 合并（已避开该坑），但新增任何"跨站方差/相关"算子前此条即生效。
**验收**：构造 mean≫sd 的极端数据集（如 mean=1e8, sd=1e-2），合并方差与单机基准的相对误差 < 1e-12；朴素公式在同数据上必须被测试证明失败（作为回归护栏）。

### DET-06 · 精确顺序统计量
中位数、分位数、IQR **一律使用精确算法**，禁止近似 sketch。若未来因数据量被迫引入 KLL/GK，必须显式声明误差边界，且监管路径（L0/L2 及以上）默认拒绝近似结果。
**验收**：算子元数据含 `exact: true`；`exact: false` 的结果被 admission 闸门拒绝进入监管级任务。

### DET-07 · 随机性统一
Bootstrap / permutation / 交叉验证 / FL 抽样等一切随机过程：统一 PRNG 算法（推荐 Philox 或 PCG，跨 TS/Python 实现一致），种子由任务规格派生（`seed = SM3(taskId ‖ operatorVersion ‖ siteId)`），种子随结果留痕。禁止 `Math.random()` 与未设种子的 `np.random`。
**现状**：TS 平面 `Math.random()` 在域逻辑中零命中（已核实），Python 平面测试中已用 `np.random.default_rng(seed)`——本条主要是**把现有良好习惯固化为闸门**，成本低。
**验收**：CI 静态检查禁止裸 `Math.random` / `np.random.*`（非 `default_rng(seed)`）出现在算子路径。

### DET-08 · Python 平面确定性运行时
针对 `apps/agent` / `apps/connector-ml`：
- 容器镜像 digest 固定，`numpy`/`scipy`/`torch`/`sklearn`/`lifelines` 版本 pin 死；
- `OMP_NUM_THREADS` / `MKL_NUM_THREADS` 固定（监管任务建议 =1）；
- `torch.use_deterministic_algorithms(True)`、`PYTHONHASHSEED` 固定；
- 上述环境指纹写入结果元数据并存证。
**验收**：同镜像同环境重跑 L3 任务，结果满足所声明的 V1 预算；环境指纹变化 ⇒ 算子版本视为变更。

### DET-09 · 标准算子库与版本
把统计算子收敛为**一套带版本号的实现**（`operatorId` + `operatorVersion` + 实现哈希），所有参与方调用同一份。参与方**不得**各自用本地 R/SAS/Python 计算后回传效应量——那样一致性无从谈起。
**验收**：每个回传聚合携带 `operatorId@version`；中心侧发现版本不一致即拒绝合并（fail-closed），而不是"尽力合并"。

### DET-10 · 误差预算与参考基准
为每个算子定义：参考数据集（固定、版本化）、单机参考实现产出的 ground truth、允许的绝对/相对误差阈值。R0/R1 算子阈值为 0；V1/V2 算子阈值需显式声明并有方法学理由。
**验收**：CI 中每个算子对参考数据集跑一致性测试；超预算即红。

### DET-11 · 一致性验证报告（对外交付物）
每个 RWS 任务可导出一份报告，包含：算子 id/版本/实现哈希、一致性等级（R0/R1/V1/V2）、参与站点与其回传指纹、归约顺序、迭代判据与实际迭代数、随机种子、运行环境指纹、与参考基准的误差、`inputFingerprint` / `resultHash` / 链上存证回执。
**验收**：报告可离线复现——第三方拿到报告 + 各站聚合量，能独立重算出同一 `resultHash`。

### DET-12 · 显著性边界告警
当 p 值落在判定阈值的数值敏感带内（如 |p − α| < 算子声明误差的 10 倍），结果必须标注"数值边界"警示，禁止直接呈现为显著/不显著的二元结论。
**验收**：边界情形下结果对象含 `numericBoundaryWarning`，UI 与报告均需呈现。

---

## 4. 明确不做（避免过度工程）

| 技术 | 不采用的理由 |
|---|---|
| **ExBLAS / ReproBLAS** | 本仓 TS 平面无 BLAS 依赖；DET-01 排序已让顺序不确定性归零。引入外部数值库反而增加 GxP 验证面。 |
| **MPFR / Decimal128 / 高精度累加器** | k<20 的加权和，双精度在固定顺序下精度冗余极大。Kahan/Neumaier 若真需要，20 行即可自实现，不引依赖。 |
| **确定性 BLAS 深度调优（MKL_CBWR 等）** | 仅 Python 平面相关，且 DET-08 的"线程数=1 + 版本 pin"已覆盖绝大部分场景。 |
| **对 HE/FL 承诺 bit-exact** | 物理不可达。承诺即虚标，触 TRUST 红线。改为 V1/V2 误差预算。 |

---

## 5. 治理接入

| 契约 | 需要的改动 |
|---|---|
| **DECISIONS.md** | 新增 `D-DET-1`：采用"分级一致性（R0/R1/V1/V2）"而非全局 bit-exact；`D-DET-2`：不引入 ExBLAS 类外部数值库，以规范化归约替代。 |
| **EVIDENCE.md** | §3 待接入表新增：结果的数值一致性等级须随结论报告（与 EVD-10 敏感性分析全报同源思路）。DET 与 EVD 边界：EVD 管"设计有没有偏倚"，DET 管"同一设计算两次是否同一答案"。 |
| **TRUST.md** | 红线补充：**声称的一致性等级高于实际可达等级 = 虚标**，与现有虚标红线合并。 |
| **DOMAIN.md** | 若落地 `operatorId/operatorVersion`、`solver`、`consistencyLevel` 等字段，须同步实体/词汇表。 |
| **ARCHITECTURE.md** | 新增"确定性计算运行时"层次描述（TS 平面 / Python 平面的不同约定）。 |

---

## 6. 分期建议

**Phase 1（低成本、高信噪比，建议先做）** — DET-01 / DET-02 / DET-03 / DET-04
把 L0–L2 真正做到 R0/R1，并配上打乱顺序的 bit-exact 回归测试。这一期解决的是**当前代码里真实存在的三个缺陷**，且立刻产生可对外讲的事实："L1.5 与 L2 明文聚合路径 bit-exact 可复现，同输入同哈希，链上可验。"

**Phase 2** — DET-09 / DET-10 / DET-11
标准算子版本化 + 参考数据集 + 一致性验证报告。这一期产出**监管/BD 可用的交付物**。

**Phase 3** — DET-05 / DET-06 / DET-07 / DET-08 / DET-12
Python 平面确定性运行时、随机性闸门、顺序统计量、边界告警。随 L3/L4 深化推进。

**建议顺序上的关键判断**：Phase 1 的工作量远小于它带来的叙事价值——先把"三个缺陷"修掉并写出打乱顺序的测试，比先去建标准算子库更划算。

---

## 7. 待澄清

1. 一致性验证报告的目标受众优先级：内部 QA / 药企 BD / 注册申报附件？三者对报告详略与格式要求不同。
2. L3 的 V1 误差预算阈值由谁定？需要方法学同事给出可辩护的数字，而非工程拍脑袋。
3. 是否要把"一致性等级"暴露到数据产品目录（catalog）层，作为可被合约约束的属性？
