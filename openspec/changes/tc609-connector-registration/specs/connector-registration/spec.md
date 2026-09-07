# connector-registration

连接器可通过 API 注册（签发 SM2 证书 + 写入注册表）与注销（吊销证书 + 移除注册表）。

## ADDED Requirements

### Requirement: 连接器注册
系统 SHALL 通过 `POST /connectors/register`（operator）签发 SM2 证书并写入连接器注册表，
复用中心 CA 的密码学能力，不重复实现签名/吊销逻辑。

#### Scenario: 注册新连接器
- **WHEN** operator 以未占用的 connectorId 注册连接器
- **THEN** 返回 SM2 证书（含指纹/签名/有效期），注册表新增该连接器行。

#### Scenario: 重复注册被拒
- **WHEN** 以已注册的 connectorId 再次注册
- **THEN** 返回冲突错误，不重复签发。

### Requirement: 连接器注销
系统 SHALL 通过 `DELETE /connectors/:id`（operator）吊销证书并移除注册表行。

#### Scenario: 注销已注册连接器
- **WHEN** operator 注销已注册连接器
- **THEN** 其证书被置为吊销，注册表行被移除。

#### Scenario: 注销未知连接器
- **WHEN** 注销不存在的 connectorId
- **THEN** 返回 404。
