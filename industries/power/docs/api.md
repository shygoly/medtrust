<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 电力包 API 接入

## 计划提交

通过 MDOP 计划模板入口提交（API 已在组装根调用 `registerPowerTemplates`）：

| 模板 id | 说明 |
|---------|------|
| `power.load-forecast` | 负荷预测 |
| `power.demand-response` | 需求响应 |
| `power.theft-detection` | 窃电检测 |

台账 key 与模板 id 相同，通道均为 `mdop`（见 `orchestration.migration.json`）。

## 作业查询 / 结果

走现有 MDOP jobs 接口：提交逻辑计划 → 节点执行沙箱阶段 → 平台 merge 算子 / 收集器聚合。收集器 `analysisType`：

- `power.load-forecast`
- `theft-detection`

## 算子清单

见 `POWER_OPERATORS`（`src/manifest.ts`）与平台 `SYSTEM_OPERATORS` 中的三个 power merge 算子。
