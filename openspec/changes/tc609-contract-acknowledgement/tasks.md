## 1. 实体/接口

- [x] 1.1 `DigitalContract` 接口 + `DigitalContractEntity` 增加 `consumerAcknowledgedAt`/`acknowledgedHash`。
- [x] 1.2 `pnpm --filter @medtrust/database build`。

## 2. 服务/控制器

- [x] 2.1 `ContractService.acknowledge`（时间 + SM3(canonical+consumerId) + 身份）。
- [x] 2.2 `ContractService.approveDraft` 校验已确认。
- [x] 2.3 `ContractController` 新增 `POST /contracts/:id/acknowledge`（consumer）。

## 3. 验证

- [x] 3.1 `contract.service.spec.ts`：确认→签发、未确认拒签、知悉记录三用例。
- [x] 3.2 `digital-contract` 全量回归通过。
- [ ] 3.3 更新差距矩阵 8.1 合约真实性保障（规则知悉已落地）。
