# node-execution Specification

## Purpose
TBD - created by archiving change pack-med-sandboxes. Update Purpose after archive.
## Requirements
### Requirement: 节点侧 wasm 阶段经注册表分派且未知类型 fail-closed

节点执行器 MUST 经沙箱注册表按 `analysisType` 解析实现，MUST NOT 内置按分析类型的分支表；
解析不到 MUST 以明确错误 fail-closed，MUST NOT 回退到内置实现、MUST NOT 静默跳过阶段。

#### Scenario: 未注册的分析类型

- **WHEN** 阶段声明的分析类型在注册表里没有实现
- **THEN** 该阶段 MUST 以明确错误失败（错误里含类型名与已注册清单）

#### Scenario: 搬移后阶段输出变化

- **WHEN** 搬移前后同一夹具的阶段输出出现任何字段差异
- **THEN** 变更 MUST 被视为回归并阻断

### Requirement: 阶段执行契约由协议核提供，两侧共用而非各自镜像

阶段执行契约（`StageInput` / `StageOutput` / handler / 执行器接口）MUST 由 `@medtrust/mdop` 提供；
应用侧与行业包 MUST 共用**同一份**定义，MUST NOT 各自维护结构镜像。
接线代码 MUST NOT 为类型适配新增断言（`as` / `as unknown as`）：出现即说明契约没有真正同源。

#### Scenario: 为类型适配新增断言

- **WHEN** 搬移行业接线时为了让两侧类型对上而新增 `as` / `as unknown as`
- **THEN** 评审 MUST 拒绝；应先让契约同源，再搬

#### Scenario: 两侧各自定义同名类型

- **WHEN** 应用侧与行业包各有一份 `StageInput`（或记录类型）的定义
- **THEN** MUST 收敛为协议核/行业包单一来源（镜像类型 MUST 删除）

