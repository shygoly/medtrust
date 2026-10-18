<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 电力包 API 接入

## 计划提交

三个模板由组装根 `registerPowerTemplates(kernelTemplateRegistry)` 登记（`apps/api/src/app.module.ts`），
经**通用的模板入口**编译成逻辑计划，而不是各场景一个专属路由：

```http
POST /api/v1/mdop/plans/preview
{ "template": "power.load-forecast", "input": { …模板入参… } }
```

| 模板 id | 说明 | 阶段链（每方 → 平台） |
|---------|------|------------------------|
| `power.load-forecast` | 负荷预测 | `source.dataset` → `power.feature-extraction` → `declassify.small_cell` → `power.load-forecast-merge` |
| `power.demand-response` | 需求响应 | `source.dataset` → `power.dr-potential` → `declassify.small_cell` → `power.dr-optimize` |
| `power.theft-detection` | 窃电检测 | `source.dataset` → `power.anomaly-detection` → `declassify.small_cell` → `power.theft-merge` |

台账 key 与模板 id 相同，通道均为 `mdop`（见 `orchestration.migration.json`）。

## 作业提交 / 查询 / 结果

用通用作业入口提交编译好的计划（`analysisKey` 归属台账通道）：

```http
POST /api/v1/mdop/jobs          { "analysisKey": "power.load-forecast", …计划… }
POST /api/v1/mdop/jobs/:id/compile
GET  /api/v1/mdop/jobs/:id
```

编译期会校验合约资格：**无持有方签名 → `E_CONTRACT_UNSIGNED`**（`mdopStatus` 必须是 `active`
且 `holderSignature` 非空）、过期 → `E_CONTRACT_EXPIRED`、用途不符 → `E_PURPOSE_MISMATCH`。
所以"能提交"的前提是电力空间里有一份**已签署**的合约。

平台侧按 `analysisType` 分派合并，实际注册的三个值是：

- `power.load-forecast`
- `power.demand-response`
- `power.theft-detection`

## 算子清单

见 `POWER_OPERATORS`（`src/manifest.ts`，六个算子）与 `POWER_PLATFORM_OPERATORS`
（`src/platform-operators.ts`，三个 system/merge）。

平台三个 merge 算子由**电力包在组装根注册**（`registerPowerPlatformOperators(kernelPlatformOperatorRegistry)`），
**不在基座 `SYSTEM_OPERATORS` 里**——基座不认识行业算子（D-MDOP-5 / 纯度棘轮）。
节点侧三个 wasm 算子则在连接器启动时由 wasm 构建清单自动登记为 `kind: wasm`。
