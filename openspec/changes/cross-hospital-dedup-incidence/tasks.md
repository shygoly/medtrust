# 跨院去重发病率与罕见病登记任务

> 产出是**可复跑的真实运行**：真实 TDX 证明 + 节点内真实 Wasm（观察期并集 + 事件去重）+ 与答案键逐格一致 + 销毁与上链。
> 数据全合成；跨院重复比例与罕见病患病率均为注入；对外表述受 `tdx-attestation-pilot/external-claims.md` 约束。

## 1. 合成数据与答案键

- [x] 1.1 `scripts/build-dedup-records.mjs`：由 `data/synthea` 按固定种子切片为两院队列
  （约 60% / 55%，重叠 ~20%），按 design D7 注入：跨院重复（一半观察期部分重叠、一半空 1 天）、
  常见结局事件（其中一部分两院各记一次）、目标罕见病（放大到可测，标注倍数）。
  - 完成（2026-10-03）：基座同 VE 场景（**7000 人**）；分桶 `both 1330 / aOnly 2708 / bOnly 2316 / 不去 327`；
    甲院 4038 人、乙院 3646 人，**去重后 6354 人**；观察期 **重叠 663 例 / 空 1 天 667 例**；
    事件 1351 起（其中 **18 起被两院各记一次**）；罕见病 165 例（含 50 例两院重复登记）。
  - 答案键 `data/demo/dedup/answer-key.json` 含逐层去重后四值 + **「各院直接相加」对比值 + 虚增比例**（调算子参考模型计算）。
- [x] 1.2 边界自检：至少一层 `rareCases ≥ minCellRare`、至少一层 `0 < rareCases < minCellRare`；
  至少一层存在「重叠观察期」、一层存在「空 1 天观察期」；跨院重复事件 ≥1。
  验收证据：自检输出 + 答案键中标注的边界层清单。
  - 完成：`selfCheck = {rareAtLeastMinCellRare:2, rareBelowMinCellRare:3, strataWithAllCellsAtLeastMinCell:3,
    overlappingWindows:663, oneDayGapWindows:667, duplicatedEvents:18, pass:true}`。
  - **口径修正一处**：最初「跨院重复事件」要求两院各自独立产生事件，实测为 0（事件过于稀疏）；
    改为「A 院事件若落在 B 院观察期内则按比例复制到 B 院」，并把事件发生率按分层**放大 10 倍**
    （`eventRateAmplification:10`，如实写入答案键；真实急性心梗年发生率约 0.2%–1%）。
  - **窗口裁剪**由对拍夹具覆盖（`scripts/dedup-incidence-parity.test.mjs`），数据集侧不再声称覆盖。
- [x] 1.3 溯源标注：所有记录带合成来源标记；**注入比例与放大倍数写入答案键**
  （MUST NOT 出现任何真实地区/机构的发病率或罕见病例数）。
  - 完成：两院记录均带 `synthetic:true` + `dataSource:'synthea-base+injected-crosssite'`；
    答案键含 `source`/`disclaimer`（明示跨院重复比例与罕见病患病率均为注入且后者已放大）
    与 `params.eventRateAmplification`（事件率放大倍数）与 `params.rareRatePerYear`（罕见病放大后率）。

## 2. 算子 `rws.dedup-incidence@1.0.0`

- [x] 2.1 ABI `dedup-incidence@1`：宿主编码（subject 编号映射、分层编号、事件键映射、窗口裁剪）
  + `packages/wasm-algorithms/modules/dedup-incidence-as/assembly/dedup-incidence.ts`（纯数字列，零能力，
  排序用宿主 scratch 区，不分配堆）。
  - 完成（2026-10-03）：模块编译通过，**1019 字节 / abi 1 / 只导入 `env.memory`**；
    返回码 `0/3/5/6` 全部实现并测（**含排序契约被破坏 → 6 拒绝**）。
    口径修正一处：相邻合并按「填补 1 天边界空隙」实现（`start ≤ curEnd + 2`），
    实测空 1 天的两段并集人日 **302 → 301**（原稿规则对真正紧邻段无效果，已同步 spec 场景）。
- [x] 2.2 TS 参考模型 `packages/wasm-algorithms/src/dedup-incidence-model.ts`（同语义：区间并集 + 事件去重 + 罕见病最早）。
  - 完成：`normalize`（窗口裁剪 / 白名单 / 罕见病按（层,主体）归并取最早）、`encodeDedupIncidence`
    （键映射 + 三组列排序 + 布局偏移）、`dedupIncidenceCount`（参考语义）、
    `incidenceRatePer100k` / `poissonExactCi`（**精确区间，二分求解**）/ `incidenceRateCiPer100k`。
