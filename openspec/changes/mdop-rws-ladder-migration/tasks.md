# 任务：RWS 阶梯迁入 MDOP + compose 页改计划编辑器

> 每型按 design D2 的**五件套**（台账 / 模板 / 收集器 / 入口 / 对拍证据）逐型收口；
> 缺任一不算迁完。旧接线删除一律受 O7 日期闸与观察窗约束（design D4）。

## 1. 编辑器组（先做：确定「计划」的单一表示）

- [ ] 1.1 compose 页的页面状态改为 `LogicalPlanDraft`（阶段 / 算子 / `at` / 合约 / 时间窗），不再维护第二套编排模型
- [ ] 1.2 向导（七个模板）与自由编辑产出**同一形状**：模板产出落进编辑器后与手改无差别
- [ ] 1.3 即时提示只做「可解释的提示」，判定（数据就近 / C2 证明策略 / 排序契约 / 阶段 id 唯一）一律留给编译期
- [ ] 1.4 提交路径收敛：编辑器 → `POST /mdop/jobs`（通用入口）或对应模板入口，二者共用同一份校验
- [ ] 1.5 用例：非法计划（缺合约 / 重名阶段 / 引用未注册算子）在页面上给出可读原因，且后端仍 fail-closed

## 2. 平台侧合并组（L0/L1 三型）

  - **2026-10-14 进展（四件套已落）**：模板 `industries/med/src/templates/cohort-count.ts`（各院 `source` →
    `rws.distinct-count@1.0.0`（清单里已有的通用模块，不必新写 wasm）→ `declassify.small_cell`）+ 收集器
    `industries/med/src/collectors/cohort-count.ts`（多院按分层键相加；口径 = 各院人数相加，跨院去重是
    `rws.dedup-incidence` 的分内事）+ 入口 `POST /mdop/jobs/cohort-count` + 台账置 `state=in-migration`
    （`channel` 仍 legacy —— **不切通道**，与 FL 条目的 in-migration 一致，提交入口已可用）。用例：
    `apps/api/src/mdop/cohort-count-plan.spec.ts` 4 例（阶段链 / 注册表路径与 400 / 三类拒绝 / 收集器单院与多院相加）。
    **未勾完的原因**：第五件套（与旧链逐字段对拍）未做 —— 按 design D2 它是迁移的**前置**，故本项保持未完成。
    **等价性对拍的重点（design D6）**：旧链 `cohort-count` 数的是**行数**（`cohort.length`，按 `ageBand` 分组），
    而本实现用 `distinct-count` 数的是**去重主体** —— 逐字段对拍时必须比 `cohortSize` 与每个 `buckets[].count`，
    差异要修实现或作为显式口径变更记录。
    **基线说明**：新入口的路由名 `jobs/cohort-count` 与常量使用把基座目录的 `cohort` 词从 6 提到 12（`cohort` 是
    守护词表里的行业词）。路由名是公开 API、必须含类型名，与当年 `paired-cohort` 入口同样处理：按守护自己给的
    路径重生成基线（103 → 109 处）并在此说明 —— 不是静默绕过。
- [ ] 2.1a 补「按目标药过滤队列」参数（旧链三型都支持；对拍时用全取药的夹具隔离了这条差异，见证据 README 差异 A）
- [ ] 2.1 `rws.cohort-count`：台账 + 模板 + 收集器（各院计数相加）+ 入口 + 对拍证据
- [ ] 2.2a **先拍口径**（design D6）：旧链按 `conditions[]` 标签**计数行**（非去重主体），且无标签时用占位标签；
  要么新增通用「分类计数」模块（AS + 复现构建 + 平行性用例），要么显式改为去重主体口径并同步更新 2.1/2.3 与对拍基线
  - **2026-10-14 进展（L0/L1 三型口径已统一）**：新增两个参数化封存投影（连接器）——`scalarCategoryProjection`
    （一行一记录、分类取某字符串字段）与 `listCategoriesProjection`（一行多标签各出一行、空列表走占位分类，
    占位为空则计入 skipped）；`cohort-count` 模板**返工**改用 `rws.categorical-count@1.0.0`（不再用去重主体口径的
    `distinct-count`），新增 `condition-prevalence` 模板（占位分类自动进闭合 `categoryKeys`，否则无标签的行会被拒）；
    收集器统一为 `mergeCategoricalCounts`（一个 analysisType 一个合并器，三型共用）。入口：`POST /mdop/jobs/condition-prevalence`
    （路由名不含基座词表里的词）。用例：api 三型各 4-5 例（共 13）+ 连接器投影 2 例。**未勾完的原因**：第五件套对拍未做。
