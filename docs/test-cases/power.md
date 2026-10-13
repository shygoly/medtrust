# 河南电力空间 · 手测用例（P-01…P-14）

> 通用前置见 [README.md](./README.md)（**E7–E10 必须先做：电力包要显式授权**）、账号 §0.3、取 JWT §0.5。
> 空间 id：`hn-power`（`industries/power/src/scenarios.ts`）。
> **重要**：`POST /spaces/:spaceId/exchanges` **不抛 4xx**——它把这次尝试**记一条**并返回 **201**，拒绝原因在响应体的
> `rejection` 字段里（`apps/api/src/runtime/space-packs/exchange-attempt.service.ts`）。所以「被拒」的预期 = HTTP **201** + 指定 `rejection`。
> 只有**缺字段**才 400（`缺少空间 id` / `缺少应用` / `缺少合约`）。
> **但非空间成员会更早被挡成 403**（`SpaceAccessGuard`），见 P-06。

> **执行记录（2026-10-13 自测，本机）** —— 下列三处是**实测推翻初稿**的地方，已在正文修正：
> ① 记账/成功路径返回 **201**（初稿写 200）；
> ② **P-06 实测为 403**（`SpaceAccessGuard` 在服务层之前挡下），不是 `rejection:"not-space-member"`；
> ③ **P-05 当前不可达**：电力包 `declareOperators()` 返回 `[]`，该空间**没有任何已登记算子摘要**
> （启动日志原文「算子摘要待复现构建后登记」）→ 任何 `operatorDigest` 都会落到 `operator-digest-unregistered`。
> 要让它通过：先让电力包声明真实算子并登记其摘要（`industries/power/src/seams.ts#powerOperators`）。
> 另：`/auth/login` 有**限流**，连续尝试会 429——批量跑用例时登录一次、复用 token。

---

## P-01 电力包授权与空间种子

| 项 | 内容 |
|---|---|
| 前置 | E1–E6 |
| 步骤 | 1. `apps/api/.env` 加 `SPACE_PACKS=med,power`<br>2. 重启 api<br>3. 看启动日志 |
| 预期 | 日志出现「**电力空间 hn-power 已就绪**」；**没有**「电力包不在部署白名单内，不创建电力空间」 |
| 记录 | |
| 来源 | `apps/api/src/runtime/space-packs/power-space.seed.ts#onModuleInit`；`space-pack-registry.service.ts#allowedPacks`；DEPLOY.md §2 `SPACE_PACKS`（缺省 `med`） |

## P-02 电力账号与成员

| 项 | 内容 |
|---|---|
| 前置 | P-01 |
| 步骤 | 1. 用 `grid@hn-power.example` / `demo123456` 登录<br>2. 切到电力空间<br>3. 看成员/协作相关页面 |
| 预期 | 登录成功且身份为「省级电网公司」；该账号属于**三个**协作（urban-anomaly / renewable-absorption / v2g-coordination）；其余 8 家账号各自只属于其参与的协作（见 README §0.3 表） |
| 记录 | |
| 来源 | `industries/power/src/scenarios.ts`（`POWER_DEMO_USERS` / `POWER_PARTICIPANTS`）；`power-space.seed.ts#seedDemoUsers` |

## P-03 三个协作与电力目录

| 项 | 内容 |
|---|---|
| 前置 | P-01；在电力空间内 |
| 步骤 | 打开 **数据产品**，按协作核对下列产品是否都在、分级是否正确 |
| 预期 | **城市用电异常监测**：`dp-pwr-grid-asset`（输配电设备位置与运行状态 · 二级·重要数据）、`dp-pwr-ami-load`（楼栋级负荷异常标记 · 三级·敏感数据）、`dp-pwr-flood-weather`、`dp-pwr-fire-civic`、`dp-pwr-elder-care`；**新能源消纳预测**：`dp-pwr-res-forecast`、`dp-pwr-grid-constraint`、`dp-pwr-market-price`、`dp-pwr-weather-resource`；**车网供需协同**：`dp-pwr-grid-flex`、`dp-pwr-ev-credential`、`dp-pwr-agg-capacity`、`dp-pwr-charger-state` —— 共 **13** 个产品，且 `homeSpace` 均为 `hn-power`（不会出现在医疗空间） |
| 记录 | |
| 来源 | `industries/power/src/scenarios.ts`（`PowerScenario.products`）；`power-space.seed.ts#seedCatalog` |

## P-04 电力合约（交换的前置）

| 项 | 内容 |
|---|---|
| 前置 | P-03；两个不同机构的账号 |
| 步骤 | 1. 一个机构（consumer 侧）对某电力产品发起合约申请<br>2. 另一方（provider 侧）审批<br>3. 记下 **contractId** |
| 预期 | 合约状态 `active` 且 `coversInputs` 为真（交换准入要求合约 active **且** 覆盖输入）；双方为两个不同的 participantId |
| 记录 | contractId = |
| 来源 | `exchange.ts#admitExchange`（`contract.status !== "active" \|\| !contract.coversInputs` → `no-contract`）；`apps/api/src/runtime/digital-contract/` |

