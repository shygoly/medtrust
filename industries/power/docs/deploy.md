<!-- SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0 -->
<!-- SPDX-FileCopyrightText: MedTrust contributors -->

# 电力包部署说明

## 环境要求

- Node 20（仓库 `.node-version`）
- pnpm workspace：`industries/*` 已包含本包

## 安装

```bash
pnpm install
pnpm --filter @medtrust/domain-power build
```

API / 连接器依赖：

```json
"@medtrust/domain-power": "workspace:*"
```

## 配置

- API `app.module.ts`：`registerPowerTemplates` / `registerPowerCollectors`
- Connector `app.module.ts`：`registerPowerSandboxes` + `PowerOperatorWiring`
- 节点侧 wasm 训练后端未接入前，使用 `MockPowerRunner` 纯 TS 占位
