# 任务：RWS 阶梯迁入 MDOP + compose 页改计划编辑器

> 每型按 design D2 的**五件套**（台账 / 模板 / 收集器 / 入口 / 对拍证据）逐型收口；
> 缺任一不算迁完。旧接线删除一律受 O7 日期闸与观察窗约束（design D4）。

## 1. 编辑器组（先做：确定「计划」的单一表示）

- [x] 1.1（2026-10-15 完成）compose 页的页面状态改为 `LogicalPlanDraft`（阶段 / 算子 / `at` / 合约 / 时间窗），不再维护第二套编排模型。
  合规预审原页挪到 `/space/atlas/pre-review`，菜单仍叫合规预审。
- [x] 1.2（2026-10-15 完成）向导（七个模板）与自由编辑产出同一形状：`POST /mdop/plans/preview` 只展开模板，`fromTemplatePlan` 放进编辑器后与手改无差别。
- [x] 1.3（2026-10-15 完成）即时提示只做可读提示（缺用途 / 缺合约 / 空阶段 / 重名 id / 参数不是 JSON）。数据就近、证明策略、排序和阶段唯一性仍只在后端编译期判定。
- [x] 1.4（2026-10-15 完成）提交走 `POST /mdop/jobs`，载荷是 `toPlanPayload` 加上 `analysisKey`；模板入口与预览共用 `buildPlanWithInputMapping`。
- [x] 1.5（2026-10-15 完成）缺合约时页面列出原因，空模板入参后端拒绝「至少需要一份合约」；把算子改成未注册 id 后提交，后端拒绝并在页面显示原因。提示不阻止提交。

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
- [x] 2.1a（2026-10-14 完成）补「按目标药过滤队列」参数：封存投影加**成对**的 `filterField`/`filterValue`（字段名与值都由行业包给出，基座不写死域词），三型模板暴露可选 `drug`；对拍夹具含不取药的行并断言被排除。补「按目标药过滤队列」参数（旧链三型都支持；对拍时用全取药的夹具隔离了这条差异，见证据 README 差异 A）
- [x] 2.1（2026-10-14 完成） `rws.cohort-count`：台账 + 模板 + 收集器（各院计数相加）+ 入口 + 对拍证据
- [x] 2.2a（2026-10-14 完成）**先拍口径**（design D6）：旧链按 `conditions[]` 标签**计数行**（非去重主体），且无标签时用占位标签。
  拍板结果是新增通用分类计数模块（`rws.categorical-count`，AS + 复现构建 + 平行性用例），不改成去重主体。对拍见 `evidence/l01-equivalence/README.md`。
  - **2026-10-14 进展（L0/L1 三型口径已统一）**：新增两个参数化封存投影（连接器）——`scalarCategoryProjection`
    （一行一记录、分类取某字符串字段）与 `listCategoriesProjection`（一行多标签各出一行、空列表走占位分类，
    占位为空则计入 skipped）；`cohort-count` 模板**返工**改用 `rws.categorical-count@1.0.0`（不再用去重主体口径的
    `distinct-count`），新增 `condition-prevalence` 模板（占位分类自动进闭合 `categoryKeys`，否则无标签的行会被拒）；
    收集器统一为 `mergeCategoricalCounts`（一个 analysisType 一个合并器，三型共用）。入口：`POST /mdop/jobs/condition-prevalence`
    （路由名不含基座词表里的词）。用例：api 三型各 4-5 例（共 13）+ 连接器投影 2 例。第五件对拍已由 2.2 收口。
