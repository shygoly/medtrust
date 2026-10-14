## 1. SPI 缝隙

- [x] 1.1（2026-10-14）`packages/space-kernel-spi/src/seams.ts`：新增 `AggregationCollector<I,O>`（`analysisType` + `merge`）与 `AggregationCollectorRegistry`（`register`/`resolve`）；`OperatorPack` 增**可选** `declareCollectors?(ctx)`。**不新开缝**（六根 S1–S6 是机检事实）。
- [x] 1.2（2026-10-14 结论：无需改）契约文档核对：KERNEL.md 的 S2 行只列接口名 `OperatorPack`（未变）、`check-pack.mjs` 不枚举成员、PACK.md 未列成员 → 本步无文档改动；SPI 自身零行业词（目标布局 268 处不变）。
- [x] 1.3（2026-10-14）`pnpm --filter @medtrust/space-kernel-spi build` 通过。

## 2. 基座：注册表 + 改解析

- [ ] 2.1 `apps/api/src/mdop/operators/collector-registry.ts`：域中立 Map + `registerCollector` / `resolveCollector`；未知类型抛错（含已注册清单）。
- [ ] 2.2 `mdop-merge.service`：删除 `collect-paired-cohort` / `collect-vaccine-scri` 的静态 import 与 `analysisType` 三元，改经 `resolveCollector`；行为与错误语义写注释。
- [ ] 2.3 基座侧单测：注册/解析 + 未知类型 fail-closed。

## 3. 行业包：搬实现 + 导出注册

- [ ] 3.1 `collect-paired-cohort.ts` / `collect-vaccine-scri.ts` 搬进 `industries/med/src/collectors/`（同函数体；内部零依赖，逐字节搬运）。
- [ ] 3.2 `industries/med/src/index.ts` 导出 `registerMedCollectors(registry)`（把两个收集器按 `analysisType` 注册）。
- [ ] 3.3 包构建通过；`medOperators.declareOperators()` 保持空集（本期不动 wasm 登记）。

## 4. 组装根与依赖

- [ ] 4.1 `apps/api/package.json`：加 `@medtrust/domain-med`（workspace）；`pretest`/构建顺序照既有包模式。
- [ ] 4.2 `apps/api/src/app.module.ts`（非基座）：注册 `registerMedCollectors`。
- [ ] 4.3 基座 spec 的装配：需要的用例显式注册（jest setup 或逐 spec）。

## 5. 验收（双闸）

- [ ] 5.1 等价性：`pnpm --filter api test -- src/mdop` 全绿（含 `mdop-collect-paired`、`c2-multi-node-e2e`、`l4-fl-node-e2e`）。
- [ ] 5.2 未知类型 fail-closed 用例（合并收到未注册类型 MUST 抛错、MUST NOT 产出结果）。
- [ ] 5.3 棘轮：重新生成 `scripts/kernel-purity-baseline.json`，计数 **246 → ≤213**；`pnpm test` 链通过。

## 6. 治理同步

- [ ] 6.1 `docs/tech-debt.md` TD-12：更新计数与「第一刀已落地」，并把下一刀（connector sandbox / plan-templates）写明。
- [ ] 6.2 证据：记录搬移前后同一夹具输出相等（放 `evidence/`）。
