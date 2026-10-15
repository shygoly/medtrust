# 设计：RWS 阶梯迁入 MDOP + compose 页改计划编辑器

## D1 迁移顺序：按「计算发生在哪」分三组，而不是按阶梯号

阶梯号（L0…L4）表达的是**统计推断强度**，不是**计算位置**。决定迁移难度的恰恰是后者：

1. **平台侧合并组**（L0/L1 三型 + 部分 validation）：各院各算同形状计数，平台相加；不需要节点内计算、
   不需要 C2 目标、不需要新算子 —— 这是最省事的一组，先做，能最快把 legacy 计数压下来。
2. **站点效应量组**（L2 `comparative-effect` + L3 两型 + `algorithm-validation`）：计算必须在站内完成
   （PSM/IPTW、Cox、模型校验都要个体数据），出域的是**站点级效应量 + 标准误**；平台只做随机效应合并。
   关键约束来自既有 spec：`rws-compute` 的「L3 因果仅出站点效应量」与「高阶统计量输出闸门」。
3. **编辑器组**（compose 页）：与上面两组解耦，可并行；但**必须先做**的一件事是确定「计划」的单一表示。

**顺序**：D1.1 先做编辑器组的第一步（确定计划即 MDOP 逻辑计划）→ D1.2 平台侧合并组三型 →
D1.3 站点效应量组四型 → D1.4 逐型删旧接线（受 O7 闸）。

## D2 每型的迁移模板（五件套，逐型同构）

每型固定五件，缺一不算迁完：

1. **台账条目**：`mdopTemplate` 指向该型的模板 id；`equivalenceEvidence` 指向对拍证据（`mdop-native` 例外）。
2. **计划模板**（行业包）：入参 → 逻辑计划草案；校验抛 `PlanInputError`（应用层映射 400）。
3. **收集器**（行业包，平台侧）：解析节点/各院交回的载荷并校验形状；**多产出节点不可相加的情形一律拒**。
4. **提交入口**（应用）：`POST /mdop/jobs/<type>`，经 `buildPlanWithInputMapping`（与既有入口同一套映射）。
5. **对拍证据**：与旧通道在**固定夹具 + 固定种子**下逐字段一致；不一致必须有可复核解释，**不得**用「差不多」结案。

## D3 compose 页改计划编辑器的数据模型

三处刻意的取舍：

1. **单一表示**：页面状态直接是 `LogicalPlanDraft`（阶段 + 算子 + `at` + 合约 + 时间窗），
   不在前端另立一套编排模型；渲染与校验都走同一份 schema（`parseLogicalPlan` 的宽松侧）。
2. **编译期判在编译期**：数据就近（`ds://` 句柄）、C2 目标证明策略、排序契约、阶段 id 唯一性
   全部交给后端的编译期校验；前端只做**可解释的即时提示**，不复制判定逻辑（避免两套规则漂移）。
3. **模板与自由编辑并存**：向导（七个模板）负责「填参数」，自由编辑负责「改计划」；两者产出同一形状，
   向导的产出一旦落到编辑器就与自由编辑无差别 —— 这样「页面上能编的」与「平台能跑的」永远是一套。

## D4 与台账/守护的关系

- 每个类型**独立**迁移、独立置 `migrated`；`legacyBudget` 单调下降（O2 只允许下降）。
- O7 日期闸：`legacy-removed` 必须在观察窗满之后（L1.5 是 2026-10-13 起算、最早 2026-10-18）；本变更逐型遵守同一闸门。
- `retained` 条目（如 `shared-runtime` 的旧合并算子）**MUST NOT** 当下线目标；删接线时只删 `legacyRefs` 里写明的那一段。

## D5 风险与回滚

- **风险 1：同一类型两条通道都能跑**。缓解：入口处 `assertEntryAllowed`（单一通道 fail-closed）在两侧都已就位，
  迁移期用 `ORCHESTRATION_FORCE_CHANNEL` 做非生产回滚演练（**不改台账**）。
