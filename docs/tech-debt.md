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

`apps/api/src/blockchain/services/vault-key.service.ts` 与 `apps/api/src/blockchain/adapters/chain.adapter.ts`
直接 import `sm-crypto`，绕过 `GMCryptoService`（TRUST.md 红线 1 的白名单现状）。
偿还 = 两处改走 GMCryptoService 后把白名单收缩为 `apps/api/src/security/crypto/` 单目录。

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

`data/synthea/` 下 `connectors/{huashan,ruijin}/`（290）+ `hospitals/{huashan,ruijin}/fhir/`（~283）+
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

## 已偿还

（空）
