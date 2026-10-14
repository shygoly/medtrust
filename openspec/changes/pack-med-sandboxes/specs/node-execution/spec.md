## ADDED Requirements

### Requirement: 节点侧 wasm 阶段经注册表分派且未知类型 fail-closed

节点执行器 MUST 经沙箱注册表按 `analysisType` 解析实现，MUST NOT 内置按分析类型的分支表；
解析不到 MUST 以明确错误 fail-closed，MUST NOT 回退到内置实现、MUST NOT 静默跳过阶段。

#### Scenario: 未注册的分析类型

- **WHEN** 阶段声明的分析类型在注册表里没有实现
- **THEN** 该阶段 MUST 以明确错误失败（错误里含类型名与已注册清单）

#### Scenario: 搬移后阶段输出变化

- **WHEN** 搬移前后同一夹具的阶段输出出现任何字段差异
- **THEN** 变更 MUST 被视为回归并阻断
