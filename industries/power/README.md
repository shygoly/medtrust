<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# @medtrust/domain-power

电力行业包。两套场景并存、互不替代：

1. **河南电力可信数据空间**：城市用电异常监测、新能源消纳预测、车网供需协同（`scenarios.ts` / `exchange.ts`）。
2. **MDOP 标准场景**：负荷预测、需求响应、窃电检测（模板 / 沙箱 / 收集器 / analysis / privacy）。

## 快速开始

```bash
pnpm install
pnpm --filter @medtrust/domain-power build
pnpm --filter @medtrust/domain-power test
```

```ts
import {
  buildLoadForecastPlan,
  buildDemandResponsePlan,
  buildTheftDetectionPlan,
  enforcePowerEgress,
} from "@medtrust/domain-power";
```

## 目录结构

```
src/
├── index.ts               createPowerPackBundle / mountPowerPack
├── manifest.ts            包声明 + POWER_OPERATORS
├── seams.ts               SPI 六根缝
├── templates/             load-forecast / demand-response / theft-detection
├── sandboxes/             feature-extraction / anomaly-detection
├── collectors/            load-forecast / theft-detection
├── connector-operators/   节点算子 ref 声明
├── analysis/              领域纯函数
├── privacy/               DP / k-匿名 / minCell 出域闸
└── records/               时序标准格式与工具
docs/                      场景与算子文档
```

## 文档

| 文档 | 内容 |
|------|------|
| [docs/load-forecast.md](docs/load-forecast.md) | 负荷预测 |
| [docs/demand-response.md](docs/demand-response.md) | 需求响应 |
| [docs/theft-detection.md](docs/theft-detection.md) | 窃电检测 |
| [docs/time-series-format.md](docs/time-series-format.md) | 时序格式 |
| [docs/operators.md](docs/operators.md) | 算子 I/O |
| [docs/api.md](docs/api.md) | 计划/作业 API |
| [docs/deploy.md](docs/deploy.md) | 部署 |

## 场景摘要

- **负荷预测**：feature-extraction(wasm) → declassify → load-forecast-merge；模型 `baseline`（季节朴素）；数值聚合可选 DP ε&lt;1.0
- **需求响应**：dr-potential(wasm) → declassify → dr-optimize；峰谷容量可选 DP ε&lt;0.5
- **窃电检测**：anomaly-detection(wasm) → declassify → theft-merge；个体列表按**放行条数**过 minCell + 键控假名 + 分桶（此路径不再叠加 DP）

三个节点算子都是**真 wasm 模块**（`packages/wasm-algorithms/build/power-*.wasm`，已纳管），
经零能力沙箱执行，未接入即 fail-closed——**没有 MockPowerRunner / 纯 TS 兜底**。

`lstm` / `transformer` 训练后端尚未接入，模板会显式拒绝（不用基线冒充，见 tasks 中 `[DEFERRED]`）。

## 许可

`LicenseRef-MedTrust-Research-1.0`
