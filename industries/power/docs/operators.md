<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 电力算子说明

六个算子的**实际形态**（与 `src/manifest.ts` 的 `POWER_OPERATORS` 同源）：

| 算子 | kind | 跑在哪 | 输入 | 输出 | 参数 |
|------|------|--------|------|------|------|
| `power.feature-extraction@1.0.0` | wasm | 节点（连接器） | 电力时序表 C0 | 逐表计特征表 C0 | `features` / `period` / `utcOffsetHours` |
| `power.dr-potential@1.0.0` | wasm | 节点（连接器） | 电力时序表 C0 | 逐表计潜力表 C0 | `userType` / `comfort` / `utcOffsetHours` |
| `power.anomaly-detection@1.0.0` | wasm | 节点（连接器） | 电力时序表 C0 | 异常评分表 C0 | `anomalyThreshold` / `peerMeanKw` / `utcOffsetHours` |
| `power.load-forecast-merge@1.0.0` | system（merge） | 平台 | 各节点聚合特征 | 合并特征 + 预测曲线 + 置信区间 | `spec` |
| `power.dr-optimize@1.0.0` | system（merge） | 平台 | 各节点潜力 | 调节方案 + 激励分配 | `spec` |
| `power.theft-merge@1.0.0` | system（merge） | 平台 | 各节点疑似列表 | Top-K + 窃电率 | `spec` |

三个 wasm 算子走**已登记模块 + 零能力沙箱**（`registerWasmOperator` 前缀分派 → `runFixedCompute`），
模块摘要取自 `packages/wasm-algorithms/build/manifest.json`；宿主只做分组 / 逐小时整理 / 定标，
表计标识不进模块（异常检测的随机种子取**键控假名**）。未接入即 fail-closed——**没有 Mock/纯 TS 兜底**。

节点与平台之间的两个链环不是"算子"，是基座机制：

- `source.dataset@1.0.0`：D-CN-8 的链式认领，电力环只认领 `power.interval-meter@1` 的 `series-file` 产品，时序不进共享 LocalStore；
- `declassify.small_cell@1.0.0`：出域闸（minCell / k / 键控假名 / 证据日级泛化 / 可选 Laplace DP）。

纯函数入口均在 `@medtrust/domain-power` 的 `analysis/` 与 `privacy/`。
平台三个 merge 算子由电力包在组装根注册（`registerPowerPlatformOperators`），**不内置**在基座 `SYSTEM_OPERATORS`。
