# chain-verification

链上查验去 mock：`POST /blockchain/verify` 对已锚定哈希返回 valid + 真实链上字段，
对未锚定/篡改哈希返回 invalid（fail-closed）。

## ADDED Requirements

### Requirement: 真实链上查验
系统 SHALL 通过 sidecar 读链上合约 `getAttestationByHash` 完成查验，不得恒返回 valid 或使用硬编码 signer。

#### Scenario: 已锚定哈希返回 valid
- **WHEN** 对已锚定数据哈希调用 `POST /blockchain/verify`
- **THEN** 返回 `valid: true`，并携带链上真实 timestamp 与 attester（非硬编码）。

#### Scenario: 未锚定哈希返回 invalid
- **WHEN** 对未锚定或篡改数据哈希调用 `POST /blockchain/verify`
- **THEN** 返回 `valid: false` 且 `attestation` 为空。

#### Scenario: 链不可达 fail-closed
- **WHEN** sidecar 不可达或返回错误
- **THEN** 查验返回 `valid: false`，不声称 valid（不假阳性）。
