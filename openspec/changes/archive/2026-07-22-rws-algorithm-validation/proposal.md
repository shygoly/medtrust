## Why

药监《真实世界数据支持药品安全性主动监测的研究设计和分析指导原则》（征求意见稿）把"两层定义"列为核心方法学点：任何研究人群与关键变量都须有**概念性定义**（涉及哪些数据元素）与**操作性定义**（编码或算法 + 评估时间窗），且 **§2.6 / §2.7.4 明确要求"必须报告所用编码/算法的准确性"**。

本仓当前对此**完全没有承载**（[EVIDENCE.md](../../../EVIDENCE.md) 覆盖矩阵第 11、12 项，待接入项 P-EVD-2，是全表最大缺口）：`TteSpec.inclusion` / `exclusion` / `outcome.event` 都是自由文本，识别算法既不能被表达，更不能被验证。后果是连锁的——**错分偏倚（§2.8）无法评估**，因为评估错分的前提就是知道算法的灵敏度与特异度；而错分偏倚是常规诊疗数据（非为研究而生）最常见的偏倚类型。

现在做的另一个理由：验证研究的出域载荷是 **2×2 混淆矩阵（TP/FP/TN/FN）**，与已实现的 L1.5 失衡信号四格表**结构同构**，可直接复用现有输出闸门（n<5 抑制）与跨院按格相加的合并逻辑。边际成本低，而它解锁的是整份指导原则里对系统要求最硬的一条。

## What Changes

- **新增 `algorithm-validation` 能力（RWS 阶梯的 L0 验证层）**：以"识别算法 vs 金标准标注"的本地比对，产出该算法在该数据源上的准确性指标。L0 的定位是**其他层的前置**——L1.5–L4 所用的人群/结局识别算法，其准确性由 L0 给出。
- **识别算法成为一等对象**：新增 `CodeSet`（编码列表：编码系统 + 版本 + 编码集 + 取值来源如门诊/出院诊断、诊断顺序）与 `IdentificationAlgorithm`（编码集 + 布尔组合规则 + 评估时间窗）。这是操作性定义在系统中的载体。
- **新增出域产物类别 `validation_metrics`**：灵敏度、特异度、PPV、NPV，各带 95% 置信区间；底层跨域载荷为 2×2 混淆矩阵计数。
- **输出闸门扩展**：混淆矩阵套用既有小单元格抑制（`DEFAULT_MIN_CELL`）；任一格被抑制时对应指标 MUST NOT 出域（不得用被抑制的格重算指标）。
- **存证**：验证结果哈希上链（算法准确性是可申报证据，须不可抵赖）。
- **多源异质性**：同一算法在不同数据源的准确性可以不同（规范 §2.1 明示）。验证结果 MUST 按数据源分别报告，MUST NOT 跨院平均为单一数值。

**非 BREAKING**：L1.5–L4 现有行为与产物不变，L0 为纯增量。

**Non-Goals（本 change 明确不做）**：
- **不产生金标准**。人工病历审阅是院内医学行为，系统只**消费**医院侧已有的金标准标注（登记库、专病数据库或本次研究的审阅结论），不提供审阅工作台。
- 不做定量偏倚分析（quantitative bias analysis）——那是用准确性指标去校正效应量的下一步，属 P-EVD-6 范围。
- 不做算法的自动生成或推荐。

## Capabilities

### New Capabilities
- `algorithm-validation`: 变量识别算法的准确性验证。输入 = 识别算法定义 + 本地金标准标注集；本地在 TEE 内比对产出 2×2 混淆矩阵；过闸后出域为准确性指标（Se/Sp/PPV/NPV + 95%CI），按数据源分别报告，结果哈希上链。全程不接触个体行。

### Modified Capabilities
- `rws-compute`: 新增 `algorithm-validation` 分析类型与 L0 层级；研究规格中的人群/结局定义可引用 `IdentificationAlgorithm` 而非自由文本。（当前定义于未归档 change `federated-data-space-rws` + `rws-analytics-ladder`，本 change 的 delta 叠加其上，归档时统一 reconcile。）
- `usage-control`: `allowedArtifacts` 白名单新增 `validation_metrics`；输出闸门新增"混淆矩阵格被抑制则指标不出域"规则；分析分级授权新增 L0。（同上，叠加于前述未归档 change。）

## Impact

- **代码**
  - `apps/connector` — 新增 `algorithm-validation` 域服务（算法求值 + 金标准比对 + 混淆矩阵）；`types.ts` 增 `CodeSet` / `IdentificationAlgorithm` / `ValidationMetrics` / `RwsArtifactKind.validation_metrics`；`output-gate` 增指标抑制联动规则；`connector-task-runner` 增分析类型路由。
  - `packages/database` — connector-local 侧金标准标注的表示（`local_record` 标注字段或独立标注实体，二选一在 design 定）。
  - `apps/api` — `runtime/rws-orchestrator` 增 L0 任务编排与跨源结果**分列**呈现（非合并）；DTO 校验新增算法定义结构。
  - `apps/web` — L0 任务提交表单与准确性指标展示（DataGrid，遵循 DESIGN.md §4 ListTable 原型）。
- **治理契约（必须同步，`pnpm check:meta` 强制）**
  - `EVIDENCE.md` — 覆盖矩阵第 11、12 项由 `缺口` 转 `已承载`；P-EVD-2 从待接入表移入 §2 正册成为 `EVD-05`。
  - `DOMAIN.md` — 派生公式区新增准确性指标定义（Se = TP/(TP+FN)、Sp = TN/(TN+FP)、PPV = TP/(TP+FP)、NPV = TN/(TN+FN)，95%CI 方法在 design 定）；术语表新增"金标准""混淆矩阵""操作性定义载体"。
  - `FLOWS.md` — 新增 `FLOW-RWS-05` 验证链（步骤 `crosses`/`payload` 与 L1.5 同构：本地比对 `raw-local`/`none` → 混淆矩阵 `aggregate-only`/`connector→control`）。
  - `TRUST.md` — 确认 `validation_metrics` 的分级与出域许可（预期"仅聚合"）。
- **依赖**：95%CI 计算方法（Wilson vs Clopper-Pearson）需选型——小样本下差异显著，且验证研究样本量通常不大。
- **外部前提**：需至少一个参与方能提供金标准标注集；Synthea 合成数据可先造标注做 e2e，但真实准确性数字只有真实院端数据才有意义。
