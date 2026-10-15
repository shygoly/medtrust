# L2 比较效果：站点效应量与随机效应合并

## 站点统计

节点出域的效应量来自定点模块 `comparative-effect.wasm`
（SM3 `ed109fae62041ad6e9ee2cdead116d268731aa093e2de0741b5d9ee27b0856b7`）。
暴露、结局和分层仍由行业包匹配；模块只见 0/1 列。模块与 TS 参考
`siteEffectQ16` 逐字段相等（`packages/wasm-algorithms/scripts/site-effect-parity.test.mjs`）。

分层格子与浮点 `stratifiedContingencyTables` 逐字段一致。
Mantel–Haenszel 用同一份浮点函数在这些格子上重算。

legacy `comparativeEffectEstimate` 仍走浮点 logistic / Firth，包装的是行业包纯函数。
固定四格 8/12/4/16 上：

| | logOR | SE |
|---|---|---|
| 定点模块 | 0.980865478515625 | 0.7216796875 |
| 浮点 logistic | 0.9808292530117261 | 0.7216878364870318 |

连接器用例把两者的差锁在 0.001 以内（`comparative-effect.spec.ts`）。

封存投影 `comparative-effect` 去掉主体键与关联假名。

## 平台合并（三闸门）

`mergeComparativeEffects` 调用协议核 `derSimonianLaird`，与旧通道
`MetaAnalysisService` 同一份实现。两站夹具上 `pooledEffect`、`pooledSe`、`ci95`、
`heterogeneity.q`、`heterogeneity.i2Percent` 逐字段相等
（`apps/api/src/mdop/comparative-effect-plan.spec.ts`）。

单站返回 `merged: false, code: single_site`，不把单站结果写成合并结果。

## 通道

新建页对比较效果调用 `POST /mdop/jobs/comparative-effect`，提交后落到 `/space/mdop/jobs/<id>`。
台账 `channel=mdop`、`state=migrated`。未设 `cutoverAt`，所以迁移期旧入口仍会被放行并记一条警告。
旧浮点实现留在连接器包装里，删除受 O7 日期闸（任务 4.3）。
