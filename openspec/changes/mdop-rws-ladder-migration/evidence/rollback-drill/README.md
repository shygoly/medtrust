# 任务 4.4 回滚演练

非生产环境下，`ORCHESTRATION_FORCE_CHANNEL=rws.disproportionality=legacy` 让旧入口重新放行。去掉该变量后，旧入口立刻回到拒绝。台账文件没有改：`rws.disproportionality` 仍是 `channel=mdop`。

用例：`apps/api/src/runtime/orchestration/orchestration.channels.spec.ts`「回滚演练（闸门⑤）：非生产开关让旧入口重新放行，台账本身不变」。2026-10-15 跑过，通过。

生产环境里同一变量被忽略，旧入口仍然拒绝。那一条用例在同一文件。