- **风险 2：合并口径悄悄变化**。缓解：D2 的第 5 件（对拍证据）是**迁移的前置**，不是收尾。
- **风险 3：编辑器让非法规格通过**。缓解：D3 的第 2 条 —— 判定只在编译期做一次。

## D6 旧链口径 vs MDOP 可复用件的差异清单（迁移前必须逐个拍板）

落 2.1 时对旧链逐行读了实现（`apps/connector/src/domain/rws-executor.ts`），发现**三型 L0/L1 的旧口径是同一件事**：
「按某个分类字段**计数行**」，产物同形 `{ analysisType, cohortSize, buckets: [{ key, count, rate }] }`：

| 型 | 分类字段 | 关键细节 |
|---|---|---|
| `cohort-count` | `ageBand` | 计的是**行数**（`cohort.length`），**不是去重主体数**；按 key 升序 |
| `condition-prevalence` | `conditions[]` 每个标签 | 一行的多个标签各计一次；无标签时用占位标签「无明确慢病标签」；按 count 降序 |
| `adverse-event-signal` | `adverseEvents[].organSystem` | 一行的多起事件各计一次；按 count 降序 |

三型都可选按 `drug` 先过滤队列（`matchesMedication`）。**这与 MDOP 里能复用的件对不上**：

1. `distinct-count` 数的是**去重主体**（`subjectKey` 去重），而旧链数的是**行/出现次数** ——
   2.1 已经用了它，因此 2.1 的等价性对拍**必须**逐字段比 `buckets[].count` 与 `cohortSize`，
   差异要么修实现、要么作为**显式的口径变更**记录并说明理由（去重主体通常更正确，但那是**行为变更**，不能默认）。
2. **没有**「按分类字段计数」的通用 MDOP 模块 —— 2.2/2.3 因此不是「照抄 2.1」，
   而是要么新增一个通用分类计数模块（AssemblyScript + 复现构建 + 平行性用例），
   要么显式决定改为去重主体口径（那就同时改 2.1/2.2/2.3 三型并更新对拍基线）。

**结论（写给后续实现）**：2.2/2.3 的前置不是写模板，而是**先拍板口径**（design D1 把这三型放第一组，
正是因为它们「最简单」，但简单不等于可以跳过口径确认）。任务 2.2a/2.3a 即为此设。

## D6 补遗（2026-10-14，做 2.1–2.3 的对拍时实测发现）

对拍（`evidence/l01-equivalence/README.md`）确认三型的**分类计数逐字段一致**，同时暴露两处**真实的**差异，
都已在任务册登记、且**不当作已一致**：

1. **缺「按目标药过滤队列」的参数**（任务 2.1a）：旧链三型都支持按 `drug` 过滤（`matchesMedication`），
   新模板没有。对拍夹具全部取目标药，因此上表的"一致"是在**同队列**前提下成立的。
2. **分母语义不同**（任务 2.2b / 2.3b）：旧链 `cohortSize` = **记录数**（现患/不良事件里它是率的分母），
   新路径 `rowCount` = **分类行数**。一行多标签/多事件时两者不同（实测现患 7 vs 5、不良事件 3 vs 6）——
   平台若要复现旧链的 `rate`，节点侧必须把记录数分母一并带出。

**结论**：三型保持 `in-migration`（不置 `migrated`），台账的 `equivalenceEvidence` 已指向该证据目录。

## D7 站点效应量组（3.1–3.4）的迁移路线：包内新写、legacy 原地不动

L2/L3 与 L0/L1 有一处根本不同：**计算必须在站内完成**（个体数据不能出域），只有站点级效应量 + 标准误可以出域。
落 3.1 时对旧链做了实测考察，结论如下。

### 旧链现状（`apps/connector/src/domain/comparative-effect.ts`，460 行）

它是一份**完整的统计实现**：分层 2×2 表 -> Mantel-Haenszel 合并 OR、Woolf 标准误、局部 logistic 回归、
完全分离/零格时回退 Firth 惩罚回归；产物是 `AggregateResult`（一个含 7 个子载荷（`EffectEstimatePayload`、
`KmCurvePayload`、`ValidationResult`…）的富结果联合）。