- [x] 2.2b（2026-10-14 完成）节点侧随载荷带出**记录数分母** `recordCount`（过滤后记录数），收集器同步汇总；对拍断言 `records === 旧链 cohortSize`。同上：现患的分母（记录数）需随载荷带出（实测分类行 7 vs 记录 5）
- [x] 2.2（2026-10-14 完成） `rws.condition-prevalence`：五件套（在 2.2a 的口径拍板之后）
- [x] 2.3a（2026-10-14 完成）**先拍口径**（design D6）：旧链按 `adverseEvents[].organSystem` **计数出现次数**（非去重主体）。
  与 2.2a 同一拍板：复用 `rws.categorical-count`，一行一起事件，不改成去重主体。对拍见 `evidence/l01-equivalence/README.md`。
  - **2026-10-14 进展（四件套已落）**：封存投影 `aeSignalProjection`（连接器；**一行一起事件**、只留分类字段、
    不留主体键；缺器官系统的事件不出院并计入 `skippedMissingCategory`）+ 模板 `industries/med/src/templates/ae-signal.ts`
    （各院 `source`→`seal`（投影 `ae-signal`，字段名由包侧以 `eventField` 传入）→`rws.categorical-count@1.0.0`→`declassify.small_cell`）
    + 收集器 `industries/med/src/collectors/ae-signal.ts`（按分类键相加）+ 入口 `POST /mdop/jobs/ae-signal`
    （路由用缩写：类型全名属行业词，基座目录不引）+ 台账当时 `state=in-migration`。用例：api `ae-signal-plan.spec.ts` 4 例 +
    连接器 `projections.spec.ts` 的投影用例。第五件对拍已由 2.3 收口。
    **边界收获**：为避开基座词表，投影改为按 `eventField` 参数取字段名 —— 域词留在行业包，基座只按名字取，
    比原先把字段名写死在基座里更对。
- [x] 2.3b（2026-10-14 完成）同 2.2b：不良事件的 `recordCount`（患者数）与 `rowCount`（事件行数）各自带出，对拍断言分母一致。节点侧随载荷带出**记录数分母**（旧链 `cohortSize` 是率的分母；新路径 `rowCount` 是分类行数，实测 3 vs 6）
- [x] 2.3（2026-10-14 完成） `rws.adverse-event-signal`：五件套（在 2.3a 的口径拍板之后；判据不得悄悄换）
- [x] 2.4（2026-10-14 完成）三型 web/入口收敛：RWS 新建页对三型走 MDOP 分支（分类键由行业包默认词典兜底，
  前端不必定义域词典）；客户端加三个方法；`pnpm --filter web build` 通过。爆炸半径已核：旧路径的调用方
  （7 个 demo + 7 个连接器测试）都**直接调连接器执行器**、绕开 api 单一通道闸门，api 侧无这三型旧路径调用方 ——
  故三型已切 `channel=mdop / state=migrated`（legacy 计数 9 → 6）。旧接线的**删除**仍受 O7 日期闸（任务 4.3）。三型的 web 收敛（**置 migrated 的前置**：证据已完备，但旧入口仍在用；收敛后才切通道）：旧入口标 deprecated + 预计下线日；新入口落 `/space/mdop/jobs/<id>`

## 3. 站点效应量组（L2 / L3 / validation 四型）

- [x] 3.0（2026-10-14 完成）迁移路线与第一步：design D7 定「包内新写、payload 优先、legacy 原地不动到 O7」；
  临床匹配 101 行纯函数下移到 `industries/med/src/analysis/`，连接器留具名再导出（既有调用点不变）


- [x] 3.1（2026-10-14 完成） `rws.comparative-effect`：站内效应量 + 标准误出域；平台随机效应合并（复用既有 meta 合并）+ 三闸门呈现。
  定点 wasm 与 `siteEffectQ16` 逐字段相等；8/12/4/16 上 logOR/SE 与浮点 logistic 相差 < 0.001；分层格子逐字段一致；
  平台合并的效应量 / CI / 异质性与 `derSimonianLaird` 逐字段相同。新建页改走 `POST /mdop/jobs/comparative-effect`，
  台账 `channel=mdop`、`state=migrated`。旧浮点路径保留到 O7（任务 4.3），未设 `cutoverAt`。
  证据：`evidence/comparative-effect/README.md`。
- [x] 3.2（2026-10-15 完成） `rws.causal-psm`：站内 PSM/IPTW **只在站内**完成；出域仅 ATE + 标准误。
  定点模块与 `causalAteQ16` 逐字段相等（SM3 `a75fe955083c4a8286f557f12dece960d7959bc7c1b17b59db227ccadd8204bc`）。
  单层 8/12/4/16 上，PSM 与「协变量不变时按输入顺序配对」的均值 4/12、样本标准误 `sqrt(2/99)` 相差 < 0.001；
  IPTW 与饱和风险差闭式相差 < 0.001。层内样本量低于 `minCell` 则整站抑制，不把 0 送进合并。
  两站合并与 `derSimonianLaird` 逐字段相同。新建页改走 `POST /mdop/jobs/causal-psm`，台账 `channel=mdop`、`state=migrated`。
  旧 sklearn 路径保留到 O7，未设 `cutoverAt`。跨层时新路径不跨层配对，与旧路径的特征距离配对不是同一个估计，见证据。
  证据：`evidence/causal-psm/README.md`。
