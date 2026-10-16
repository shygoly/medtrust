<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 电力时序数据标准格式

## PowerTimeSeriesRecord

| 字段 | 类型 | 说明 |
|------|------|------|
| timestamp | string (ISO 8601) | 采样时刻 |
| entityId | string | 用户/站点标识（可脱敏） |
| activePower | number? | 有功功率 kW |
| reactivePower | number? | 无功 kVar |
| voltage | number? | 电压 V |
| current | number? | 电流 A |

类型守卫：`isPowerTimeSeriesRecord`。质量检查见 `checkDataQuality`；CSV/JSON 转换见 `data-conversion`；重采样见 `resampling`。

## PowerFeatures

窗口内聚合特征：`mean/std/max/min`、`hourOfDay/dayOfWeek/isWeekend`、`trend/seasonality`、`nSamples`。
