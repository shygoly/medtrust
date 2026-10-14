# docs/tech-debt.md — 技术债登记（TD-x）

> `TD-x` = 待偿还的妥协，与 `D-x`（决策，DECISIONS.md）/ `INV-x`（不变量，DOMAIN.md）/
> `CTL-x`（信任控制点，TRUST.md）命名空间正交。债务非契约，check-meta-docs.mjs 不校验本册，
> 但代码里写 `TD-x` 标记时应在此有条目。偿还后条目移入"已偿还"节，不删除。

## 在册债务

### TD-1：`apps/api/src/main.ts` 的 `useGlobalPipe` 拼写错误

`useGlobalPipe(...)` 应为 `useGlobalPipes`（复数）。本地直接启动真实 NestJS app 会挂；
Fly 上的 `fly-services/api` 构建不受影响的原因需一并核实。偿还 = 修正 + 本地 `pnpm --filter api dev` 可启动。

### TD-2：`apps/web/src/types/task-status.types.ts` 状态色硬编码 Tailwind 浅色类

与 DESIGN.md §2 的 `--cs-*` token 体系脱节（`bg-blue-100` 等）。偿还 = 迁移到 §2 映射表
token；迁移后在 check-meta-docs.mjs v2 开启 DESIGN §2 ↔ 此文件的对拍。

### TD-3：legacy `/dashboard`（浅色 shadcn 主题）迁移未完

新页面已一律 `(console)` Vital Ink；legacy 路由仍在线。偿还 = 全部迁至 `/space` 后下线
浅色主题变量。

### TD-4：`apps/web` 内残留 npm `package-lock.json`

pnpm workspace 内的 npm 安装残留物。偿还 = 删除并确认 CI/部署仅走 pnpm。

### TD-5：`sm-crypto` 直引未收敛到安全中枢

`apps/api/src/blockchain/adapters/chain.adapter.ts` 直接 import `sm-crypto`，绕过 `GMCryptoService`
（TRUST.md 红线 1 的白名单现状；另一处 `blockchain/services/vault-key.service.ts` 系未接线的死代码，已随 web3 旧链路删除）。
偿还 = 该处改走 GMCryptoService 后把白名单收缩为 `apps/api/src/security/crypto/` 单目录。

**2026-09-26 复核扩项**：红线 1 此前声称的「grep（v2 自动化）」守护**从未存在**，白名单也与代码不符。
补上实机检（`scripts/check-crypto-imports.mjs`，挂进 `pnpm test`）后，控制面字面之外的直引被如实登记为
**在册偏离**（不是合规），本债因此扩为三处，一并偿还：
`apps/api/src/common/canonical-json.ts`（纯函数工具、拿不到注入的服务，偿还前需先定形）、
`apps/api/src/runtime/participant-identity/platform-key-store.ts` 与
`apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts`（后两处改走 `GMCryptoService.sm3` 即可）。
在册偏离**只许减少**——还清后必须从 `REGISTERED_DEVIATIONS` 删除，否则 `check-crypto-imports` 判红。

### TD-6：RWS 轨道的控制面结算未接线

`value-settlement` 规格的 RWS 轨道（按数字合约计价 × `cohortSize` 贡献占比分账，D12/D-VS-1）
**只在连接器离线路径实现**（`apps/connector/src/domain/settlement.ts` + `rws-orchestrator.ts`）；
控制面的 `apps/api/src/runtime/rws-orchestrator` 完全没有接 `SettlementService`。
生产在跑的唯一结算是 SecretFlow 轨道的预算制（`secretflow-orchestrator.service.ts`），
计费口径不同（算力/交付物 vs 数据贡献），两者已在归档时拆为独立需求，不再互相套用。

偿还 = 控制面 RWS 编排在任务完成后按合约 `pricing` × 各院 `cohortSize` 生成结算记录；
合约无 `pricing` 时不产生记录（规格「无计价不计费」场景），且 MUST NOT 套用默认金额兜底。

发现于 2026-07-21 归档 `federated-data-space-rws` 的实现核实。合约侧 `pricing` 字段与
哈希纳入已于同日补齐（`packages/database/src/control-plane/index.ts` + `contract.service.ts`）。

