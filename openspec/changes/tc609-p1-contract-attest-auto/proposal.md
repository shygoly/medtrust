# P1-2 合约备案自动化

## Why
approveDraft 成功后自动 attest(异步不阻塞);回执回写合约表;详情页出示链上回执。

## What Changes
DigitalContract 增加回执字段;ContractService 注入 AttestationService;approveDraft 后自动锚定。

## Impact
- 受影响的 specs: 按 ARCHITECTURE §7.1 登记。
- 风险: 见整改计划 §5。