### 两条路，选了后者

1. **整体搬家**：把 460 行 + `AggregateResult` 及其 7 个子载荷一起搬进包。
   代价：要动 legacy 的返回类型与调用点（legacy 路径此刻**仍在服务**），且拖动一整条类型依赖链。
2. **包内新写、payload 优先**（**采纳**）：包侧只实现「投影行 -> 站点级效应量 + 标准误 + 闸门」这一小段，
   纯统计函数（MH 合并、Woolf SE、分层表构造）按需移植；legacy 一行不动，直到 O7 日期闸下线。

选择 2 的理由：legacy 正在服务、动它风险不对称；而「两份实现是否给出同一个数」本来就该由**对拍证据**回答
（与 2.1–2.3 同一套做法），不该靠「共用一个文件」来保证。**代价是迁移期存在一份重复实现**，
登记的处置是：O7 闸到期删 legacy（任务 4.3），届时重复消失。

### 第一步已落地（本轮）

临床匹配（`enrichMedications` / `enrichConditions` / `matchesMedication` / `matchesCondition` /
`matchesAdverseEvent`，101 行纯函数）已下移到 `industries/med/src/analysis/`，连接器留**具名**再导出，
既有调用点一字不变。这是包内新实现要复用的第一块。

### 后续（3.1–3.4）

每型：包内纯函数（+ 必要时的新 wasm 模块或沙箱）-> 计划模板 -> 站点级载荷 -> 收集器（随机效应合并 /
验证指标汇总）-> 对拍证据。**硬约束**（既有 spec）：L3 因果仅出站点效应量；高阶统计量输出闸门 ——
分层样本量低于阈值即抑制该效应量（不得静默出域）。

## D8 过渡窗口：`migrated` 不等于「旧通道已停用」（2026-10-15 review 后补记）

`decideEntry`（`apps/api/src/runtime/orchestration/orchestration.channels.ts`）是**按切换日**判的：
授权通道与请求入口不一致时，**未到 `cutoverAt` 一律放行**（返回 `enforced=false`，调用方记一条 warn），
到点才抛 `E_CHANNEL_MDOP` / `E_CHANNEL_LEGACY`（旧入口映射成 409）。两处调用方都已核实：
`apps/api/src/mdop/mdop.controller.ts` 与 `apps/api/src/runtime/rws-orchestrator/rws-orchestrator.controller.ts`
都在 `!decision.enforced` 时 `logger.warn`。

因此本变更里 `channel=mdop` + `state=migrated` 的准确含义是「**MDOP 是授权通道**」，
而不是「旧入口被拒」。真正拒旧入口的是 `cutoverAt` —— 目前全台账只有 L1.5（`rws.disproportionality`，
`2026-10-13`）设了它。本批次 7 个类型（L0/L1 三型 + L2/L3/validation 四型）都处在**过渡窗口**：
旧入口仍放行、每请求记一条警告。

这是有意的设计（迁移期两条通道都要能跑，见 `decideEntry` 的注释），但**必须写明**：
否则「迁移完成」会被读成「旧通道已停用」，而实际不是。

**待评审拍板**：给这些条目设 `cutoverAt`（硬切换）要与 O7 观察窗一起定 —— 这是**产品决定**，不是实现细节。
台账里这些条目的 `sunset` 目前同为待定。在拍板之前，本文档与证据 README 一律用「MDOP 为授权通道」
这种说法，不用「旧通道已停用」。

## D9 过渡窗口的收口：cutoverAt 已设（2026-10-20），以及 pre-review 路由的处置

### D9.1 `cutoverAt` 定在 2026-10-20（= 迁移完成 + 5 天观察窗）

D8 说清「`migrated` 只表示 MDOP 为授权通道」。本轮把 7 个批次 2 类型
（`rws.cohort-count` / `rws.condition-prevalence` / `rws.adverse-event-signal` / `rws.comparative-effect` /
`rws.causal-psm` / `rws.causal-survival` / `rws.algorithm-validation`）的 `cutoverAt` 设为 **2026-10-20**。

