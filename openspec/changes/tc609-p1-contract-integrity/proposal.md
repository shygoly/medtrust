# P1-7 合约完整性校验 API

## Why
GET /contracts/:id/integrity 重算 canonical SM3 与存储哈希+链上回执三方比对;web 出示。

## What Changes
ContractService.verifyIntegrity;ContractController 端点;web 合约页展示。

## Impact
- 受影响的 specs: 按 ARCHITECTURE §7.1 登记。
- 风险: 见整改计划 §5。
