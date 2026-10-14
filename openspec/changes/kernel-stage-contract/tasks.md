## 1. 协议核：阶段执行契约

- [ ] 1.1 `packages/mdop`：新增 `StageInput` / `StageOutput` / `StageHandler` / `StageExecutor`（中立形状，逐字取自连接器现定义）。
- [ ] 1.2 协议核构建通过；新增内容零行业词（目标布局计数不变）。

## 2. 连接器：改用协议核契约

- [ ] 2.1 `apps/connector/src/mdop/mdop-executor.ts` 改为从 `@medtrust/mdop` 引入并**再导出**（调用点不动）。
- [ ] 2.2 connector 构建 + 全量套件全绿（此时应**无新增 cast**）。

## 3. 记录类型下移

- [ ] 3.1 `InternalRecord` 移进 `industries/med`；连接器 `src/domain/types.ts` 改为再导出或改引用。
- [ ] 3.2 执行器契约中的上游产物用**中立**记录类型；基座 MUST NOT 出现医疗字段名（棘轮为硬判据）。

## 4. 验证：搬 `l15.ts`（零 cast 判据）

- [ ] 4.1 把 `apps/connector/src/mdop/operators/l15.ts` 搬进行业包（函数体逐字），更新 wire/spec 引用。
- [ ] 4.2 **零 cast**：搬移后的接线与测试不得为类型适配新增断言（评审逐条核）。
- [ ] 4.3 connector 全量 + api 全量全绿；棘轮**下降**。

## 5. 收尾与治理

- [ ] 5.1 评估并记录 `seal.ts` / `l4.ts` 的处置（各自单独评估，不强行搬）。
- [ ] 5.2 `docs/tech-debt.md` TD-12：更新计数与新边界；说明余项归本变更 / FL tasks 7.2。