日期不是随手挑的：守护 O7 规则的口径是「观察窗满 **5 天**」（`scripts/check-orchestration.mjs`），
批次 2 的迁移在 2026-10-14/15 完成，故最早可选切换日 = 2026-10-19/20；取 **2026-10-20**。
到点后这些类型的**旧入口会被拒**（`E_CHANNEL_MDOP`，控制器映射 409），与 L1.5（`2026-10-13`）一致。

仍未设 `cutoverAt` 的是 5 个 **mdop-native** 条目（`mdop.paired-cohort` / `mdop.vaccine-scri` / `mdop.ve-tnd` /
`mdop.external-control` / `mdop.dedup-incidence`）—— 它们**没有 legacy 通道**可拒，设切换日没有意义。

`sunset`（旧接线**删除**，任务 4.3）仍为待定：它要等 `cutoverAt` 之后另行决定，不由本文档代定。

### D9.2 `apps/web/src/app/(console)/space/atlas/pre-review/` 的处置：**原样保留、不入库**

核实结果：它是一个**未入库**的文件（`page.tsx`，264 行），内容是**旧 compose 页的副本** ——
导出函数名仍是 `ComposePage`，调的也是同一批 compose API（`listCapability` / `createComposition` / `evaluateCompliance`）。
而 `/space/atlas/pre-review` 被 4 处链接引用（`atlas/page.tsx`、`atlas/[layer]/page.tsx`、`contracts/page.tsx`、`(landing)/page.tsx`）。

处置：**不提交它**（归属与用途未经确认，且它是会漂移的副本），改为在本文档登记，供评审决定三选一：

1. 把 4 处链接改指 `/space/atlas/compose`（路由语义按现状就是「能力层勾选 + 合规评估」，与 compose 同源）；
2. 让 `pre-review` 成为**重定向**到 compose 的极薄页面（保留 URL、去掉副本）；
3. 若「L2 合规预审」确是要独立成型的页面，则把两者的公共部分抽成组件再各自成页（消除副本）。

在决定之前，仓库在这个路径上仍是「链接指向一个未入库文件」—— 这是既存状态，本变更不假装已解决。

## D10 余下 demo 迁不动的地方（2026-10-15 实测登记，供拍板）

已完成并真跑验证的迁移：`run-local-loop`、`run-e2e`、`run-cross`（AE 信号），走
`mdop/mdop-rws-executor.ts`（中性适配器）+ `wiring/wire-mdop-rws.ts`（组装根）。以下四类**不能照此迁**，
原因都不是接线：

### D10.1 condition-prevalence 的 64 键 ABI 上限（AMR q1/q2/q2-unlock）
- `rws.categorical-count` 用 **u8 下标**，分类键上限 64；AMR 数据的研究相关键（`specimen:*` / `organism:*` / `resist:*`）共 **67** 项 —— 模块装不下（节点按闭合语法正确拒绝）。
- 三选一：① 模块索引放宽到 u16（改 wasm 模块 + ABI + 复现构建）；② 拆成多次计数阶段（每阶段 ≤64 键，结果合并）；③ 收窄研究键到 ≤64（研究口径变更）。
  倾向 ②：不动 ABI、可按研究需要分组，代价是计划里多几个计数阶段。

### D10.2 本地编码与闭合词表/分层口径不一致（synthea cohort-count、condition-prevalence）
- 年龄段：本地是 `80-89`（包默认 `0-17/18-39/…/80+`）；且队列里**存在缺 `sex` 的行**，其年龄段无法由 `ageBand|sex` 派生 → 无论怎么声明闭合集都会有桶落空。
- 慢病标签：数据标签（`流感疫苗接种史`）≠ 包慢病词典 → 已用「申请方声明本地闭合集」解决并实测通过（`流感疫苗接种史: 290 例`）。
- 二选一：① 各 demo 显式声明本地口径（含缺维度行的兜底键），把口径差异写进 demo 注释；② 统一本地编码到包词典（数据侧变更）。