> **补注（2026-10-13，批次 1A 迁移核实）**：L4 的两条通道**当前都不喂控制面结算** ——
> `grep -rn 'settlement\|Settlement' apps/api/src/runtime/fl-orchestrator/*.ts apps/api/src/mdop/*.ts` 为空，
> 即「换通道」不改变任何结算输入（也没有可回归的路径）。因此**偿还本债时 MUST 同时覆盖 MDOP 通道的 L4**
> （按 MDOP 的 `cp_mdop_receipt`/交付物计贡献），否则「先迁通道、后补结算」会在补的时候只补旧通道，漏掉已迁移的 L4。

### TD-7：仓库提交了 ~1149 个合成 Synthea 数据文件

`data/synthea/` 下 `connectors/{demohospa,demohospb}/`（290）+ `hospitals/{demohospa,demohospb}/fhir/`（~283）+
`ingested-clinical-text/`（567）共约 1149 个合成数据文件**已被 git 跟踪**（膨胀仓库几~几十 MB）。
它们被提交是为了让 **Fly 构建免跑 Synthea（需 Java）**：`fly-services/connector/Dockerfile.connector:14`
`COPY data/synthea/connectors/${SYNTHEA_CONNECTOR} /data/synthea/ingested`，若干连接器测试与
`run-synthea-e2e.ts` 亦读这些路径。

偿还 = 先建**确定性重生成路径**（修正 Synthea 生成的模块配置——当前 `-m` 标志产 0 糖尿病，见
`rws-test-data-signal-injection` change task 1；生成 + 切分脚本产出 `connectors/`/`hospitals/`），
接进 Dockerfile 构建步或 prebuild、验证 Fly 构建/测试仍绿后，再 `git rm --cached` 这三个目录 +
gitignore。**顺序不可颠倒**：先 untrack 后补生成会让 fresh clone/Fly 构建处于坏态。

增量已止：本 change 新生成的 `data/rws-test-data/` 已 gitignore（D-DATA-1，seed 可复现）。
发现于 2026-07-24 与用户讨论测试数据是否入库。

### TD-8：存证指针账本的两处缺口（历史回填不全 + sidecar 按哈希查询未经真链验证）

2026-10-07 接通 `cp_attestation_ref`（DOMAIN INV-ATT-02 / INV-ATT-03）时留下两处未闭合：

1. **历史回填不全**：`AttestationLedgerBackfillService` 只能从存了「哈希 + 交易号 + 区块」三要素的表里回填
   （RWS / FL 任务、数字合约、MDOP 回执链锚定、节点证明登记）。`cp_qtl_breach` 没存证据哈希、
   SecretFlow 回执不落控制面库——这两类**历史**记录进不了账本（新记录不受影响）。
   偿还 = 越限表补存证据哈希后补回填，或接受历史缺口并在账本页注明起始日期。
2. **sidecar 按哈希查询未经真链验证**：`fly-services/chain-sdk` 的 `GET /attestation/<hash>`、
   `/attest` 回滚判定与扫块索引只做了离线编译与 ABI 解码自检（本机无 ChainMaker 节点）。
   此前仓库里的版本**编译不过**（`queryContract` 少一个参数）且结构体偏移读错（未存证的哈希会读成「存在」），
   所以线上跑的仍是没有按哈希查询的旧镜像。偿还 = 重新构建 chain 镜像后在真链上验三件事：
   已存证哈希回带正确交易号 / 区块；未存证哈希 `exists:false`；重复提交回带 `alreadyExists:true` 与既有记录。

### TD-11：（已修 2026-10-14）`tee-node/poller.spec.ts` 曾是**时序型 flaky**（全量跑偶发红）

**现象**（2026-10-13 实测）：同一次会话里，连接器全量套件先跑出
`3 skipped, 135 passed, 135 of 138 total`（通过），随后再跑一次变成
`1 failed, 3 skipped, 134 passed, 135 of 138 total`，失败的就是 `src/tee-node/poller.spec.ts`（该用例耗时 ~15.5s）。
**单独跑两次都是 12/12 通过** —— 与本轮改动无关（改动在 `mdop/executor`、`sandbox`、`operators/l4`）。

**判断**：典型的时序/资源敏感用例（轮询间隔 + 全量跑时的 CPU 争用），不是逻辑错误。
**为什么值得记**：「偶发红」会让人对"全绿"失去信任，也让真正的回归被当成噪声忽略（本轮就差点如此）。
**修法（2026-10-14 已做，按上面这条建议，没有调大 `testTimeout`）**：

