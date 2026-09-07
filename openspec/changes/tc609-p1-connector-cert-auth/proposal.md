# P1-4 连接器接入鉴权升级

## Why
注册时下发 SM2 证书;请求带证书指纹+签名+时间戳;guard 验签+吊销检查;保留 token 降级(配置开关)。

## What Changes
ConnectorAuthService + 扩展 ConnectorTokenGuard;连接器 ControlPlaneClient 签名。

## Impact
- 受影响的 specs: 按 ARCHITECTURE §7.1 登记。
- 风险: 见整改计划 §5。