### D10.3 删 AE 旧分支**不是**可控小步
- 旧 AE 分支（`rws-executor.ts` 的 `adverseEventSignal`）除被 5 个 spec 当**夹具类型**用之外，还被 **HE 路径依赖**：`ConnectorTaskRunner.runEncrypted` → `executor.run(analysis)` → 该分支。
- 因此 AE 分支的删除必须**先迁 HE 路径**（HE 取 `raw.buckets`，适配器形状兼容，但需接线）与那 5 个 spec 的夹具；`rws-executor.spec.ts` 的两个直测用例需改为经适配器验证或删除（新路径已有 `l01-equivalence` + 平行性对拍 + demo 覆盖）。

### D10.4 L1.5 / 因果类 demo 需要**节点全量装配**而非轻量适配器
- `rws.disproportionality@1.0.0` 等是**系统算子**（`registerL15Operators` / 包沙箱），其 `runProportionality` 依赖 `AlgorithmSandboxExecutor`，而后者依赖 `ConnectorModuleClient` ← `ControlPlaneClient`（从平台取并验签模块）。
- 所以 q3 / analytics-ladder 要么走生产的 `L15OperatorWiring` 装配（需要控制面/模块客户端），要么给本地适配器补一个从**复现构建清单**取模块的 `ConnectorModuleClient` 替身。
- **已解决（2026-10-15，commit 8f2801d）**：`apps/connector/src/test/local-module-client.ts`（复现构建清单 + 测试 CA 自签作本地信任根，包住真实 `ConnectorModuleClient`）
  与 `apps/connector/src/test/local-l15-wiring.ts`（`registerLocalL15`，与生产 `wiring/wire-l15.ts` 同源）；验收用例 `local-l15.spec.ts` 实测
  `source.dataset` → `rws.disproportionality` 走**真实复现构建模块**，与 `retained(test-reference)` 的 `disproportionalityTables` 逐字段一致。
  尚缺：让适配器按**计划阶段序列**（source → 系统算子 → declassify）执行，再迁 `run-amr-q3`。

以上四条不阻塞 `adverse-event-signal` 侧继续（D10.3 已说明它的前置是 HE 路径迁移）。
## D10.5 L1.5 的协议队列定义：MDOP 路径尚未支持（2026-10-15 实测，删旧接线时暴露）

**事实**：旧链 L1.5 会按协议队列定义（`analysis.tte` 的纳入/排除）收窄队列 —— `cohort-definition-gap.spec.ts` 用 `tte: cohortTte`（age≥18 且排除妊娠）验到 `cohortSize=1`；不加 tte 时才是全人群 3 人。
而 MDOP 侧的 L1.5 **不认这个口径**：`wiring/wire-l15.ts` 的 `loadRows(dataProductId)` 只按数据产品取数，**忽略**计划里的 `cohort` 参数（`l15.ts` 的 `cohort?: string` 一路透传但无人解释）。

**后果**：把连接器侧 L1.5 旧接线删掉（`rws-executor.ts` 的 `pinnedModule` 分支与 in-executor 分支），就**丢掉**协议队列收窄能力 —— 这是与 `EVIDENCE.md` 证据效度相关的口径，不是纯实现细节。故 2026-10-15 已**回退该删除**（commit `fe7010c`），保留两处分支；api 侧登记元素与 demo（q3 / ladder）的迁移保留。

**两条路**：
1. **给 MDOP 补 cohort 支持**：定义协议队列在计划里的编码（现在只有一个不透明字符串），并在节点侧数据加载处解释它（与 `tte` 的纳入/排除语义对齐，含逐字段对拍证据）；
2. **把旧分支登记为 `retained`**（理由写清是证据口径参照），等 (1) 落地再删。
在 (1) 之前，L1.5 的 `state` 不应置 `legacy-removed`。

### D10.1 更新（2026-10-15）：**拆块计数不可行**（实测否定）

尝试：把 67 个分类键按 60 一组拆成多块计数、在适配器把各块的桶并起来（不动模块 ABI）。

