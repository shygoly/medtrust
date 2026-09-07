# connector-audit-digest

连接器审计持久化 + SM3 链式哈希 + 摘要上报，平台可查验链完整性。

## ADDED Requirements

### Requirement: 审计持久化
连接器审计日志 SHALL 持久化到本地 `local_audit_log` 表（重启不丢），每条带 SM3 链式哈希（entryHash/prevHash）。

#### Scenario: 重启不丢
- **WHEN** 连接器重启后载入审计日志
- **THEN** 既有条目保留，且链尾 entryHash 被恢复（下一条 prevHash 接续）。

#### Scenario: 链式哈希
- **WHEN** 连续记录两条审计
- **THEN** 第二条的 prevHash 等于第一条的 entryHash。

### Requirement: 摘要上报与查验
连接器 SHALL 周期把本地审计链摘要上报平台，平台按链式 prevHash 对拍判断链条连续。

#### Scenario: 链条连续
- **WHEN** 平台收到的新摘要链头（firstPrevHash/首条阻断事件 prevHash）等于上次摘要链尾 lastEntryHash
- **THEN** 记录 chainOk=ok。

#### Scenario: 链条断裂
- **WHEN** 链头不等于上次链尾
- **THEN** 记录 chainOk=break，供操作方警觉。
