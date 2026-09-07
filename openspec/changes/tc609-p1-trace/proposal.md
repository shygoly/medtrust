# P1-11 端到端审计追溯

## Why
GET /trace/:contractId 合约→申请→任务→执行事件→结果→链上回执 一站式时间线;web 追溯视图。

## What Changes
TraceService + 端点;web trace 视图。

## Impact
- 受影响的 specs: 按 ARCHITECTURE §7.1 登记。
- 风险: 见整改计划 §5。