- [x] 2.3 对拍测试 `scripts/dedup-incidence-parity.test.mjs`：同夹具覆盖
  ①同一人两段重叠观察期；②相邻观察期（合并开关 on/off 两态）；③同一事件两院各记一次；
  ④罕见的多人多日（取最早）；⑤跨窗口裁剪；⑥分层边界（subject 跨层时 `Σ_k uniqueSubjects > 全量去重`）。
  漂移即红。
  - 完成：**8 项全绿**——主对拍（逐字段四格）、合并开关两态（302/301）、排序契约破坏 → 6、
    起点晚于终点 → 5、分层越界 → 3、头部计数不符 → 5、Poisson 区间对参考值（k=0/1/10）、
    率为 0 人日 → `null`。
- [x] 2.4 可复现构建与登记：产出 `dedup-incidence.wasm` + SM3 摘要，写进模块清单与配方。
  - 完成：`SM3=02f0f409c65c93ccd2bd36c3662cc02fd52d7c416c999ed774e61a4f86c67a75`；
    `check-reproducible` 源码重建**逐字节一致**；清单登记算子 `rws.dedup-incidence@1.0.0`；
    `pnpm --filter @medtrust/wasm-algorithms test` **84 项全绿**；仓库守护 0 error。

## 3. 模板、投影与封装

- [x] 3.1 MDOP 模板 `rws.dedup-incidence`（`apps/api/src/mdop/plan-templates.ts`）：
  多院 `dedup-cohort` 各 `source → seal`，节点内 `dedup-incidence → declassify.small_cell`；
  参数含相邻合并开关、事件码/罕见病码白名单、分层定义、`minCell`、`minCellRare`。
  - 完成（2026-10-04）：`DEDUP_INCIDENCE_TEMPLATE_ID='rws.dedup-incidence'` + `buildDedupIncidencePlan`
    （阶段链 `src_*/seal_*/dedup/decTee`；节点阶段带 `roles{cohorts:[…]}`、双白名单、`mergeAdjacent`；
    降密阶段带 `minCell`/`minCellRare`）。校验：**少于两家医院** / 参与方重复 / 缺 id /
    非 URN 节点 / 缺合约 / 缺编码 / `minCell<1` / **`minCellRare < minCell`（罕见病阈值不得更宽）**一律拒。
    测试 `apps/api/src/mdop/dedup-incidence-plan.spec.ts` **5 项通过**。
  - **与设计的差异（如实记录）**：模板暂**未**含「研究窗口」与「标准化人口权重」参数——
    窗口裁剪目前在节点侧参考模型里做、标准化权重属部署参数未接线；二者列入 §5.3 剩余项。
- [x] 3.2 封装投影与白名单：白名单外诊断/事件、窗口外观察期在本地裁剪并留审计。
  - **部分完成**：`dedupCohortProjection`（落在 `apps/connector/src/mdop/operators/seal.ts`）已实现
    「只封白名单内事件/罕见病、无 `linkKey` 或无观察期不出院、罕见病编码不在白名单置 `null`」，
    并有 3 项测试；**未完成**：① 研究窗口外观察期的**本地裁剪 + 审计计数**；
    ② `mergeAdjacent` 目前只写进阶段参数，投影不做区间裁剪（该项本属节点侧口径，模板已留痕）。
- [ ] 3.3 提交入口与演示参与方：多院参与方 + 数据产品/合约（`packages/demo-scenario`）+ 提交入口。
  - 验收证据：模板校验用例 + 一次本地提交产生作业与阶段计划。
  - **部分完成**：提交入口已接（`POST /mdop/jobs/dedup-incidence`，返回 `template=rws.dedup-incidence` 与阶段数）；
    **未完成**：多院演示参与方与数据产品/合约种子、以及一次真实提交产生作业的端到端用例。
- [x] 3.4 节点侧宿主适配（沙箱 ABI）：把多院解封后的队列投影装进模块数字列 ABI、回填结果并校验四条不变量。
  - 完成（2026-10-04）：`apps/connector/src/mdop/node/dedup-incidence-sandbox.ts`
    （`dedupIncidenceRequiredBytes` / `projectDedupIncidence` / `dedupIncidenceFromSandboxOutput` /
    `dedupIncidencePayload` / `dedupIncidenceReference`）；载荷给出**两套**判据
    （`buckets` 供常规 `minCell`、`rareBuckets` 供罕见病 `minCellRare` 单独抑制）；
    沙箱登记 ABI `dedup-incidence@1`；内嵌真字节夹具 `__fixtures__/dedup-incidence-module.ts`。
    测试 `mdop/node/dedup-incidence-sandbox.spec.ts` **4 项通过**：与参考语义逐字段一致
    （重叠并集 / 空 1 天合并 / 事件去重 / 罕见病去重）、**所需内存与模型布局逐字节一致**、
    「并集没生效」与「罕见病超过去重人数」两类不变量违反即拒、形状错误不启动 worker。
