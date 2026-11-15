# Spec Delta

## ADDED Requirements

### Requirement: 平台聚合连接器状态快照

平台 SHALL 以连接器心跳为唯一输入维护聚合视图，并对外提供同一份快照供上报与系统状态页消费：
每项 MUST 含 `connectorId`、`participantId`、`status`、`lastSeenAt`、`version`（若有）与 `load`（若有）；
配置机构码时 MUST 附 `ndiId`，未配置时 MUST 省略而不是伪造。

#### Scenario: 心跳字段进入快照
- **WHEN** 连接器最近一次心跳带 `connectorId`、版本与资源水位
- **THEN** 聚合快照 MUST 使用心跳自报的 `connectorId`，并原样带出版本与 `load`

#### Scenario: 未报 connectorId 时仍可对账
- **WHEN** 连接器心跳尚未携带 `connectorId`
- **THEN** 快照 MUST 回退 `participantId` 作为 `connectorId`，MUST NOT 输出空值

#### Scenario: 离线判定
- **WHEN** 某连接器超过 3 个心跳周期未上报
- **THEN** 其 `status` MUST 为 `offline`，且 `lastSeenAt` MUST 反映最后一次心跳时间（从未上报为 null）

### Requirement: 上报载荷含平台与空间标识

上报载荷 SHALL 包含平台自身状态、连接器聚合快照与空间标识。
空间标识在配置机构码时 MUST 使用 NDI 编码（draft 版本按业务节点映射），未配置时 MUST 只给内部 `spaceId`。

#### Scenario: 配置机构码
- **WHEN** `NDI_ORG_CODE` 已配置
- **THEN** 载荷 MUST 含 `space.ndiId` 与每个连接器的 `ndiId`

#### Scenario: 未配置机构码
- **WHEN** `NDI_ORG_CODE` 为空
- **THEN** 载荷 MUST 省略 NDI 标识字段，MUST NOT 猜测默认机构码

### Requirement: 上报循环与离线可用性

上报 SHALL 使用独立定时器，周期缺省 5 秒（钳制 1s–300s），单次请求 MUST ≤5 秒；
失败 MUST 指数退避并熔断（上限 60 秒），窗口内定时器 MUST 跳过，手动触发 MUST 可强制立即尝试。
未配置区域节点时 MUST 装配 Noop 上报器：只 warn、不发起外部调用、不计错误率、不影响启动与主链路。

#### Scenario: 未配置
- **WHEN** `SILKROAD_NODE_ENDPOINT` 为空
- **THEN** 不上报、不创建定时器，状态 MUST 为 `regionReporting: "unconfigured"`

#### Scenario: 连续失败
- **WHEN** 上报连续失败
- **THEN** 服务 MUST 设置退避窗口并在窗口内跳过后台尝试，MUST NOT 向上抛错

#### Scenario: 手动探活
- **WHEN** 运维调用 `POST /admin/interop/region-reporting/report`
- **THEN** 即使处于退避窗口也 MUST 立即尝试一次

### Requirement: 未配置不得表述为已上报

状态与材料口径 MUST 由后端状态字段驱动：`regionReporting` 为 `unconfigured` 时，
系统状态页与对外材料 MUST 表述为「具备上报能力、当前未配置区域节点」，
MUST NOT 表述为「已向区域节点上报」。

#### Scenario: 状态页展示
- **WHEN** 区域节点未配置
- **THEN** `GET /admin/interop/region-reporting/status` MUST 返回 `unconfigured`，MUST NOT 返回成功上报时间

### Requirement: 连接器心跳携带标识

连接器心跳 SHALL 携带 `connectorId`；配置机构码时 MUST 附 `connectorId` 的 NDI 标识。
标识编码失败 MUST NOT 影响心跳发送。

#### Scenario: 机构码已配置
- **WHEN** 连接器配置了 `CONNECTOR_ID` 与 `NDI_ORG_CODE`
- **THEN** 心跳载荷 MUST 含 `connectorId` 与以 `ndi:` 开头的连接器标识

#### Scenario: 机构码缺失
- **WHEN** `NDI_ORG_CODE` 为空
- **THEN** 心跳 MUST 照常发送，且 MUST NOT 携带伪造的 NDI 标识
