<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# @medtrust/domain-power 0.1.0 Release Notes

**日期**：2026-10-15  
**变更**：`openspec/changes/power-operator-pack`

## Highlights

- 三个 MDOP 场景可跑：负荷预测、需求响应、窃电检测
- 时序标准格式 + 隐私闸（场景 ε 预算 / k≥5 / minCell）
- API 模板/收集器注册 + 连接器沙箱与 `MockPowerRunner`
- 编排台账新增 `power.load-forecast` / `power.demand-response` / `power.theft-detection`

## Known limits

- 预测为季节朴素基线（LSTM/Transformer 训练后端未接）
- 节点算子 wasm 为纯 TS 占位
- 正式 `v1.0.0` 与三方签署见 tasks §12.6 / §12.8

## Verify

```bash
pnpm --filter @medtrust/domain-power test
pnpm --filter @medtrust/domain-power build
```
