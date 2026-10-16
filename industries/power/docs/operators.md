<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 电力算子说明

| 算子 | 类型 | 输入 | 输出 | 参数 |
|------|------|------|------|------|
| `power.feature-extraction@1.0.0` | system（纯 TS 沙箱） | 时序表 | PowerFeatures | features / window |
| `power.load-forecast-merge@1.0.0` | system | 多方特征 | 合并特征+预测统计 | spec |
| `power.dr-potential@1.0.0` | wasm* | 历史负荷 | 潜力三元组 | userType / comfort |
| `power.dr-optimize@1.0.0` | system | 多方潜力 | 调节方案 | targetLoad / budget / window |
| `power.anomaly-detection@1.0.0` | wasm* | 用电序列 | 异常评分 | threshold / peerMean |
| `power.theft-merge@1.0.0` | system | 区域结果 | Top-K + theftRate | threshold / topK / strategy |

\* 当前连接器以纯 TS `StageSandbox` / `MockPowerRunner` 承接，待 wasm 运行时替换。

纯函数入口均在 `@medtrust/domain-power` 的 `analysis/` 与 `privacy/`。