1. 「响应头迟迟不来 → 到点中止」那条：原先断言 **墙钟 `<2_000ms`**（机器忙时假红）。改成
   `jest.useFakeTimers()` + `advanceTimersByTimeAsync(等待上限+宽限+余量)`，时限语义由**推进量**确定性地钉住，
   不再依赖真实时间；断言改为「收到超时 → `signal.aborted === true`」。
2. 「真实传输滴流不止 → 到点中止」那条：去掉上界式墙钟断言 **`<8_000ms`**，只保留**下界** `≥290ms`
   与结果式断言（`closedByClient` —— 底层连接确实断开）。「不会拖太久」的语义已由上一条假定时器用例确定性地覆盖，
   所以这里删上界不是放松覆盖，而是去掉一个**随时序抖动**的判据。
3. 其余「慢但一直在传不得被掐断」用的是**下界**（`> graceMs`），竞争只会让它更大，不是 flaky 源，保持原样。

**复验**（2026-10-14）：单元文件连跑 5 次 + **并发 4 份**全部 12/12 通过；**连接器全量套件复验**（2026-10-14）：`Test Suites: 3 skipped, 136 passed, 136 of 139 total`、`Tests: 42 skipped, 909 passed, 951 total`、耗时 113.9s、**0 失败** ✅（此前同一场景偶发红的就是这个文件）。

### TD-15：外部对照匹配可能把同一受试者匹配成自己的对照（2026-10-14 记）

**现象**：`external-control-arm` 的节点内匹配以 `subjectKey` **排序**后按窗口贪心对齐，`subjectKey` 不参与唯一性校验；
若同一人同时出现在申办方试验池与医院对照池，理论上可被判为「自己的对照」。

**影响**：该配对会低估效应量（自己与自己比），但**不会**把个体数据带出域（产物仍是聚合桶）。
已按 D-RWS-8 ③ 记为**已知限制**。

**建议修法**：匹配前做一次跨池互斥（同一 `subjectKey` 同时出现在两池时，从对照池剔除该主体），
并加一条「同主体跨池」用例钉住；改动落在 `apps/connector/src/mdop/node/external-control-sandbox.ts`。

**✅ TD-15 的修复（2026-10-14）**：已在宿主投影入口 `projectExternalControl` 做跨池互斥 ——
`trialRows` 的 `subjectKey` 集合作为排除表，对照池里同主体的一律不进编码（`encodeExternalControl({ ...input, controlRows })`）。
只影响重复的那一份，两池各自的角色不变；用例加在
`apps/connector/src/tee-node/wasm-runner-external-control.spec.ts`（「跨池互斥」一条，用投影的 `controls` 计数钉住），
该文件 6 例全过。**未修的部分**：模块内的贪心匹配算法本身没动（宿主已把非法输入挡在门外）。

### TD-14：`power-space.seed.spec.ts` 在**全量并发**下偶发 5 秒超时（2026-10-14 记）

**现象**：`pnpm test` 全链跑时该用例抛 `Exceeded timeout of 5000 ms for a test`
（用例名「补目录时不改写已属于默认空间的记录，新产品未确权且行数为 0」）。

**复现与判定**：单独跑该文件 **3/3 全过**（每次 7 例）；**全链连跑两次都在它上面超时**（7.5s 耗时里那一步超 5s 预算）。
触发条件含**本机 Docker VM 的运行开销**（macOS 上 Docker 常驻会挤占 CPU/RAM；本机为跑 wasm 可复现构建而起了 Docker，同一时段全链即稳定超时）。
与 TD-11 同类（用时序/资源竞争而非逻辑错误），且该文件位于**用户 WIP 区**（`apps/api/src/runtime/space-packs/` 有未提交改动）——
**本目录的修复归该 WIP 的作者**，此处只登记现象与判据，不动该文件。

**建议修法（同 TD-11 的原则）**：把该用例里依赖真实耗时/初始化规模的等待改成**确定性等待**（注入时钟或条件等待），
或把「目录补写」的准备数据规模与断言目标解耦；**不要**只调大 `testTimeout` 掩盖。

### TD-13（迁移遗留，2026-10-14 记）：L1.5 双通道详情页（A2）的收敛

**现象**：L1.5 迁移期存在两个详情入口 —— 旧 RWS 任务详情与 MDOP 作业详情（前端信息架构审计 A2 记为「双通道两套详情」）。