> 下面 P-05…P-12 的 `curl` 模板（`SPACE=hn-power`）：
> ```bash
> curl -s -o /tmp/x -w '%{http_code}\n' $API/spaces/hn-power/exchanges \
>   -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
>   -d '{"applicationId":"flood-warning","contractId":"<P-04 的 id>","operatorDigest":"<64位hex>"}'
> cat /tmp/x | jq .   # 看 rejection / mergePoint / contractId
> ```

## P-05 ★ 交换成功（城市用电异常监测 · 洪涝内涝预警）

| 项 | 内容 |
|---|---|
| 前置 | P-04 的 active 合约；调用方是该合约当事方且是 `urban-anomaly` 协作成员（如 `grid@hn-power.example`）；**一个该空间已登记的算子摘要** |
| 步骤 | 1. 取算子摘要：`select sm3 from cp_module_admission;`（或算法模块准入列表）<br>2. 用上表模板提交 `applicationId="flood-warning"` |
| 预期 | HTTP 201；响应 `rejection: null`、`mergePoint: "tee"`（该应用缺省合并点）、`contractId` 等于 P-04；库里 `cp_exchange_attempt` 新增一条**无 rejection** 的记录。<br>**⛔ 当前不可达**（电力包未登记算子摘要）——见文首执行记录 ③ |
| 记录 | attempt id = |
| 来源 | `exchange.ts`（`POWER_APPLICATIONS.flood-warning.defaultMerge = tee`）、`MERGE_TEE="tee"`；`exchange-attempt.service.ts#registeredDigests`（摘要来自该空间启用包的算子声明 / 算法注册表） |

## P-06 拒绝 1：非空间成员 → `not-space-member`

| 项 | 内容 |
|---|---|
| 步骤 | 用一个**不在** `hn-power` 成员里的账号（如医疗空间的 `pv@demo-pharma.example`）提交同一条交换 |
| 预期 | **HTTP 403**（`SpaceAccessGuard`：非该空间成员，服务层根本没被调用）。<br>**实测（2026-10-13）**：医疗侧有效 token 打 `hn-power` → `403`。服务层的 `not-space-member` 是第二道防线，**无法从该端点触发** |
| 记录 | |
| 来源 | `exchange-attempt.service.ts#attempt`（成员表按 `spaceId + status=active` 查，机构成员与用户成员分开认） |

## P-07 拒绝 2：无合约 / 合约未覆盖 → `no-contract`（含 400 对照）

| 项 | 内容 |
|---|---|
| 步骤 | 1）`contractId` 传一个不存在或非 active 的 id<br>2）`contractId` 传 active 但**不覆盖该应用输入**的合约<br>3）三个字段任一缺失（如去掉 `applicationId`） |
| 预期 | ①② **201** 且 `rejection: "no-contract"`；③ **400** 且消息为「缺少应用」（或「缺少合约」/「缺少空间 id」）。<br>**实测（2026-10-13）**：① `201 {"rejection":"no-contract","mergePoint":null,"spaceId":"hn-power","contractId":null}` ✅；③ `400 {"message":"缺少应用"}` ✅ |
| 记录 | |
| 来源 | 同上传入校验（`BadRequestException`）；`admitExchange` 的 `!contract \|\| status!=="active" \|\| !coversInputs` |

## P-08 拒绝 3：非合约当事方 → `not-contract-party`

| 项 | 内容 |
|---|---|
| 步骤 | 用**是空间成员、也在协作里，但不是该合约当事方**的机构账号提交该合约的交换 |
| 预期 | 201 且 `rejection: "not-contract-party"`。<br>**实测（2026-10-13）通过**：C1（`dp-pwr-grid-asset`，grid→civic，id `e9fedfc2…`），weather 调用 → `201 {"rejection":"not-contract-party","contractId":"e9fedfc2…"}` |
| 记录 | |
| 来源 | `attempt`（`caller.subjectId !== contract.consumerId && !== contract.providerId`） |

## P-09 拒绝 4：非协作成员 → `not-collaboration-member`

| 项 | 内容 |
|---|---|
| 步骤 | ① 先签一份**覆盖该应用所属场景**的合约，但消费方**不在该场景的协作里**（例：`dp-pwr-ami-load` 属 urban-anomaly，签给 `p-market-hn`（只参与 renewable-absorption））；② 用该消费方账号提交 `flood-warning` |
| 预期 | 201 且 `rejection: "not-collaboration-member"`。<br>**实测（2026-10-13）通过**：C3（`dp-pwr-ami-load`，grid→market，id `14f27e20…`）→ `201 {"rejection":"not-collaboration-member"}` |
| 注意 | **别用"有合约但产品不属该场景"来测**：那样会先落 `no-contract`（`cover()` 要求合约产品属于该应用所属场景的产品集）——我第一版就是这么写错的 |
| 记录 | |
| 来源 | `attempt#inScenarioCollaboration`（协作按应用所属场景） |

