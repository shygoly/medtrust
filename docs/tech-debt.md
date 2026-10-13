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

### TD-10：退化队列的 AUC 以 0 出现（默认 `pnpm test` 有一条红；会拉低 FedAvg 聚合）

**现象**：`apps/connector/src/domain/fl-prediction/fl-task-runner.spec.ts` 的
"returns party-local FL result after PEP check" 断言 `expect(result.localMetrics.auc).toBeGreaterThan(0)`，
**实测 received 0**（本机 2026-10-13，`pnpm test` 默认链里唯一一条红；工作区干净，与 `mdop-fl-migration` 无关）。

**根因（2026-10-13 二次实测修正；第一次写的「undefined 被降级成 0」是错的）**：

1. 夹具是**刻意的 2 行 CKD 记录**（`fl-task-runner.spec.ts:17-37`），而 `ckdEsrdRiskFlPredictionSpec()` 要的特征是
   `egfr / scr / uacr / ckd_stage(G1..G5) / bp_systolic`、目标列 `esrd_event`、`modelType: 'xgboost'`、
   `aggregation: 'secureboost'`（`fl-prediction-task-spec.ts:256-267`）。夹具里**一个特征都没有** →
   实测（`encodeTabularRows`）：**X 全零、y=[0,0]**（单类别）⇒ **这份夹具根本算不出有效 AUC**，
   断言 `> 0` 对它是错的。
2. **那个 0 定位到了**：`finalizePartyResultWithDp` → `applyDpToPartyMetrics`（`fl-dp-gate.ts:23-28`）
   对 5 个指标键**无条件**计算并写回：`out[key] = Number(Math.max(0, Math.min(1, noisy)).toFixed(4))`，
   缺失值以 0 为基（实测：local 路径在**过 DP 闸门之前**是 `undefined` —— 我的探针直接调
   `trainLocalLogisticParty` 得到 undefined，而 runner 里紧接着就过 `finalizePartyResultWithDp`（`fl-task-runner.ts:87`），
   于是 `undefined → 0`）。
   注意这条**不是**只在退化夹具上出现：**任何"没有 AUC"的院**（单类别、样本不足、auc 未被 allowedArtifacts 允许）
   都会在 DP 闸门处变成 0，进而以 0 参与 `mergeFlPartyResults` 的按样本量加权 —— 这正是要修的点。
3. 因此这条测试还有一层更隐蔽的问题：**它依赖运行环境**（有没有 connector-ml sidecar）—— 有 sidecar 时
   AUC 由 sidecar 给，没有时走降级/替身。默认 `pnpm test` 里它红，说明本机这条路径给的是 0；
   换个环境可能变绿。**环境的差异被一条"断言真 AUC"的测试掩盖了。**

**两条候选修法**（**未决**，属该域语义，别替我改）：

- **A（推荐）**：把"无 AUC"明确保持为 `undefined` 一路到底（找并去掉降级成 0 的那处），
  断言改成 `expect(result.localMetrics.auc).toBeUndefined()` —— 钉住"**不伪造指标**"，并把这条
  不变量加到 `assertSafeFlPartyRunResult`/`filterFlRunResultByPolicy` 的回归里。
- **B**：把夹具扩成 ≥4 行、两类齐全（`sampleCount` 断言 2 → 4 需同改，:110 与 :151），
  保留"AUC 可算"的原意，但就测不到退化队列这条。
- **C（我倾向这个）**：让夹具**带上规格真正要的特征**（egfr/scr/uacr/ckd_stage/bp_systolic）并两类齐全，
  断言改成"**本地路径**上 `auc > 0`"（显式走 `logistic_regression + fedavg` 的 local 分支，
  或让该用例固定一个**确定性的替身适配器**）—— 这样它既测到训练、又不依赖环境里有没有 sidecar。
  无论选哪条，**必须同时钉住"没有 AUC 时不得以 0 冒充"**（`mergeFlPartyResults` 只跳过 undefined，
  一个假 0 会拉低按样本量加权的联邦聚合指标）。

### TD-9：编排迁移未收尾（L1.5 旧接线待删；RWS 其余类型与 FL 家族仍在旧通道）

编排正从「各写各的」逐类接替到 MDOP（D-MDOP-7，台账
`apps/api/src/runtime/orchestration/orchestration.migration.json`）。L1.5 失衡检测已于 2026-10-13
切换为 MDOP 单通道（`cutoverAt`，旧入口即行 409 `E_CHANNEL_MDOP`），但**旧通道接线仍在**：web 旧投递
分支、API `POST /rws/tasks` 的受理路径、connector `rws-executor` 的 L1.5 分支。按闸门④须连续稳定
运行满 5 天，**最早 2026-10-18** 才可删；守护 O7 已把这条时间闸变成机检（提前置 `legacy-removed` 报红）。

未迁：RWS 阶梯其余 7 个分析类型（`pending`）、L4 联邦预测（批次 1A）、LoRA FedAvg（批次 1B，被
D-MDOP-8 的节点间安全聚合与协议 v0.3 扩展挡住）。并存期本身有守护约束（不双写 / 不过桥 / legacy 只减不增），
**拖着不收尾才会重新长成「两种并列能力」**。

偿还 = 窗口满后删 B 清单接线并置 `legacy-removed`（`openspec/changes/mdop-orchestration-migration`
tasks 3.5/3.6）；FL 家族迁移另立变更。

发现于 2026-10-13 编排迁移实施（mdop-orchestration-migration）。

## 已偿还

（空）
