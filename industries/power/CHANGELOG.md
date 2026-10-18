<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# Changelog

## 1.0.0 — 2026-10-15

### Added

- MDOP 三场景：负荷预测、需求响应、窃电检测（模板 / 分析 / 收集器 / 沙箱）
- 时序标准格式 `PowerTimeSeriesRecord` / `PowerFeatures` 与质量、转换、重采样工具
- 隐私模块：场景 ε 预算、Laplace DP、k-匿名、minCell 出域闸
- 连接器 `PowerOperatorWiring` + `MockPowerRunner`；API 模板/收集器注册与 `power.*` 编排通道
- 批次 6/7 加深：`registerPowerOperators` 挂 `MdopStageExecutor`；三收集器统一 `{ tables }` 合并口径（含 `power.demand-response`）
- 包级文档 `docs/*`、性能测试、验收与 release notes

### Notes / limits

- 预测为季节朴素基线；LSTM/Transformer 与节点 wasm 训练后端待接入（tasks DEFERRED）
- 节点三算子暂为 system + 纯 TS（与沙箱同口径）；wasm 包装推迟
- 三方签署（tasks 12.6）见 `openspec/changes/power-operator-pack/SIGN-OFF.md`

## 0.1.0 — 2026-10-15

初版实现批次（随后升为 1.0.0）。