结果：**失败** —— 报 `分类键不在给定列表里：specimen:BLOOD`。原因是 `rws.categorical-count` 的语义是
「逐行取出该行的分类标签，遇到**不在本块列表里**的就拒」，因此**每一块都必须声明全部标签**才不被别的块拒，
而那样每块又超过 64，自相矛盾。

结论：拆块只有在**投影层**能按块过滤标签时才可行（现在 `listCategoriesProjection` 不做白名单/前缀过滤）。
于是 D10.1 只剩两条路：
1. **模块索引放宽到 u16**（改 wasm ABI + TS 镜像 + 平行性对拍 + 复现构建闸 + 重新对拍证据）；
2. **收窄研究/数据口径到 ≤64**（数据侧或研究设计侧变更）。

### D10.2 更新（2026-10-15）：synthea 的 cohort-count 已解决 —— `strataKeys` 是**分类键**而非复合键

cohort-count 模板的计数阶段是 `categoryKeys: input.strataKeys?.length ? input.strataKeys : [...DEFAULT_COHORT_AGE_BANDS]`，
即入参 `strataKeys` **直接就是分类键（年龄段）**，语法 `<下界>-<上界>`。先前误传 `年龄段|性别` 复合键，
于是 `80-89` 被判「不在给定列表里」。改为传本队列实际出现的**年龄段**后两院两个任务全部走通
（实测：甲 10-19:0 40-49:38 50-59:26 60-69:24 70-79:28 80-89:23；乙 40-49:28 … 80-89:19；合并 290）。
慢病/服务标签侧同理：由申请方声明本地闭合集解决（见 D10.2 正文）。

### D10.6 旧链的「证据侧增强」必须在删除前移植（2026-10-15，已修一例）

**模式**：旧 `RwsExecutor` 在返回聚合前会挂上**证据侧增强**，而适配器起初不产出 —— 直接删旧接线就会**丢能力**。
已见两例：
1. **协议队列收窄**（L1.5，见 D10.5）—— 仍未移植，故 L1.5 连接器侧旧接线保留；
2. **逐变量缺失率审计 + 质量报告 + 高缺失告警**（计数型）—— **本轮已移植**：适配器新增可选端口
   `enrich(aggregate, rows)`（本层不认识领域字段），组装根用既有 `auditVariables`/`buildQualityReport` 实现；
   `data-audit-gap.spec` 改指适配器后 4/4 通过，即新路径现在也携带 `dataAudit`/`qualityReport`/`warnings`。

**第三例（2026-10-15 确认，阻塞删除）**：`missingnessLog`。不是「可选增强」——
`apps/connector/src/domain/missingness.spec.ts` **强制**：当 `analysis.missingness` 声明了缺失值处理策略时，
聚合结果 **MUST** 带上 `missingnessLog`（该 spec 断言 `missingnessLog(out)` 必须 defined 且内容可核）。
旧链在飞地内先 `applyMissingness(enclaveRows, missingness, stratifyBy)` 再计数，并把日志挂到结果上；
适配器不做缺失值处理、也不产日志 → **删 `cohort-count`/`condition-prevalence` 旧分发会丢掉它**。

**因此计数型旧接线的删除前置**：把「缺失值处理 + 日志」搬到 MDOP 路径（需要计划/模板能携带该声明，
节点侧在计数前应用并记录）—— 这是与 D10.5 同量级的一项，落地前 `cohort-count`/`condition-prevalence` 的
旧分发**保留**。

**已澄清的非阻塞项**：`connector-task-runner.spec.ts` 里两个 `cohort-count` 用例测的是**层级路由校验**
（L2 必须 comparative-effect / L3 必须 causal-psm，在调用执行器之前就抛），与执行器分支无关；
`execution` 标注由 runner 在输出闸门之后写入，也不受影响。

### D10.5 进展（2026-10-15）：节点侧已支持协议队列（本地路径）