**收敛路径**：随 `mdop-orchestration-migration` 的 3.x 收口 —— 旧入口对 `rws.disproportionality` 已 409，
观察窗（2026-10-13 起算 5 天，最早 2026-10-18）满后把台账置 `legacy-removed` 并删旧接线，旧详情页随之失效/删除；
**本变更的兑现点**：`orchestration.migration.json` 的 `legacyRefs`（含 `/space/federated` 类前端入口）+ `check:nav` 守护。

**判据**：`check:orchestration` 的 O7（观察窗未满不得 `legacy-removed`）+ `check:nav` 全绿 + 旧入口不可达。

### TD-10：（已修 2026-10-13）DP 用例断言了 DP 不能保证的性质

**现象**：`apps/connector/src/domain/fl-prediction/fl-task-runner.spec.ts` 的
"returns party-local FL result after PEP check" 断言 `expect(result.localMetrics.auc).toBeGreaterThan(0)`，
默认 `pnpm test` 里长期红（`Expected: > 0 / Received: 0`）。

**根因（用探针实测定位；此前两版猜测「投影路径降级成 0」「DP 闸门补 0」都是错的）**：

1. `ckdEsrdRiskFlPredictionSpec()` 声明 `privacy: { dpEpsilon: 1.0, dpDelta: 1e-5, minCohortSize: 5 }`，
   而 `finalizePartyResultWithDp` → `applyDpToPartyMetrics`（`fl-dp-gate.ts:16-31`）对**每个存在**的指标
   加 Laplace 噪声（`scale = 1 / Math.max(ε, 0.1) = 1.0`）再裁剪到 `[0,1]`。
   —— 一个约 0.74 的 AUC 被 scale=1.0 的噪声推到 **0 是完全合法的 DP 结果**。
2. 探针实测该用例的返回值：`{"auc":0,"f1":1,"precision":1,"recall":0}`（噪声把各指标分别推到两端），
   且 `CONNECTOR_ML_URL` 未设 → 走 `MockFlAdapter`（其原值是 `base+0.06 ≈ 0.74`，同样被噪声改写）。
3. 所以 `> 0` **不是 DP 下的不变量**，断言本身就是错的（**不是产品缺陷**）。
4. 次要事实（不构成红因，但说明这条用例本来也没在测训练）：夹具只有 2 行且**不带规格要的特征**
   （`egfr/scr/uacr/ckd_stage/bp_systolic`）→ `X` 全零、`y=[0,0]`；规格是 `xgboost/secureboost`，
   因此也不走 in-connector 的 `logistic_regression + fedavg` 本地分支。

**修法（已做）**：断言改为 **DP 有效边界**（`0 ≤ auc ≤ 1` + `dpApplied === true`）并在注释里写明原因；
两处同样的断言都改了。「真训练出有效 AUC」由 `local-logistic.spec.ts` 的非 DP 用例（200/4000 行夹具）覆盖。

**教训**：给 DP 后的指标写断言，只能写 **DP 有效边界**；要看真实模型质量，必须断言**加噪前**的值
（直接调 `trainLocalLogisticParty` / `trainLogisticRegression`），或在那条通道上关掉 DP。

### TD-9：编排迁移未收尾（L1.5 旧接线待删；RWS 其余类型与 FL 家族仍在旧通道）

编排正从「各写各的」逐类接替到 MDOP（D-MDOP-7，台账
`apps/api/src/runtime/orchestration/orchestration.migration.json`）。L1.5 失衡检测已于 2026-10-13
切换为 MDOP 单通道（`cutoverAt`，旧入口即行 409 `E_CHANNEL_MDOP`），但**旧通道接线仍在**：web 旧投递
分支、API `POST /rws/tasks` 的受理路径、connector `rws-executor` 的 L1.5 分支。按闸门④须连续稳定
运行满 5 天，**最早 2026-10-18** 才可删；守护 O7 已把这条时间闸变成机检（提前置 `legacy-removed` 报红）。

未迁：RWS 阶梯其余 7 个分析类型（`pending`）；L4 联邦预测（批次 1A）的**实现与等价性证据已于 2026-10-14 就绪**
（`openspec/changes/mdop-fl-migration`：逐字段等价、容差、跨节点黄金夹具、作业级节点消息闭环、1A 轮次语义、出域口径），
**未做的是切换与下线**（5.1–5.4：置 `cutoverAt`、5 天观察窗 + 回滚演练、删旧接线）；LoRA FedAvg（批次 1B）仍被
D-MDOP-8 的节点间安全聚合与协议 v0.3 扩展挡住。并存期本身有守护约束（不双写 / 不过桥 / legacy 只减不增），
**拖着不收尾才会重新长成「两种并列能力」**。

