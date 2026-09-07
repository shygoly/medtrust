## Why

TC609-6-2025-16 评测项 8.1「合约真实性保障」判定：**"规则知悉"零实现**（无消费方确认/签署记录）。
消费方在合约签发前未确认规则，合约真实性缺最小闭环。整改计划（`docs/TC609-6-2025-16-整改计划.md`）P0-7。

## What Changes

- `cp_digital_contract` 增加 `consumerAcknowledgedAt`/`acknowledgedHash`（及 DTO 接口同名字段）。
- `ContractService.acknowledge(id, consumerId)`：消费方确认规则知悉，记录确认时间 + `SM3(canonical + consumerId)` + 身份。
- `ContractService.approveDraft`：签发前校验已确认（未确认 → 400）。
- `ContractController` 新增 `POST /contracts/:id/acknowledge`（consumer 门控）。

## Capabilities

### Modified Capabilities
- `digital-contract`（既有）：合约签发前消费方须确认规则知悉，合约携带知悉记录（时间+哈希+身份）。

## Impact

- **Code:** `packages/database/src/control-plane/index.ts`、`apps/api/src/runtime/digital-contract/{contract.service.ts,contract.controller.ts}`。
- **Data:** `cp_digital_contract` 新增两列（nullable，存量合约不受影响）。
- **APIs:** 新增 `POST /contracts/:id/acknowledge`（consumer）；`POST /contracts/:id/approve` 增加知悉校验。
- **Risk:** 低。仅 draft→approve 路径新增校验；直接 `approve`（提供方自签）与 seed 不受影响。