- [x] 3.3（2026-10-15 完成） `rws.causal-survival`：站内局部 Cox；生存曲线按高阶闸门**分箱 + 在险人数过阈值**后才出域。
  定点模块与 `survivalEffectQ16` 逐字段相等（SM3 `c763942433989364f085913a497ee29e16895882329996e82003990a9c76e184`）。
  估计是 β=0 的一步 Newton，不是 lifelines 的完整迭代。平衡夹具 log HR = 0、标准误 = 1；单侧夹具与闭式 2 和 `sqrt(2)` 相差 < 0.001。
  箱取左端点。在险人数低于 `minCell` 的箱不交出生存率，也不交出真实人数；平台拒绝未抑制的小箱。
  两站 log HR 与 `derSimonianLaird` 逐字段相同。新建页改走 `POST /mdop/jobs/causal-survival`，台账 `channel=mdop`、`state=migrated`。
  旧 lifelines 路径保留到 O7，未设 `cutoverAt`。证据：`evidence/causal-survival/README.md`。
- [x] 3.4（2026-10-15 完成） `rws.algorithm-validation`：站点级校验指标（AUC / 校准 / 决策曲线）+ 平台汇总。
  定点模块与 `validationMetricsQ16` 逐字段相等（SM3 `b377d889f6b8e690ada3681eaacd9533171f6f425ed4b2aa9875e9ab82b8f91c`）。
  四行夹具 AUC = 0.75，Hanley 标准误相差 < 0.001。样本量、校准箱或预测阳性数低于 `minCell` 时不交出该指标。
  两站 AUC 与 `derSimonianLaird` 逐字段相同。校准箱和决策曲线按站附上，不跨站合并。
  新建页改走 `POST /mdop/jobs/algorithm-validation`，台账 `channel=mdop`、`state=migrated`。
  旧通道是混淆矩阵和 Wilson 区间，不是 AUC；执行器保留到 O7，未设 `cutoverAt`。
  证据：`evidence/algorithm-validation/README.md`。
- [x] 3.5（2026-10-15 完成）四型各自的「高阶统计量输出闸门」复核：效应量分层样本量低于阈值即抑制该效应量。
  比较效果在进模块前剔除小分层，全灭则不交效应量。倾向评分整站抑制，生存曲线尾箱与 log HR、算法校验的 AUC / 校准箱 / 决策点各自有对应用例。
  证据：`evidence/high-order-gate/README.md`。

> **对拍证据已落地（2026-10-14）**：`apps/connector/src/mdop/node/l01-equivalence.spec.ts` 3 条 +
> `evidence/l01-equivalence/README.md`。结论：三型分类计数**逐字段一致**；两处差异（按药过滤、分母语义）
> 已登记为 2.1a / 2.2b / 2.3b，故三型仍为 `in-migration`。

## 4. 守护、台账与收尾

- [x] 4.1（2026-10-15 完成）本变更里的分析类型台账均为 `channel=mdop`、`state=migrated`，并附等价性证据。联邦两条仍是 `in-migration`，不在本变更里改通道。
- [x] 4.2（2026-10-15 完成）`check:orchestration` 全绿。legacy 计数 2，`legacyBudget` 从 9 调到 2。
- [ ] 4.3 逐型删旧接线（`legacyRefs` 精确到「文件留着、这一段删掉」），受 O7 日期闸；`retained` 条目 MUST NOT 删
- [x] 4.4（2026-10-15 完成）回滚演练留证：`ORCHESTRATION_FORCE_CHANNEL=rws.disproportionality=legacy` 在非生产跑过，台账未改。证据：`evidence/rollback-drill/README.md`。
- [x] 4.5（2026-10-15 完成）`openspec validate --strict mdop-rws-ladder-migration` 通过。`pnpm test` 退出码 0：API 152 套件通过，连接器 142 套件通过，web 136 条失败 0。电力种子那条在整库并行下超过 5 秒，超时改为 20 秒后整库转绿。
