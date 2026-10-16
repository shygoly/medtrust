<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 电力算子包签署表（tasks 12.6）

**包**：`@medtrust/domain-power@1.0.0`  
**变更**：`openspec/changes/power-operator-pack`  
**关联验收**：[`ACCEPTANCE.md`](./ACCEPTANCE.md)

## 机器已验证证据（供签署人复核）

| 项 | 证据 |
|----|------|
| 单元/e2e | `pnpm --filter @medtrust/domain-power test` → 152 passed + test:perf 5 passed（2026-10-15） |
| 性能 | `pnpm --filter @medtrust/domain-power test:perf` → 5 passed（含 10k×90d 窃电 < 10min） |
| 覆盖率 | `test:coverage` → statements 89.5% / lines 91.9%（jest collectCoverageFrom 排除 scenarios.ts、exchange.ts、seams.ts，见 industries/power/package.json） |
| 编译 | `pnpm --filter @medtrust/domain-power build`（tsc strict） |
| API 集成 | `apps/api` `power-pack-integration.spec.ts` |
| 连接器 | `apps/connector` `wire-power.spec.ts` + `registerPowerSandboxes` |
| 文档 | `industries/power/docs/*` + README |

## 已知未闭合（签署前须知情）

- [ ] MAPE &lt; 5% / 窃电 Recall ≥ 80%：需业务标注集（ACCEPTANCE 仍为开放项）
- [ ] LSTM/Transformer 与 wasm 训练后端：DEFERRED
- [ ] 本表下方三方签署尚未填写

## 签署

| 角色 | 姓名 | 日期 | 签名 |
|------|------|------|------|
| 开发团队 | | | |
| 质量团队 | | | |
| 业务团队 | | | |

签署含义：确认已按 ACCEPTANCE §7 完成对应验收，同意以 `1.0.0` 作为电力算子包工作版本在 monorepo 内使用。