偿还 = 窗口满后删 B 清单接线并置 `legacy-removed`（`openspec/changes/mdop-orchestration-migration`
tasks 3.5/3.6）；FL 家族迁移另立变更。

发现于 2026-10-13 编排迁移实施（mdop-orchestration-migration）。

### TD-12：基座纯度（D-SPD-18 目标布局）未达标，且该守护未挂进任何脚本

`scripts/check-kernel-purity.mjs`（D-SPD-18：基座不得出现行业词 + 依赖方向单向「包 → SPI → 基座」）
有默认的**目标布局**模式（严格，报红即退出 1）与 `--baseline`（P0 基线）模式。实测（2026-10-14）：
目标布局模式扫描 19 个基座目录 / 212 个文件，报**越界（行业词）268 处 / 30 个文件** —— 例如
`packages/mdop` 内的行业算子（`collectPairedCohort` / `collectVaccineScri`）以及
`apps/api/src/mdop/mdop-merge.service.ts` 对它们的直接 import。即：**MDOP 内核今天仍承载医疗行业算子**，
「基座 / 行业分册」的拆分只做了一半。

**2026-10-14：第一步（棘轮）已落地。** `scripts/check-kernel-purity.mjs` 新增 `--ratchet <基线文件>` 与
`--write-baseline <文件>`；基线 `scripts/kernel-purity-baseline.json` 以「文件::标记 → 计数」记录当前
**246 处 / 25 文件**（不含行号——行号会随改动漂移，会造成假变更）。该棘轮**已挂进根 `pnpm test`**：
只许减少、新增即报红；负向自检在 `scripts/check-kernel-purity.test.mjs`（注入越界 → 报红，实测退出码 1）。
于是「不跑的守护等于没有守护」这半边消掉了：**它现在会拦人**。

**仍未做（真正的偿还）**：把行业词/行业算子从基座目录（`apps/api/src`、`apps/connector/src`、`packages/mdop`）
搬进行业册（`industries/med`），目标布局模式下清零后再切默认模式。棘轮只保证「不再变差」，
不改变「基座当前并不中立」这一事实。

**2026-10-14 第二轮勘察：为什么「下一刀」不是搬文件，而是补 SPI 缝**

逐个候选查了引用方，结论是**没有一个能直接搬**——行业实现与它们的调用方**都住在基座目录里**，
直接搬会把「行业词违规」换成**依赖方向违规**（基座 import 行业包）：

| 候选（违规数） | 唯一/主要调用方（都在基座目录） |
|---|---|
| `apps/api/src/mdop/operators/collect-paired-cohort.ts`(21) + `collect-vaccine-scri.ts`(12) | `apps/api/src/mdop/mdop-merge.service.ts`（第 26–27 行静态 import） |
| `apps/connector/src/mdop/node/{pairing,scri,ve-tnd,dedup-incidence}-sandbox.ts`(24) | `apps/connector/src/tee-node/wasm-runner.ts`（第 40–58 行） |
| `apps/api/src/mdop/plan-templates.ts`(49) | `apps/api/src/mdop/mdop.controller.ts` |
| `apps/api/src/runtime/digital-contract/participant-aliases.ts`(3) | `attestation-ledger.service.ts`（同目录） |

（判据：`scanKernelPurity` 的 `importViolations` 会把「基座文件 import 了含 `industries/med` 的说明符」记为违规。）

**正规缝隙已经有一半**：`packages/space-kernel-spi` 定义了 `OperatorPack`（`packId` + `declareOperators(ctx)`）；
`industries/med`（= `@medtrust/domain-med`，P1 骨架）的 manifest 已声明 `operators: [disproportionality, paired-cohort, vaccine-scri]`，
但其 `declareOperators()` 现在**返回空集**（`src/seams.ts`：摘要 MUST 取自 `packages/wasm-algorithms` 的复现构建清单，接线前不臆造 digest）——
**未完成的正是这条缝**。所以「下一刀」的正确形态是：