## P-10 拒绝 5：算子摘要缺失 / 未登记

| 项 | 内容 |
|---|---|
| 步骤 | 1）不传 `operatorDigest`（或传 `"n/a"` / 短于 64 位）<br>2）传一个**格式正确（64 位 hex）但未被该空间登记**的摘要 |
| 预期 | ① `rejection: "operator-digest-missing"`；② `rejection: "operator-digest-unregistered"`。<br>**实测（2026-10-13）两条都通过**（C1 + civic）：不传摘要 → `operator-digest-missing`；传 64 位 hex → `operator-digest-unregistered`。<br>**注意检查顺序**：合约校验在摘要之前，所以没有有效合约时两条都会先得到 `no-contract`（实测）。<br>**且当前构建下 ② 恒成立**（电力空间无已登记摘要）→ 即使有合约也拿不到成功 |
| 记录 | |
| 来源 | `exchange.ts#reproducibleDigest`（`^[0-9a-f]{64}$`，占位值 `n/a/placeholder/pending/todo` 一律拒）与 `admitExchange` 的 registered 集合判定 |

## P-11 拒绝 6：禁止输出字段 → `forbidden-output`

| 项 | 内容 |
|---|---|
| 步骤 | 在成功用例（P-05）基础上，加 `"outputFields":["meter-series"]`；再试 `household-curve` / `registry-detail` / `household-registry` |
| 预期 | 四个都 **201** 且 `rejection: "forbidden-output"`（户表曲线与户籍明细不得离开计算位置）。<br>**⛔ 当前不可达**：`admitExchange` 里摘要校验在禁止输出**之前** —— 实测「C1 + 合法 64 位 digest + `outputFields:["meter-series"]`」返回的仍是 `operator-digest-unregistered`。要测它必须先登记算子摘要 |
| 记录 | |
| 来源 | `industries/power/src/seams.ts#FORBIDDEN_OUTPUT_FIELDS` |

## P-12 ★ 合并点改写与 `plant-flexibility`（合约明文条款的作用）

| 项 | 内容 |
|---|---|
| 前置 | 能改合约的 `plaintextInputs`（逐项允许的明文输入） |
| 步骤 | 1）`curtailment`（弃风弃光风险预警）+ 合约明文含 `section-margin, net-load, agc` → 看 mergePoint<br>2）`ancillary`（辅助服务市场决策）+ 明文含 `price, reserve-demand` → 看 mergePoint<br>3）任一应用 + 明文里出现 `plant-flexibility` → 看结果 |
| 预期 | ① `mergePoint: "holder-connector"`（缺省是 `tee`，三项齐全才改写）；② 同样 `holder-connector`（缺省 `tee`）；③ `rejection: "plant-flexibility-forbidden"`——**场站调节能力不得进入明文列表、也不得离开场站**。<br>**⛔ 当前不可达**：`resolveMergePoint` 在摘要校验**之后**，同 P-11；要测必须先登记算子摘要 |
| 记录 | |
| 来源 | `exchange.ts#resolveMergePoint`（`CURTAILMENT_REQUIRED` / `ANCILLARY_REQUIRED` / `FORBIDDEN_PLAINTEXT_INPUT` / `MERGE_HOLDER`） |

## P-13 记录与审计（不存曲线）

| 项 | 内容 |
|---|---|
| 步骤 | 1. 跑完 P-05…P-12 后，查 `cp_exchange_attempt`<br>2. 看电力空间下的审计/存证页 |
| 预期 | 每条尝试一行，字段仅 `spaceId / contractId / mergePoint / outputHash / rejection / createdAt`——**不存曲线、凭证或明细**；拒绝原因可被审计追溯。<br>**实测（2026-10-13）通过**：`.schema cp_exchange_attempt` 只有 `id/contractId/mergePoint/outputHash/rejection/createdAt/space_id`；按 rejection 分组得 `no-contract×4 · operator-digest-unregistered×2 · operator-digest-missing×1 · not-contract-party×1 · not-collaboration-member×1`，全部可追溯 |
| 记录 | |
| 来源 | `packages/database/src/control-plane/index.ts#ExchangeAttemptEntity`（注释原文「不存放曲线、凭证或明细」） |

## P-14 负例：电力包未授权时

| 项 | 内容 |
|---|---|
| 前置 | 记录当前 `SPACE_PACKS` |
| 步骤 | 1. 把 `SPACE_PACKS` 改回 `med`，重启<br>2. 再发一次 P-05 的交换<br>3. 恢复 `med,power` 并重启 |
| 预期 | ① 日志「电力包不在部署白名单内，不创建电力空间」；② 交换请求 **403**（非成员被 `SpaceAccessGuard` 挡下；与 P-06 同表现）；③ 恢复后仍能通过 P-05。<br>**未执行**：本机库已写入 `hn-power` 空间，复现需干净库 |
| 记录 | |
| 来源 | `power-space.seed.ts`（白名单判定）、`space-pack-registry.service.ts#allowedPacks` |
