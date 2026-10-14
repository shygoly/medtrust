## ADDED Requirements

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
