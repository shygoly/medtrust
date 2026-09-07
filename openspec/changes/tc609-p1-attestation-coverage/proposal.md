# P1-6 存证覆盖补全

## Why
L1 描述性任务合并结果补锚定;completeAssignment 收连接器回传时校验结果哈希。

## What Changes
RwsOrchestratorService 对 L1 锚定合并结果;连接器回传 aggregateHash;API 验哈希。

## Impact
- 受影响的 specs: 按 ARCHITECTURE §7.1 登记。
- 风险: 见整改计划 §5。
