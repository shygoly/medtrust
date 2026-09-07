# P1-5 审计日志链式哈希

## Why
AuditLog 加 entryHash/prevHash(SM3);写入时链式计算;提供完整性校验端点;连接器侧已同构。

## What Changes
AuditLog 实体加字段;AuditService 链式哈希+GET /audit/integrity。

## Impact
- 受影响的 specs: 按 ARCHITECTURE §7.1 登记。
- 风险: 见整改计划 §5。
