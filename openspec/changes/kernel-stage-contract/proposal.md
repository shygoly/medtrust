# 提案：阶段执行契约上移内核包、医疗记录类型下移行业包

## Why

TD-12 第五刀（连接器算子接线 `l15.ts` / `seal.ts` / `l4.ts`）在 2026-10-14 勘察后判定**不能靠结构镜像硬搬**：
这些文件需要应用侧的 `MdopStageExecutor` / `StageInput` / `InternalRecord`（医疗记录：`subjectKey`/`ageBand`/
`conditions`/`medications`/`adverseEvents`）。用结构镜像缝补会产生**双向断言**（应用→包、包→应用都要 cast），
第一次尝试时 wire 与 spec 立刻出现多处 cast，已回滚。

同一根因也卡住 FL 迁移的 tasks 7.2（`FlPredictionTaskSpec` 的处置）：基座合并路径要与行业包共用**同一份**
规格/记录契约，而不是各留一份镜像。

## What Changes

1. **协议核（`@medtrust/mdop`）**：上移**阶段执行契约** —— `StageInput` / `StageOutput` / 处理函数形状 /
   执行器接口（现散在 `apps/connector/src/mdop/mdop-executor.ts`）。这些形状**零领域语义**（作业号、阶段声明、
   上游产物、合约条款），符合协议核的定位。
2. **连接器**：`mdop-executor.ts` 改为**使用并再导出**协议核的契约（实现留在连接器，接口不再是本地定义）。
3. **行业包**：`InternalRecord`（医疗记录）下移到 `industries/med`；执行器契约里的上游产物用**中立**记录类型
   （`Record<string, unknown>`），包与基座因此不再需要镜像。
4. **收尾（本变更内）**：把 `l15.ts` 的算子接线搬进行业包（**零 cast**）作为验证；`seal.ts`（出域关键）与
   `l4.ts`（依赖 `domain/fl-prediction/*` 共享运行时）**另行评估**，不在本变更强制。

## 本期不做

- 不动 `rws` 算子/模板引用串（协议命名面，见 TD-12 结论）。
- 不搬 `domain/fl-prediction/*`（迁移台账 `retained: shared-runtime`）；本变更为其后续处置（FL tasks 7.2）
  提供中立契约，不代替它。

## Capabilities

- `node-execution`：阶段执行契约由协议核提供（应用与包共用同一契约，MUST NOT 各自镜像）。
- `kernel-spi`：领域记录类型 MUST 在行业包；基座契约 MUST 用中立记录类型。

## Impact

- **代码**：`packages/mdop`（契约）、`apps/connector/src/mdop/mdop-executor.ts`（改为再导出）、
  `apps/connector/src/domain/types.ts`（记录类型下移）、`industries/med`（接收记录类型）、`l15.ts` 搬运。
- **判据**：① 零 cast —— 搬移后的接线与测试**不得**为类型适配新增断言；② connector 全量 + api 全量全绿；
  ③ 棘轮**不增**，搬完 `l15` 后应下降；④ 无镜像类型残留（grep 无重复定义）。
- **风险**：契约上移会动到连接器执行器与所有 handler 的类型面 → 用「先再导出、后切换」的顺序，编译期即能发现遗漏。
