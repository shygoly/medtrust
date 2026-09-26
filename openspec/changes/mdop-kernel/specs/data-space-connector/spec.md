## ADDED Requirements

### Requirement: MDOP 消息经出站通道传输
MDOP 消息 SHALL 走连接器主动发起的出站连接：
- 平台发往连接器的消息随长轮询响应下发；
- 连接器发往平台的控制面消息和数据面投递，分别走两个独立的出站接口：数据面接口只承载 C3 结果，控制面接口不得携带数据内容。

连接器 MUST NOT 为 MDOP 开放任何入站端口。消息按「至少一次」投递，连接器 MUST 按 `msg_id` 与 `idempotency_key` 去重，对重复消息返回与首次相同的结果。

#### Scenario: 重复的片段要约
- **WHEN** 平台因未收到应答，按原幂等键重发了同一个片段要约
- **THEN** 连接器 MUST 返回与首次相同的接受或拒绝结果，MUST NOT 重新复核出不同结论

#### Scenario: 控制面消息夹带数据
- **WHEN** 一条经控制面接口发送的消息 `body` 中包含制品内容
- **THEN** 平台 MUST 拒收该消息
