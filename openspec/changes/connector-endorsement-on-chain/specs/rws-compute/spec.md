## ADDED Requirements

### Requirement: RWS 结果存证含连接器背书
RWS 结果存证 SHALL 在锚合并 `resultHash` 的同时，锚各贡献方连接器对其 `resultSm3` 的 SM2 背书（签名 + 证书指纹）。结果回传 SHALL 携带连接器对 `resultSm3` 的结果级 SM2 签名；平台 SHALL 按院验签并持久化，验签失败该院贡献无效（不计入合并与存证）。

#### Scenario: 回传带 resultSm3 签名 → 验签 → 锚链含背书
- **WHEN** 连接器回传带对 `resultSm3` 的 SM2 签名，平台验签通过
- **THEN** 该院背书（`resultSm3`/签名/指纹）随合并 `resultHash` 一并锚链

#### Scenario: 缺或错的结果签名 → 该院贡献拒
- **WHEN** 某院回传缺结果级签名或签名与 `resultSm3` 不符
- **THEN** 平台 MUST 拒该院贡献，不锚其背书、不计入合并