1. SPI 增一条**平台侧聚合缝隙**（合并收集器 / `CollectorRegistry` 之类），与 `OperatorPack` 并列（**这是 SPI/PACK/KERNEL 的契约变更**，要同步治理文档）；
2. 把 `collect-*.ts` 等纯叶子实现搬进 `industries/med/src/`，由包导出注册函数（它们本身零内部依赖，是全仓最干净的一批）；
3. 注册点在**非基座**的组装根（`apps/api/src/app.module.ts`；连接器侧同理），并给 `apps/api` 加 `@medtrust/domain-med` 依赖；
4. 测试要显式注册（jest setup 或逐 spec），因为基座 spec 直接 `new` 服务、不走 Nest 装配。

**为什么不顺手做掉**：这条链的落点是 `mdop-merge.service` 的**分派路径**——它正是 2026-10-14 在**真实 TDX 节点**上跑通端到端作业
（`openspec/changes/tdx-attestation-pilot/evidence/rerun-20261014/`）的那条路径。跨 3 个包 + 组装根 + 测试装配的半截反转，
比「没做」更危险（守卫会红或行为静默变化）。

**2026-10-14：第二刀已落地（第一刀完整形态）。** 变更 `pack-med-collectors` 按上述配方做完：
SPI 的 S2 增**可选** `declareCollectors`（**不新开第七根缝**——SPI 是机检的六根）→ 基座新增域中立 `collector-registry.ts` →
`collect-paired-cohort` / `collect-vaccine-scri` 搬进 `industries/med/src/collectors/`（**逐字节同体**，仅加 2 行 SPDX 头）→
组装根 `apps/api/src/app.module.ts` 注册 + jest `setupFiles`（`apps/api/src/test/register-collectors.ts`）同一注册 → 双闸通过：
**棘轮 246 → 205（−41）**、目标布局 268 → 227、`importViolations` 仍 0、api 全量 139 套件 / 1059 用例通过。
证据：`openspec/changes/pack-med-collectors/evidence/README.md`。

**下一刀（未做）**：连接器侧 4 个 sandbox（24 处，`tee-node/wasm-runner.ts` 引用）与 `apps/api/src/mdop/plan-templates.ts`(49) + `mdop.controller.ts`(16)；
wasm 算子登记仍为空集（等摘要取自复现构建清单）。
wasm 算子登记仍为空集（等摘要取自复现构建清单）。

**2026-10-14 第三刀勘察（已立变更、未动手）**：4 个 connector sandbox 不是单一函数——每个导出「编码 / 下限 /
解码 / 载荷」四件套，`wasm-runner.ts`（688 行）里对应**四段按分析类型的执行分支**（约 250 行，与各自类型耦合）；
而该文件注释写明**三条与出域有关的规矩就钉在这一处唯一入口**（错误文案不带数据 / 编码白名单 / 分层键闭合语法）。
搬走分支 = 把出域判据搬进行业包 = **安全回归**，所以立独立变更 `pack-med-sandboxes`（proposal/design/tasks/specs 已就绪并 validate 通过）：
形态选 **S-B**——分析逻辑整段进包（`StageSandbox.runStage(stage, host)`），出域判据留在基座并由 `SandboxHost` 承载，
包只能经 `host` 拿到**已放行**的输入；验收三重闸：connector 全量（136 套件 / 909 用例）+ 三条判据各留**负例** + 棘轮 **205 → ≤181**。

**2026-10-14：第三刀已开第一锯（竖切 ve-tnd）。** SPI 增 StageSandbox/SandboxHost/SandboxRegistry + 可选 declareSandboxes；
基座新增 sandbox-registry.ts 与 buildSandboxHost（**三条出域判据全留在基座**：错误脱敏与结果层键复校在统一入口、
编码白名单与分层键由宿主闭包提供），分派处先查注册表、未注册回落内置分支；包侧 industries/med/src/sandboxes/ 接 ve-tnd，
组装根 + jest setupFiles 注册。**连接器全量 136 套件 / 909 用例通过；棘轮 205 → 201；importViolations 仍 0**；
证据 openspec/changes/pack-med-sandboxes/evidence/README.md。
**下一锯**：pairing(16) / scri(2) / dedup-incidence(4) 三条按同一形态接入（预计 → ≤179）。

