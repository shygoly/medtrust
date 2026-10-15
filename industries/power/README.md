<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# @medtrust/domain-power

电力行业包。当前包含两套场景，互不替代：

1. **河南电力可信数据空间**（已有）：城市用电异常监测、新能源消纳预测、车网供需协同。对应 `src/scenarios.ts`、`src/exchange.ts`，算子见 `powerPackManifest.provides.operators`（`urban-anomaly-fusion`、`renewable-curtailment-risk`、`v2g-flexibility`）。
2. **MDOP 标准场景**（本次骨架，S2 起逐步实现）：负荷预测、需求响应、窃电检测。算子清单见 `src/manifest.ts` 的 `POWER_OPERATORS`（6 个）。

## 目录结构

```
src/
├── index.ts               SPI 挂载入口（createPowerPackBundle / mountPowerPack）
├── manifest.ts            包声明与算子清单
├── seams.ts               SPI 六根缝的取值
├── scenarios.ts           河南电力空间场景目录
├── exchange.ts            河南电力空间交换准入
├── templates/             计划模板（任务组 3–5 补充）
├── sandboxes/             节点侧沙箱（任务组 3、5 补充）
├── collectors/            平台侧收集器（任务组 3、5 补充）
├── connector-operators/   连接器侧算子接线（任务组 6 补充）
└── analysis/              分析算子领域逻辑（任务组 2–5 补充）
```

当前 `templates/`、`sandboxes/`、`collectors/`、`connector-operators/`、`analysis/` 仅为空导出占位，尚未接管主线行为（D-SPD-6）。

### 负荷预测场景（MDOP 标准，批次 2）

- 预测模型：当前为确定性基线模型（`analysis/load-forecast-model.ts`，`model: "baseline"`）。LSTM 支持将在接入训练后端后补充，与模板入参 `model: "lstm"` 的差异是初期实现的预期行为。
- `power.feature-extraction` 为 `system` 类算子（纯 TS），沙箱（任务 3.2）标记为 `[DEFERRED]`，待 wasm 运行时方案确定后补充。
- Transformer 预测模型（任务 3.3.3）为可选项，初期未实现。

## 开发

```bash
pnpm --filter @medtrust/domain-power build   # tsc，strict
pnpm --filter @medtrust/domain-power test    # jest（当前无用例，passWithNoTests）
```

依赖方向：包 → SPI（`@medtrust/space-kernel-spi`）与 MDOP（`@medtrust/mdop`）。包本身不反向依赖基座实现。

## 许可

`LicenseRef-MedTrust-Research-1.0`，与文件头一致。
