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

发现于 2026-10-14 治理同步（`mdop-fl-migration` 6.1）：核对守卫清单时发现它既未挂链、也非零偏差。
## 已偿还

（空）