**2026-10-14：第三刀已锯完（四条全接入）。** pairing / scri / dedup-incidence 按同一形态接入（分析专用助手 `flattenDedupCohorts` 随包走；
宿主补 `tables` 与 `configuredStrataKeys` 两个原语；分派尾部补**显式 fail-closed**）。两个必须记的坑：
① 包内校验抛普通 `Error` 会被出域脱敏换成固定文案 → 必须仍抛 `MdopError`（med 包因此加 `@mdtrust/mdop` 依赖）；
② 末位分支搬走后会漏 `undefined` → 补 throw 正好把「未知算子 fail-closed」落成代码。
**连接器全量 136 套件 / 909 用例通过；棘轮 205 → 201 → 163；目标布局 227 → 185；`importViolations` 始终 0。**
第二刀 + 第三刀累计：**246 → 163（−83）**。下一刀只剩 `plan-templates.ts`(49) + `mdop.controller.ts`(16)（需模板注册缝 + DTO 级联，另立变更）。

**2026-10-14：第四刀开第一锯（模板竖切 paired-cohort）。** 变更 `pack-med-templates`：SPI 的 S2 增可选 `declareTemplates`；
协议核新增 `PlanInputError`（入参不合法、零 HTTP 依赖）并把 `LogicalPlanDraft` 提升上来；基座新增 `template-registry.ts`
（含 `buildPlanWithInputMapping`：解析 → 构建 → 领域错误映射 HTTP 400、文案原样）；包内 `templates/paired-cohort.ts` **逐字搬移**
（仅 `space` 改入参 + `BadRequestException`→`PlanInputError` 两处差异）。**api mdop 31 套件 / 183 用例通过；棘轮 163 → 156**
（`plan-templates.ts` 49→44、控制器 16→14）；`importViolations` 仍 0。证据 `openspec/changes/pack-med-templates/evidence/README.md`。
**下一锯**：`vaccine-scri` / `ve-tnd` / `dedup-incidence` / `l15` 四个模板按同一形态搬（预计 → ≤128）；
**L4 模板显式留待** FL 迁移 5.x 与 `FlPredictionTaskSpec` 一起动。控制器保留的模板 id 常量属**平台 API 面**（路由 + 台账 key），不归零也不应归零。

**2026-10-14：第四刀锯完（四个模板全部搬入；L4 有意留下）。** 包内 `templates/l15.ts` + `templates/medical-plans.ts`
（后者含 SCRI / VE-TND / 跨院去重与三者共享的入参助手），逐字搬移，24 处 `BadRequestException` → `PlanInputError`；
内核 `plan-templates.ts` 从 **633 行降到 119 行**（只剩 id 常量 + L4）；控制器四个端点改经 `buildPlanWithInputMapping`。
**api 全量 140 套件 / 1064 用例通过；棘轮 156 → 123；目标布局 178 → 145**（`plan-templates.ts` 49→13、控制器 16→12）；`importViolations` 仍 0。
**TD-12 累计 246 → 123（−50%）**。剩余（有意）：**L4 模板 + `FlPredictionTaskSpec`**（随 FL 迁移 5.x）、模板 id 常量与路由（平台 API 面）。

**2026-10-14：L4 模板也搬完（TD-12 的模板簇收口）。** 包内 `templates/l4.ts`（`spec` 用包内结构类型 `L4FlSpecLike`，只声明读到的
`modelType`/`aggregation`，其余透传），控制器 L4 端点经注册表 + `PlanInputError` → 400；内核 `plan-templates.ts` 只剩 id 常量（28 行）。
**api 全量 140 套件 / 1064 用例通过；棘轮 123 → 118；目标布局 145 → 140**；`importViolations` 仍 0。**累计 246 → 118（−52%）**。
**`FlPredictionTaskSpec` 的处置已绑进 FL 迁移变更**（`openspec/changes/mdop-fl-migration` tasks 7.2 / design §7）：它在**非基座目录**（不被棘轮覆盖）
且是 FL 链共用类型，入包要求基座合并路径先有**中立规格视图**——属**结构收益**、须与等价性证据一起做，故放在 5.x 之后独立推进。

**2026-10-14：第五刀勘察后判定「到此为止」（技术边界，非偷懒）。** 剩余 118 处的分布已探明：
**`rws` 77 处**是平台自己的算子/模板引用串（`rws.paired-cohort@1.0.0` 之类，属**协议命名面**）；
`l15.ts` 11 / `seal.ts` 14 / `l4.ts` 8 是连接器算子接线；其余是术语与接口面词汇（`attestation-ledger` 13、控制器 12+7、`merge-disproportionality` 8 等）。

