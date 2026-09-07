# contract-acknowledgement

合约签发前消费方须确认规则知悉，合约携带知悉记录（时间 + 哈希 + 身份）。

## ADDED Requirements

### Requirement: 规则知悉确认
消费方在合约签发前 SHALL 通过 `POST /contracts/:id/acknowledge` 确认规则知悉，记录确认时间、合约哈希与用户身份。

#### Scenario: 确认规则知悉
- **WHEN** 消费方对本人 draft 合约调用 acknowledge
- **THEN** 合约记录 `consumerAcknowledgedAt`（ISO 时间）与 `acknowledgedHash`（SM3(canonical+consumerId)）。

#### Scenario: 非消费方确认被拒
- **WHEN** 非消费方调用 acknowledge
- **THEN** 返回 403。

### Requirement: 签发前校验知悉
提供方审批 draft 合约时 SHALL 校验消费方已确认规则知悉，未确认则拒绝签发。

#### Scenario: 未确认拒签
- **WHEN** 提供方对未确认的 draft 合约调用 approve
- **THEN** 返回 400（消费方尚未确认规则知悉）。