声明经**计划的阶段参数**到达节点（`cohortDefinition` / `missingnessDeclaration`，本变更 D1 的落地方式）：
本地组装根构建计划时写入，节点在**投影之前**应用（`wiring/local-l15-wiring.ts` 的 `runProportionality`），
并把队列规模与缺失值日志回传（`MdopRwsPlanPort.evidenceFor`，按任务取走即删）。
`cohort-definition-gap.spec` 已改指 MDOP 并通过（**cohortSize 3 → 1**）。

**仍缺**：生产路径由 API 侧把同一份声明编译进计划（本变更 tasks 1.2）。在它完成前，L1.5 的连接器侧旧分发**保留**。

### D10.7 MDOP 路径尚未回发 `wasm-sandbox` 执行标注（2026-10-15，随 4.3 暴露）

旧链在合约固定模块时于结果上标注 `{ isolation: 'wasm-sandbox', moduleSm3, abiVersion }`（D8/4.4）。
L1.5 迁移后，适配器一律返回 `{ isolation: 'none' }` —— 尽管它确实在节点沙箱里跑了 wasm 模块。
`execution-annotation.spec` 的两条用例已如实断言当前行为。**补标注**（把模块摘要与 ABI 版本带回任务层）
归入 change `mdop-node-parity-enrichments` 的后续项：适配器可从计划里的算子摘要 + 模块清单的 abiVersion 取值。

### D10.8 阶梯余下两型（comparative-effect / causal-psm）的迁移缝（2026-10-15 勘明，未实施）

**已具备**：本地投影函数已存在 —— `mdop/operators/seal.ts` 的分发器把 `comparative-effect` 与 `causal-psm`
都指向 `comparativeEffectProjection`，`causal-survival` 走 `causalSurvivalProjection`（`projections.spec.ts` 已覆盖）。

**缺一件**：节点侧没有 `rws.comparative-effect@1.0.0` / `rws.causal-psm@1.0.0` 的**算子处理者** ——
这两型在包里是**沙箱**（`industries/med/src/sandboxes/{comparative-effect,causal-psm}.ts`，经 `registerMedSandboxes`
注册到基座沙箱面），而连接器节点执行面上只有 `source/seal/declassify/merge` 与 L1.5 的 WAsm 算子。
因此迁移需要在连接器的组装根里，按 L1.5 的做法补一份本地装配（模块客户端 + 沙箱执行器 + 该型的阶段注册）。

**在它完成前**：`rws-executor.ts` 的 `comparative-effect` / `causal-psm` / `causal-survival` 三条旧分支**保留**；
阶梯 demo 走适配器回落旧链（实测正常，第 8 轮）。

#### D10.8 续（2026-10-15，实测后回退）：真正堵点在 runner 分派层

本轮尝试把 comparative-effect 接进适配器（计划映射 + 本地 seal + 申请方沙箱注册），逐层推进到：
source → **seal 通过** → `rws.comparative-effect@1.0.0` 被拒：`本节点没有该 wasm 算子的执行实现`。
两个实测结论：
1. **seal 的凭据走执行参数外层**：封装算子从 `input.contractTerms.credential_id` 取凭据（不是 stage 内层），
   本地装配须在执行参数上补 `contractTerms`；标签规则按机制区分（seal → C2、declassify → C3、其余 inherit）。
2. **真正的堵点在 runner 分派**：`tee-node/wasm-runner.ts` 的 `createOperatorDispatch` 里 `siteEffect` 已用
   `endsWith('comparative-effect@1.0.0')` 覆盖该算子，且包里 `medSandboxes()` **确实含**
   `comparativeEffectStageSandbox`，但报错发生在 `resolveSandbox` **之前** —— 说明该算子被派发到了
   **另一个不带沙箱解析的 runner**（`createNodeExecutor` 按前缀注册多个 wasm runner）。下一轮须先查清
   “哪个 runner 接住了 `rws.comparative-effect@1.0.0`”，再把沙箱解析接到那一条上。

**处置**：本轮实验**全量回退**（不留半态），阶梯 demo 仍走适配器回落旧链，实测正常。
