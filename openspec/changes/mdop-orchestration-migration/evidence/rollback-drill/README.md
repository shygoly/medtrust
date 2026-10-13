# 回滚演练（闸门⑤）

日期：2026-10-13 · 台账条目 `rws.disproportionality`（channel=mdop，cutoverAt=2026-10-13）

## 机制层演练结论（可执行，随 `pnpm test` 回归）

切换后回滚**仍然可行**，且回滚是**显式、可审计、生产禁用**的：

| 断言 | 结果 |
|---|---|
| 设 `ORCHESTRATION_FORCE_CHANNEL=rws.disproportionality=legacy` → 旧入口重新放行 | ✅ `{ enforced: true, channel: "legacy" }` |
| 去掉开关 → 旧入口立刻恢复拒绝 | ✅ 抛 `E_CHANNEL_MDOP` |
| `NODE_ENV=production` 下该开关被忽略 | ✅ 仍抛 `E_CHANNEL_MDOP`（不会变成长期旁路） |
| 演练不写台账（legacy 仍只减不增） | ✅ 台账文件未被改动 |

执行的是 `apps/api/src/runtime/orchestration/orchestration.channels.spec.ts` 里的两条用例。

> 为什么不用「把 `channel` 切回 legacy」来演练：那会撞守护 O2（legacy 只减不增）。回滚必须绕开台账，
> 于是用非生产环境变量——它同样证明"旧通道还能跑"，但不改变事实源。

## 部署层演练（ali29，观测窗内执行一次并回填本档）

需要一份真实合约 + 在线的院端连接器：

1. 给 **api** 进程注入 `ORCHESTRATION_FORCE_CHANNEL=rws.disproportionality=legacy`（仅非生产；生产会忽略）；
2. 以旧通道提交一次 L1.5，确认**可执行并产出结果**（记录任务 id 与四格表）；
3. 去掉该环境变量，确认旧入口恢复 **409 `E_CHANNEL_MDOP`**；
4. 回填：执行时间、任务 id、结果摘要、409 证据。

## 本档未覆盖

- 部署层真实回滚（需真实合约与院端连接器在线）——由上述 4 步执行后回填。
- 回滚期间的完整性：窗口内两套表都不应留下半成品（规矩 1/2 由 O8 静态检查与 `assertNoLegacyWrite` 兜底）。