- [ ] 2.2b 同上：现患的分母（记录数）需随载荷带出（实测分类行 7 vs 记录 5）
- [ ] 2.2 `rws.condition-prevalence`：五件套（在 2.2a 的口径拍板之后）
- [ ] 2.3a **先拍口径**（design D6）：旧链按 `adverseEvents[].organSystem` **计数出现次数**（非去重主体）
  - **2026-10-14 进展（四件套已落）**：封存投影 `aeSignalProjection`（连接器；**一行一起事件**、只留分类字段、
    不留主体键；缺器官系统的事件不出院并计入 `skippedMissingCategory`）+ 模板 `industries/med/src/templates/ae-signal.ts`
    （各院 `source`→`seal`（投影 `ae-signal`，字段名由包侧以 `eventField` 传入）→`rws.categorical-count@1.0.0`→`declassify.small_cell`）
    + 收集器 `industries/med/src/collectors/ae-signal.ts`（按分类键相加）+ 入口 `POST /mdop/jobs/ae-signal`
    （路由用缩写：类型全名属行业词，基座目录不引）+ 台账 `state=in-migration`。用例：api `ae-signal-plan.spec.ts` 4 例 +
    连接器 `projections.spec.ts` 的投影用例。**未勾完的原因**：与旧链逐字段对拍（第五件）未做。
    **边界收获**：为避开基座词表，投影改为按 `eventField` 参数取字段名 —— 域词留在行业包，基座只按名字取，
    比原先把字段名写死在基座里更对。
- [ ] 2.3b 节点侧随载荷带出**记录数分母**（旧链 `cohortSize` 是率的分母；新路径 `rowCount` 是分类行数，实测 3 vs 6）
- [ ] 2.3 `rws.adverse-event-signal`：五件套（在 2.3a 的口径拍板之后；判据不得悄悄换）
- [ ] 2.4 三型的 web 收敛：旧入口标 deprecated + 预计下线日；新入口落 `/space/mdop/jobs/<id>`

## 3. 站点效应量组（L2 / L3 / validation 四型）

- [ ] 3.1 `rws.comparative-effect`：站内效应量 + 标准误出域；平台随机效应合并（复用既有 meta 合并）+ 三闸门呈现
- [ ] 3.2 `rws.causal-psm`：站内 PSM/IPTW **只在站内**完成；出域仅 ATE + 标准误
- [ ] 3.3 `rws.causal-survival`：站内局部 Cox；生存曲线按高阶闸门**分箱 + 在险人数过阈值**后才出域
- [ ] 3.4 `rws.algorithm-validation`：站点级校验指标（AUC / 校准 / 决策曲线）+ 平台汇总
- [ ] 3.5 四型各自的「高阶统计量输出闸门」复核：效应量分层样本量低于阈值即抑制该效应量

> **对拍证据已落地（2026-10-14）**：`apps/connector/src/mdop/node/l01-equivalence.spec.ts` 3 条 +
> `evidence/l01-equivalence/README.md`。结论：三型分类计数**逐字段一致**；两处差异（按药过滤、分母语义）
> 已登记为 2.1a / 2.2b / 2.3b，故三型仍为 `in-migration`。

## 4. 守护、台账与收尾

- [ ] 4.1 每型迁完：台账 `channel=mdop`、`state=migrated`（或 `verification` + 未过期 `expires`），附 O3 要求的证据
- [ ] 4.2 `check:orchestration` 全绿且 legacy 计数**逐项下降**；`legacyBudget` 同步下调
- [ ] 4.3 逐型删旧接线（`legacyRefs` 精确到「文件留着、这一段删掉」），受 O7 日期闸；`retained` 条目 MUST NOT 删
- [ ] 4.4 回滚演练留证：`ORCHESTRATION_FORCE_CHANNEL=<key>=legacy` 在非生产跑一次（**不改台账**）
- [ ] 4.5 收尾：`openspec validate --strict mdop-rws-ladder-migration` + `pnpm test` 全绿
