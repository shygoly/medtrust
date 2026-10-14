# 状态：**已作废**（历史草案，不作为变更实施）

> 记于 2026-10-14。本目录不是合规的 OpenSpec 变更（只有 `SPEC.md`，没有 `.openspec.yaml` / `proposal.md` / `tasks.md`）。

## 为什么作废

草案的前提是 **`medtrust-lite`（mock demo 栈）当前在线**，而该栈**已下线** —— 见
[ARCHITECTURE.md](../../../ARCHITECTURE.md) §6：「`medtrust-lite` 及 `medtrust-lite-*`（mock demo 栈）已下线，
不在 fly app 列表中」。在线的是 real services 栈。

## 由什么取代

- 认证与权限：`apps/api/src/auth/`（现有形态）+ 联邦路径的 `runtime/participant-identity/`（SM2 CA / 双认证 /
  权利与分级准入）与 `runtime/digital-contract/`（由连接器 PEP 强制执行的合约授权）。
- 多租户/机构级隔离：本仓的联邦模型是「数据不出域 + 合约授权」，不是 lite 的单库多租户行级隔离。

## 处理方式

保留作历史记录（不删）；**不要**按此草案实施。若将来要做权限收口，请按 spec-first 新建变更。
