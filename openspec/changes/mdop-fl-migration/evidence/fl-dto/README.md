# 证据：L4 共享 DTO 的处置（FL tasks 7.2，2026-10-14）

## 1. 做了什么

| 层 | 变化 |
|---|---|
| 行业包 | `industries/med/src/fl/fl-prediction-task-spec.ts`：规格类型 + 全部校验器（411 行逐字下移）；另新增**合并专用**视图 `FlMergeSpecView` 与谓词 `isFlMergeSpecView` |
| 应用（非基座） | `apps/api/src/compute-task/dto/fl-prediction-task-spec.ts` 改为再导出；`fl-run-result.ts` 的 `mergeFlPartyResults` 收**不透明值**并用合并专用谓词收窄 |
| 基座 | `mdop/operators/merge-fedavg.ts`、`mdop/mdop-merge.service.ts`：**不再** import 规格类型，只透传（`spec: unknown`） |

## 2. 关键判据

- **零断言**：合并边界用**类型谓词**收窄，没有 `as`；新增行里无任何类型断言。
- **不过严**：合并用的是**合并专用**最小视图（只校验它会读的字段），准入契约 `isFlPredictionTaskSpec` 仍留在作业受理处。
  这一条是被测试逼出来的：最初直接用准入校验器，结果一个只关心输出白名单的旧用例（单参与方、部分 outputPolicy）被误拒 ——
  说明「准入」与「合并」是两个不同边界。
- **校验替代信任**：合并以前信任规格的类型标注；现在真的校验并 fail-closed（可见证据：上述旧用例被拒后改为完整策略）。

## 3. 验收

- **api 全量：140 套件 / 1064 用例通过**；api 构建 exit 0。
- `check-kernel-purity`：`importViolations = 0`；棘轮**不变**（本项是**结构收益**，非纯度收益 —— 该 DTO 本就不在基座目录）。
- 基座内已无 `FlPredictionTaskSpec` 引用（grep 为空）。
