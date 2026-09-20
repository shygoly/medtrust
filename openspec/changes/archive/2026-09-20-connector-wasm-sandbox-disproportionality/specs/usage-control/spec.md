## MODIFIED Requirements

### Requirement: 策略执行点(PEP)强制校验
连接器 SHALL 在每次计算任务执行前由策略执行点校验该任务是否符合生效策略；不符合的任务 MUST 被拒绝执行。当生效合约为任务的分析类型固定了算法模块时，任务派发记录携带的模块 SM3 MUST 与合约固定值一致，否则 MUST 拒绝执行。

#### Scenario: 目的不符被拒
- **WHEN** 一个计算任务声明的目的与策略的目的限定不一致
- **THEN** 连接器 MUST 拒绝执行并记录审计

#### Scenario: 策略过期被拒
- **WHEN** 一个计算任务在策略有效期之外发起
- **THEN** 连接器 MUST 拒绝执行

#### Scenario: 固定模块不符被拒
- **WHEN** 合约为 `disproportionality` 固定了模块 SM3，而任务派发记录携带的模块 SM3 与之不同
- **THEN** 连接器 MUST 拒绝执行并记录 `pep-deny` 审计

#### Scenario: 合约固定了模块但任务未携带
- **WHEN** 合约为该分析类型固定了模块，而任务派发记录没有携带模块引用
- **THEN** 连接器 MUST 拒绝执行，MUST NOT 以内置实现代替
