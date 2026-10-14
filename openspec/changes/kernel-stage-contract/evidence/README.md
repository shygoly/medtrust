# 证据：阶段执行契约上移 + 医疗记录下移（2026-10-14）

## 1. 落地

- **协议核** `packages/mdop/src/schema/stage-execution.ts`：`StageInput` / `StageOutput` / `SystemHandler` /
  `ChainSystemHandler` / `WasmRunner`（逐字取自连接器）+ 新增 `StageExecutor`（执行器形状）。
- **连接器**：`mdop-executor.ts` 改为从协议核引入并**再导出**；执行器类 `implements StageExecutor`（调用点不变）。
- **记录类型**：`AdverseEvent` + `InternalRecord` 下移到 `industries/med/src/records/`；
  `apps/connector/src/domain/types.ts` 改为 import + 再导出（既有调用点不变）。
- **接线搬运**：`l15.ts` 搬进 `industries/med/src/connector-operators/l15.ts`，**函数体逐字**，
  只把 Nest `Logger` 换成最小 `OperatorLogger`（wire 传真实 Logger，输出不变）。
- **顺带发现并修**：`wire-l15/4/seal.ts` 是**组装关注点**却住在基座目录（`mdop/operators/`）——
  搬 `l15` 后它 import 行业包会构成**依赖方向违规**。已移到 `apps/connector/src/wiring/`（组装根区域），
  `app.module.ts` 与一个 spec 同步改引用。

## 2. 关键判据：零新增断言

**`grep` 核对：本次搬移涉及的 wire / spec / 包内文件均未新增 `as` / `as unknown as`。**
原因是契约**同源**：`StageInput` 在协议核里只有一份（连接器再导出），`InternalRecord` 只有一份（行业包，连接器再导出），
两侧拿到的是**同一个类型**，因此双向传递都天然可赋值 —— 这正是上一轮结构镜像方案失败、本轮方案成立的差别。

## 3. 验收

- **connector 全量：136 套件 / 909 用例通过**；connector 与 api 构建通过。
- `check-kernel-purity`：`importViolations = 0`；棘轮基线 **118 → 103**；目标布局计数同步下降。
- `check-meta-docs`：搬移导致 3 处文档路径悬空（`DOMAIN.md` INV-MDOP-08、`FLOWS.md` FLOW-MDOP-01）——已按新位置更新，
  现 **0 error**（这正说明「路径也在契约里」）。

## 4. 仍留（有意）

- `seal.ts`（出域关键、约 500 行）：搬家会动封存路径，收益不抵风险；
- `l4.ts`：依赖 `domain/fl-prediction/*`（迁移台账 `retained: shared-runtime`），搬它会让包依赖应用实现；
- `rws` 算子/模板引用串：平台协议命名面（见 TD-12 结论）。