- [x] 3.5 执行链接线：把算子挂进节点 wasm 执行器（`tee-node/wasm-runner.ts`）。
  - 完成（2026-10-04）：`NODE_WASM_OPS.dedupIncidence = 'rws.dedup-incidence@1.0.0'` + 分派分支
    `runDedupIncidence`（按 `params.roles{cohorts:[…]}` 取各院输入并摊平成模型三张表；
    **少于两家直接拒**——一家时本地聚合即可，不该走可信空间节点）。
    节点级端到端测试（与 VE 共用 `tee-node/wasm-runner-rws-scenarios.spec.ts`）：
    两院**部分重叠**观察期并集 151 天（不是 101+101）、同一事件两院各记一次只算一次、
    罕见病两院各登记一次按人只算 1 例、调换两院顺序结果不变、单院被拒。

## 4. 去重口径与发布审查

- [ ] 4.1 去重口径实现与记录：观察期并集（含相邻合并开关）、事件按 `(linkKey, 码, 日期)` 去重、
  罕见病首次取最早；口径参数写入作业记录（`declassify-op.ts` / 阶段参数）。
- [ ] 4.2 发布审查双阈值：逐层 `min(uniqueSubjects, eventsDeduped, rareCases)` vs `minCell`；
  `0 < rareCases < minCellRare` 时**罕见病列单独抑制**并标注；整层小格时整层抑制；**不出合计**；
  结果记明抑制层数与两个阈值。
  - **部分完成（2026-10-04）**：节点侧降密算子（`tee-node/declassify-op.ts`）已实现罕见病双阈值——
    载荷带 `rareBuckets` 时，`0 < count < minCellRare` 的层把 `rareCases` 置零并标 `rareSuppressed: true`
    （**不牵连该层其它列**）；`minCellRare` 缺省 10、合约与参数取**较大值**、
    **小于 `minCell` 即拒**（放宽即拒）。测试 `tee-node/declassify-rare-threshold.spec.ts` **4 项通过**。
  - **2026-10-08 调整**：罕见病列抑制与分层对齐从降密算子挪进发布审查
    （`mdop/node/publication-review.ts`），单阶段会话出口不经降密算子也走同一份判定；
    没给 `minCellRare` 时缺省改为 `max(10, minCell)`（原先合约 `minCell > 10` 时所有节点侧降密都会被拒）。
    同一测试文件改用真实审查与闸门，**8 项通过**。
  - **未完成**：① 连接器侧同口径降密（`mdop/operators/l15.ts` 的 `declassify`）尚未识别 `rareBuckets`
    （C2 两阶段路径走节点侧、L1.5 单阶段路径不走该载荷，但两条路径的口径应一致）；
    ② 「整层小格时整层抑制」由既有 `NodePublicationReview` 承担（`buckets` 已按 min(去重人数, 去重事件) 给出），
    但其对 `minCellRare` 的**独立**判据尚未在审查记录里单列（当前由本算子后置处理）。
- [ ] 4.3 不变量校验：design D3 的五条不变量在宿主回填后校验，违反即阶段失败（不输出部分结果）。

## 5. 统计量与去重前后对比

- [ ] 5.1 粗发病率（每 10 万人年）+ Poisson 精确区间（k=0 用单侧上界），标注方法。
- [x] 5.2（2026-10-14 核对：去重前后对比实现在 `packages/wasm-algorithms/src/dedup-incidence-model.ts`（模型同时输出两口径），D-RWS-7 亦把它写成核心证据；`scripts/dedup-incidence-parity.test.mjs` 逐格对拍） **去重前后对比**（核心证据）：同时输出「各院直接相加」与「节点内去重后」两个口径
  的人头/人时/事件与虚增比例；**两个口径都必须过闸**。
- [ ] 5.3 直接标准化率（可选）：按标准人口权重计算，权重为部署参数、MUST NOT 进节点。
- [ ] 5.4 罕见病登记表：去重后例数 + 可给出的分层分布 + 被抑制层如实标注。

