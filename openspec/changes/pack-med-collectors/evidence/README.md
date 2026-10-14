# 证据：医疗包接管平台侧聚合收集器（TD-12 第二刀，2026-10-14）

## 1. 等价性（搬移不改口径）

- **逐字节同体**：`industries/med/src/collectors/paired-cohort.ts` 与 `vaccine-scri.ts` 相对
  `git show HEAD:apps/api/src/mdop/operators/collect-*.ts` 仅多了 2 行 SPDX 头，其余**逐字节相同**（`diff -q` 通过）。
- **行为闸**：`pnpm --filter api test -- src/mdop` **30 套件 / 178 用例全部通过**（含 `mdop-collect-paired`、
  `c2-multi-node-e2e`、`vaccine-scri`、`l4-fl-node-e2e`）；`pnpm --filter api test` 全量 **139 套件 / 1059 用例通过**。
- 合并服务里**已无** `collect-paired-cohort` / `collect-vaccine-scri` 静态引用（grep 计数 0）。

## 2. 依赖方向（反转的正确性）

- `scanKernelPurity` 目标布局：**`importViolations = 0`**（没有出现「基座 import 行业包」）。
- 反转路径：基座 `apps/api/src/mdop/operators/collector-registry.ts`（域中立 Map + `resolve`/`resolveOrThrow`）
  ← 组装根 `apps/api/src/app.module.ts` 调 `registerMedCollectors(kernelCollectorRegistry)`；
  单测由 jest `setupFiles`（`apps/api/src/test/register-collectors.ts`）做同一注册。
  行业包只依赖 `@medtrust/space-kernel-spi`，不认识基座实现。

## 3. 棘轮（进度表）

| 口径 | 变更前 | 变更后 | 变化 |
|---|---|---|---|
| 棘轮基线（候选布局，`--ratchet`） | 246 | **205** | −41 |
| 目标布局越界（行业词） | 268 | **227** | −41 |
| 依赖方向违规 | 0 | **0** | 0 |

下降来自：两个收集器文件搬走（33 处）+ `mdop-merge.service` 里 `"vaccine-scri"`/`"paired-cohort"` 字面量与分派消失（8 处）。

## 4. 仍未做（下一刀）

- 连接器侧 4 个 sandbox（`tee-node/wasm-runner.ts` 引用，24 处）；
- `apps/api/src/mdop/plan-templates.ts`（49 处，医疗计划模板）与 `mdop.controller.ts`（16 处入口）；
- wasm 算子登记：`medOperators.declareOperators()` 仍返回空集（摘要 MUST 取自复现构建清单，未接线）。
