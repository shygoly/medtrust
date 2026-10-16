<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# @medtrust/domain-power 1.0.0 Release Notes

**日期**：2026-10-15  
**变更**：`openspec/changes/power-operator-pack`  
**包版本**：`1.0.0`（`private: true`，workspace 内发布）

## Highlights

- 三个 MDOP 场景可跑：`power.load-forecast` / `power.demand-response` / `power.theft-detection`
- 时序标准格式 + 隐私闸（ε 预算 / k≥5 / minCell）
- API：`registerPowerTemplates` / `registerPowerCollectors`；台账三通道
- 连接器：`registerPowerSandboxes` + `PowerOperatorWiring` + `MockPowerRunner`

## Verify

```bash
pnpm --filter @medtrust/domain-power build
pnpm --filter @medtrust/domain-power test
pnpm --filter @medtrust/domain-power test:perf
pnpm --filter @medtrust/domain-power test:coverage
```

## Sign-off

人工签署表：[`SIGN-OFF.md`](./SIGN-OFF.md)
