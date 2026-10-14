## 1. 协议核：阶段执行契约

- [x] 1.1（2026-10-14）`packages/mdop`：新增 `StageInput` / `StageOutput` / `StageHandler` / `StageExecutor`（中立形状，逐字取自连接器现定义）。
- [x] 1.2（2026-10-14：协议核构建通过，新增内容零行业词）协议核构建通过；新增内容零行业词（目标布局计数不变）。

## 2. 连接器：改用协议核契约

- [x] 2.1（2026-10-14）`apps/connector/src/mdop/mdop-executor.ts` 改为从 `@medtrust/mdop` 引入并**再导出**（调用点不动）。
- [x] 2.2（2026-10-14：connector 构建 + 全量 136 套件 / 909 用例通过，无新增断言）connector 构建 + 全量套件全绿（此时应**无新增 cast**）。

## 3. 记录类型下移

- [x] 3.1（2026-10-14：`AdverseEvent` + `InternalRecord` 下移，`domain/types.ts` 再导出）`InternalRecord` 移进 `industries/med`；连接器 `src/domain/types.ts` 改为再导出或改引用。
- [x] 3.2（2026-10-14：基座契约用中立记录类型；棘轮不增）执行器契约中的上游产物用**中立**记录类型；基座 MUST NOT 出现医疗字段名（棘轮为硬判据）。

## 4. 验证：搬 `l15.ts`（零 cast 判据）

- [x] 4.1（2026-10-14）把 `apps/connector/src/mdop/operators/l15.ts` 搬进行业包（函数体逐字），更新 wire/spec 引用。
- [x] 4.2（2026-10-14：**零新增断言**——契约同源后无需 cast，wire/spec 均未新增 `as`）**零 cast**：搬移后的接线与测试不得为类型适配新增断言（评审逐条核）。
- [x] 4.3（2026-10-14：connector 136/909；api 构建通过；棘轮 118 → 103）connector 全量 + api 全量全绿；棘轮**下降**。

## 5. 收尾与治理

- [x] 5.1（2026-10-14：`seal.ts` 出域关键、`l4.ts` 绑 `retained: shared-runtime` —— 均留在应用，理由记入 TD-12）评估并记录 `seal.ts` / `l4.ts` 的处置（各自单独评估，不强行搬）。
- [ ] 5.2 `docs/tech-debt.md` TD-12：更新计数与新边界；说明余项归本变更 / FL tasks 7.2。