**为什么没有继续搬 `l15.ts`（最小、非出域关键的那一个）**：它需要应用侧的 `MdopStageExecutor` / `StageInput` / `InternalRecord`
（医疗记录：`subjectKey`/`ageBand`/`conditions`/`medications`/`adverseEvents`）。用**结构镜像**缝补会产生**双向断言**
（应用→包要 cast、包→应用也要 cast），我第一次尝试时 wire 与 spec 立刻出现多处 cast —— 这不是干净的搬移，已**回滚并保持树绿**。

**正确解法（需独立变更，先写 change）**：
1. **执行器契约上移**：把 `StageInput` / handler 形状移进 `@medtrust/mdop`（内核包），基座与包**共用同一契约**，不再镜像；
2. **记录类型下移**：把医疗记录类型（`InternalRecord`）移进行业包，执行器改用**中立**记录类型（`Record<string, unknown>`）。
两者一起做才有净收益（只做其一都会留下断言噪声）。

**不建议动的部分**：`rws` 那 77 处是平台自己的算子/模板引用，归零会伤害可读性与可追溯性（它们不是「行业知识漏进基座」，是**协议命名**）。

**结论**：TD-12 已偿还 **246 → 118（−52%）**，四大整簇（平台侧收集器 / 节点侧沙箱 / 计划模板 / L4 模板）全部切完；
其余需上述两项结构性变更 —— **已立变更 `kernel-stage-contract`**（执行器契约上移到 `@medtrust/mdop` + 医疗记录类型下移到行业包，
以「搬 `l15.ts` 且**零新增断言**」为验收），`seal.ts` / `l4.ts` 在该变更内**另行评估**。

### TD-12 结账（2026-10-14）

| 剩余类别 | 归属 |
|---|---|
| `rws` 算子/模板引用串（77 处） | **不动**：平台协议命名面（归零会伤可读性与可追溯性） |
| 连接器算子接线 `l15`(11) / `seal`(14) / `l4`(8) | 变更 `kernel-stage-contract`（`seal`/`l4` 另行评估） |
| 其它术语与接口面词汇（`attestation-ledger` 13、控制器 12+7、`merge-disproportionality` 8 等） | 各自随所属领域变更处理，不单独立项 |

**2026-10-14：FL tasks 7.2（L4 共享 DTO）已完成** —— 规格与校验下移到医疗包（应用侧再导出），基座只当不透明值透传，
合并边界改用**合并专用**谓词 `isFlMergeSpecView` 校验（零断言、fail-closed；准入校验器仍在受理处）。
api 全量 **140 套件 / 1064 用例通过**；棘轮不变（结构收益）。证据 `openspec/changes/mdop-fl-migration/evidence/fl-dto/`。

**状态：本债务转入监督模式** —— `check:kernel-purity --ratchet` 继续挂在 `pnpm test` 链上（**只减不增**），
但不再作为主动推进项；上表三项各自有明确归属。

**2026-10-14：第五刀（`l15.ts`）做成 —— 先做了变更 `kernel-stage-contract` 的两项结构性变更。**
① 阶段执行契约（`StageInput`/`StageOutput`/handler/`WasmRunner`/`StageExecutor`）上移 `@medtrust/mdop`，连接器改为再导出 + `implements`；
② 医疗记录（`AdverseEvent`/`InternalRecord`）下移行业包，`domain/types.ts` 再导出；③ 然后把 `l15.ts` 搬进包 ——
**零新增断言**（契约同源，两侧是同一个类型，不再需要 cast；这正是上一轮镜像方案失败的原因）。
④ 顺带发现 `wire-*.ts` 属**组装关注点**却住在基座目录，搬 `l15` 后会构成方向违规 → 移入 `apps/connector/src/wiring/`。
**棘轮 118 → 103；`importViolations` 0；connector 全量 136 套件 / 909 用例通过；api 构建通过；check-meta-docs 0 error**
（搬移导致 3 处文档路径悬空，已按新位置更新）。证据 `openspec/changes/kernel-stage-contract/evidence/README.md`。
**仍留（有意）**：`seal.ts`（出域关键）、`l4.ts`（绑 `retained` 共享运行时）、`rws` 引用串（协议命名面）。**建议**：作为一个独立变更推进（SPI 缝隙 → med 实现 → 组装根注册 → 测试接线），先写 change 再动手。

发现于 2026-10-14 治理同步（`mdop-fl-migration` 6.1）：核对守卫清单时发现它既未挂链、也非零偏差。
## 已偿还

（空）
