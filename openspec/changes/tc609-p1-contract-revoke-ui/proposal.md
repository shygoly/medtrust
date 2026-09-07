# P1-3 合约解除前端入口

## Why
web 合约列表/详情加 revoke 按钮(provider+二次确认+原因);PEP 已强制。

## What Changes
web contracts 页增加解除按钮调用 POST /contracts/:id/revoke。

## Impact
- 受影响的 specs: 按 ARCHITECTURE §7.1 登记。
- 风险: 见整改计划 §5。