> **状态注（2026-10-14）**：6.1/6.2 未完成 —— C3 事实清单（`apps/api/src/result-interpreter/c3-facts.ts`）
> 目前只覆盖 `paired-cohort` 与 `vaccine-scri`；`dedup-incidence` 与 `vaccine-tnd` 尚未接入，
> 故「去重前后对比前置结论行」与「向零虚增说成无差异即 422」都还没有落点。属**真缺口**。

## 6. 解读与结论回查

- [ ] 6.1 事实清单：结论行前置（去重前后对比与虚增比例、粗率与区间、罕见病例数、抑制层数、
  「跨院重复比例为注入」「罕见病患病率已放大 N 倍」「合成数据」三段声明）。
- [ ] 6.2 结论一致性回查：草稿把「向零虚增」说成「无差异」、或把注入比例说成真实重叠率 → 422 拒收。

## 7. 本地端到端

- [x] 7.1 本地闭环：两院合成数据 → 封存 → 节点内 `dedup-incidence` → 双阈值发布审查 → C3 → 与答案键逐格对拍
  （含去重前后对比口径）。
  - 完成（2026-10-04）：演示 runner `apps/connector/src/demo/run-rws-scenarios-e2e.ts`
    （与 VE 共用一条命令 `pnpm --filter @medtrust/connector demo:rws-scenarios`），
    产物落 `evidence/local-run-20261003/`。本次数字：甲院 4038 人 / 乙院 3646 人 → **去重后 6354 人**；
    注入跨院重复事件 **18 起**、观察期部分重叠 **663 例**、空 1 天 **667 例**；
    C3 六层——**直接相加虚增人头 +19.5%~+23.3%、罕见病 +24.6%/+33.3%**；
    **罕见病列单独抑制**在 18-39|F、40-64|F、40-64|M 三层生效（2/2/5 例 < `minCellRare=10`），
    其余列照常发布；65+ 两层保留 87 / 69 例。逐层粗发病率与 Poisson 精确区间见证据 JSON。
- [x] 7.2 闸门：`check-meta-docs` / `check-tee-claims` / `check-c2-traceability` / `openspec validate --strict` 全绿。
  - 完成：四道守护 **0 error**；本变更 `openspec validate --strict` **valid**；
    另有 `verify-rws-datasets.mjs` 用真模块对两院数据集逐格校验（6 层一致）+ 断言虚增方向正确。

> **状态注（2026-10-14）**：8.1/8.2/8.3 未完成 —— 需按 runbook 拉起两院真机（TDX 节点 + 校验方），属**设施**约束。

## 8. 服务器真跑（三台 Intel）

- [ ] 8.1 环境：按 `tdx-attestation-pilot/runbook-rebuild.md` 拉起；节点模块库新增 `dedup-incidence.wasm`。
- [ ] 8.2 两院真跑：两院（域 A worker）→ teeA（TDX）节点内执行 → teeB（校验方）按证明释放密钥 → 双阈值发布审查
  → C3 → 回执上链 → 销毁（`PURGED`）。
  - 验收证据：作业记录（阶段全绿、`attestationLevel=hardware`、TCB 5.1.3、抑制层数与两阈值）、
    teeA/teeB/worker 日志原文、链上 block 号。
  - **部分完成（2026-10-03 真机实测）**：teeA（阿里云 g8i，TDX）内已实测——
    真模块字节取自**节点本地模块库**（`/opt/medtrust/modules/<sm3>.wasm`）、
    真实 TDX quote 5006 字节（`xdattest prove`，REPORTDATA 前 32B = `sm3(pub)` 其余置零）、
    结果与答案键**逐格一致**。证据：`pitch/rws-showcase-20261003/`（tdx-run.log + 终端截图 + harness）。
    **未完成**：平台侧完整 C2 调度链（合约要约 → 中继 → 会话见证 → KMS 释放 → 出域上链）——
    需把平台与节点 bundle 更新到含新模板/新算子的版本后重发作业；该链路由场景一 AEFI 作业已实测。
- [ ] 8.3 结果与答案键逐格一致（含被抑制层与罕见病单列抑制层）；偏差即阻断并记 Observation。

## 9. 证据、回写与物料

- [x] 9.1 证据入库：`evidence/dedup-incidence-<date>/`（作业记录、日志、答案键对拍、模块摘要），等级逐项标注。
  - 完成：`evidence/local-run-20261003/`（本地端到端 JSON + 终端日志 + README，A 级）与
    `evidence/tdx-run-20261003/tdx-run.log`（真机客户机内运行原文，A 级）；
    证据地图见 `docs/rws-trusted-space-solution.md` §8。
