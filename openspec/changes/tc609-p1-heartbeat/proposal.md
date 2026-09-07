# P1-9 连接器心跳与运行监测

## Why
连接器周期上报心跳(版本/任务状态/资源水位);平台聚合节点状态 API;web 接真实状态。

## What Changes
POST /connector/heartbeat + GET /connectors 状态;ControlPlaneClient 周期上报。

## Impact
- 受影响的 specs: 按 ARCHITECTURE §7.1 登记。
- 风险: 见整改计划 §5。
