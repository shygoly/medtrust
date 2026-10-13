# 闸门②「旧表零写入」的机器证据

日期：2026-10-13 · 台账条目 `rws.disproportionality`（channel=mdop）

## 静态半边（机检，随 `pnpm test` 回归）

守护 `check:orchestration` 的 **O8（静态不双写）**：台账里 `channel=mdop` 且声明了旧表的条目，其 MDOP
实现目录（缺省 `apps/api/src/mdop`）不得引用这些旧表名（`cp_rws_task` / `cp_rws_assignment`）或旧持久化
`rws-persistence`。

**当前扫描结果：0 处引用。** 该目录只 import `@medtrust/database` 的 `CpConnectorRegistry` 与共享计算模块
（后者是台账 `retained[].reason=shared-runtime`，属于允许的共用，不是写旧表）。

负例自检（`scripts/check-orchestration.test.mjs`）：引用旧表 → 报红；引用 `rws-persistence` → 报红；
干净目录 → 绿；`.spec.ts` 不参与扫描（测试里出现旧表名不算违规）。

## 动态半边（待观测，观测窗内记一次）

真实 L1.5 作业经 MDOP 跑完后，确认旧表**无新增**：

- 记录切换当天（2026-10-13）与观察窗结束时 `cp_rws_task` / `cp_rws_assignment` 的行数（或最大主键）；
- 两者应**相等**（该类型切换后不应再产生旧通道记录）；
- 结果回填本档，随 `evidence/` 归档。

> 运行时兜底：`assertNoLegacyWrite(key, table)` 已提供（走 MDOP 的类型写旧表即抛）。它目前**未被调用**——
> 因为静态 O8 已覆盖同一类错误，且旧持久化的写入函数签名里拿不到分析类型。若将来在写入边界能拿到类型，
> 应当把它接上，形成"静态 + 运行时"双保险。