- [x] 9.2 `DECISIONS.md`：登记去重口径（观察期并集 + 相邻合并 + 事件去重 + 罕见病最早）、
  双阈值发布审查（`minCell` / `minCellRare`）与「去重前后对比必须同时过闸」。
  - 完成：`D-RWS-7`（四件套口径 + 双阈值 + 对比值同闸 + 排序契约 fail-closed）。
- [x] 9.3 对外物料：进入「面向真实世界研究的可信空间解决方案」deck/视频（截图 + 旁白），逐处标注注入比例与放大倍数。
  - 完成：同 VE 变更 8.3（同一份 deck/视频/截图，逐页标注「跨院重复比例为注入」「罕见病率已放大」）。
- [ ] 9.4 三闸门复跑 + `openspec validate --strict cross-hospital-dedup-incidence`。

## 10. 评审遗留（2026-10-08 提交前代码评审）

已当场修掉并补测试的：罕见病抑制只在降密算子里做（单阶段出口绕过）、`minCell > 10` 时缺省罕见病阈值
导致全部拒发、结果里 `mergeAdjacent` 写死为 `true`。以下未动，需要决策或另行排期：

- [x] 10.1（2026-10-14 修复）合约 schema 补 `publication.minCellRare`（`packages/mdop/src/schema/contract.ts`）：类型 + `checkKeys` 可选键 + 归一化 + **D-RWS-7 的 fail-closed 判据**（`minCellRare < minCell` 即抛 `SchemaError`）；用例加在 `packages/mdop/src/schema/schema.spec.ts` `minCellRare` 进不了合约：合约 schema（`packages/mdop/src/schema/contract.ts`）只认
  `publication.minCell`，带 `minCellRare` 的合约会被解析器拒收。现在这个阈值只能由申请方在模板参数里给
  （可以给到与 `minCell` 相同），持有方没法在合约里钉死 10——与 D-DC-2「闸门参数归合约」不一致。
  `declassify-rare-threshold.spec.ts` 里「合约阈值更严」那一项测的是解析器不接受的合约形状。
- [x] 10.2（2026-10-14 修复）平台收不了结果已补：med 包新增 `dedup-incidence` 收集器（`industries/med/src/collectors/dedup-incidence.ts`，直通 + 形状校验；**多产出节点显式拒绝** —— 两份各自去重的结果相加会把同一人重复计入）并注册进 `medAggregationCollectors()`；用例 `apps/api/src/mdop/mdop-collect-dedup.spec.ts`（4 例，含注册面解析） 平台收不了结果：`apps/api/src/mdop/mdop-merge.service.ts` 只有 `vaccine-scri` / `paired-cohort`
  的收集分支，本场景的 C3 会落到比例失衡的合并里报错；`mdop-messages.controller.ts` 只记日志，
  作业停在 `RUNNING`、`result` 为空、成功路径的销毁不触发。入口 `POST /mdop/jobs/dedup-incidence`
  已经存在，上线前必须先补收集方（或先把入口关掉）。
- [ ] 10.3 罕见病列的口径细节：`rareSuppressed: true` 区分了「1–9 例」与「0 例」（常规列刻意不区分）；
  整层被常规阈值抑制时 `rareBuckets` 仍留着原计数；审查记录的 `suppressed` 不含罕见病格。
- [ ] 10.4 去重范围：按（层, 主体）去重，同一人在两院年龄段不同会被算两次；「至少两家」不去重 URN；
  模板总是写 `minCell`（缺省 5），合约高于 5 时编译被拒（其它模板继承合约值）。
- [x] 10.5 沿用自场景一的三个通病（三场景同样存在，不是本变更引入）：编码白名单为空或不是字符串数组时
  等于不过滤；节点把错误文案原样报给平台，文案里带原始行值或审查前计数；没给 `strataKeys` 时，
  持有方行里的自由文本 `ageBand|sex` 会作为层键进 C3。
  - 完成（2026-10-07，四个场景一并）：白名单无效即拒（模板 400 / 封存投影必填否则封存失败 / 节点「给了就须合规」）；
    节点算子入口 `wasm-runner.ts#createNodeWasmRunner` 把非 `MdopError` 报错换成固定文案、原文只留本地日志；
    分层键闭合语法收在 `packages/mdop/src/schema/stratum-key.ts`，模板 / 封存 / 节点（参数 + 结果层键）共用。
  - 同批另修：单阶段出口路径的阈值原为「阶段参数优先于合约」，现取较大值（`node-messages.ts#minCellOf`）。
