<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 电力包部署说明

## 环境要求

- Node 20（仓库 `.node-version`）
- pnpm workspace：`industries/*` 已包含本包
- 电力空间需要**显式装配**：`SPACE_PACKS=med,power`（只写 `power` 就只有电力空间）。
  未列入白名单时启动日志会写「电力包不在部署白名单内，不创建电力空间」，模板/收集器仍会注册。

## 安装

```bash
pnpm install
pnpm --filter @medtrust/domain-power build
```

连接器侧的 wasm 模块产物（`packages/wasm-algorithms/build/power-*.wasm`）已随仓库纳管，
连接器按 `build/manifest.json` 的摘要启动时自动登记；**模块缺失或摘要不符即 fail-closed**。

API / 连接器依赖：

```json
"@medtrust/domain-power": "workspace:*"
```

## 配置

- API `app.module.ts`：`registerPowerTemplates` / `registerPowerCollectors` / `registerPowerPlatformOperators`
- Connector `app.module.ts`：`registerPowerSandboxes` + `PowerOperatorWiring`
- 环境变量：`CONNECTOR_POWER_PSEUDONYM_KEY`（≥ 32 字符，同联盟各节点配同一把）。
  **缺失时电力降密环直接拒绝出域**（启动不受影响）——假名与 DP 种子都从它派生。
