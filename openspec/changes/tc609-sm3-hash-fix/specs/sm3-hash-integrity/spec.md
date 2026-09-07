# sm3-hash-integrity

存证/假名哈希使用真国密 SM3，禁止以 sha256 冒充 SM3。

## ADDED Requirements

### Requirement: 真国密 SM3 摘要
连接器存证与假名化 SHALL 使用真国密 SM3（sm-crypto），不得以 sha256 挂 `SM3:` 前缀冒充。

#### Scenario: SM3 摘要与国密已知向量一致
- **WHEN** 对 "abc" 计算 SM3
- **THEN** 结果等于国密 SM3 已知摘要 `66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0`，
  而非 sha256 的 `ba7816bf...`。

#### Scenario: 全链路无伪 SM3
- **WHEN** 扫描 apps/ + packages/ 源码
- **THEN** 不存在同一文件既含 `sha256` 摘要调用又含 `SM3:` 前缀的实现（grep 守护，违反 = 红）。

### Requirement: 诚实标注（无 crypto 依赖平面）
无 crypto 依赖的平面若无法用真 SM3，SHALL 显式标注所用算法（如 `SHA256:`），不得使用 `SM3:` 前缀。

#### Scenario: 重计算节点 spec_hash 诚实标注
- **WHEN** Python 重计算节点生成本地 spec_hash
- **THEN** 前缀为 `SHA256:`（非 `SM3:`），权威 SM3 由控制面记录。
