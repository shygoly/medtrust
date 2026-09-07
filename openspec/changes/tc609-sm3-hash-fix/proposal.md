## Why

TC609-6-2025-16 评测项 7.5「交付存证」与国密合规专项判定：连接器任务存证指纹是**伪 SM3**
（`sha256` 贴 `SM3:` 前缀，`rws-orchestrator.ts` / `settlement.ts` / `mock-secretflow-adapter.ts`），
假名化用 SHA-256；Python 重计算节点 `runtime.py` 同样 `SM3:` + sha256。这与 D8（连接器信任链强制
SM2/SM3/SM4）冲突，评测时构成主动误导。整改计划（`docs/TC609-6-2025-16-整改计划.md`）P0-5。

## What Changes

- `apps/connector` 引入 `sm-crypto`（+ 环境类型声明），新增 `domain/sm3.ts`（唯一 SM3 入口）：
  `sm3Hex` / `sm3Fingerprint`。
- 替换全部伪 SM3 为真国密 SM3：`rws-orchestrator.ts`（task/input/output 哈希）、`settlement.ts`
  （结算台账哈希）、`mock-secretflow-adapter.ts`（SecretFlow spec 哈希）、`deidentifier.ts`
  （假名化 SHA-256 → SM3 + salt）。
- `apps/agent` `runtime.py` 的 `spec_hash` 从 `SM3:` 假前缀改为诚实 `SHA256:` 标注（重计算节点无
  crypto 依赖；权威 SM3 由控制面记录）。
- 治理：`TRUST.md` 新增 `CTL-15`（存证/假名哈希禁用伪 SM3）+ 更新红线 1（sm-crypto 白名单扩展到
  连接器 `sm3.ts` 单一入口）；`scripts/check-meta-docs.mjs` 增加「伪 SM3」grep 守护（`SM3:` + sha256
  同文件即红）。

## Capabilities

### Modified Capabilities
- `data-space-connector`（既有）：任务/结算/spec 存证哈希与假名化改用真国密 SM3，与控制面 SM3 口径一致。

## Impact

- **Code:** `apps/connector/src/domain/{sm3.ts,rws-orchestrator.ts,settlement.ts,deidentifier.ts,secretflow/mock-secretflow-adapter.ts}`、
  `apps/connector/package.json`、`apps/agent/src/medtrust_agent/runtime.py`、`scripts/check-meta-docs.mjs`、`TRUST.md`。
- **Data:** 历史任务指纹不变（哈希含算法标识/前缀）；新任务起用真 SM3。假名 subjectKey 口径变更仅影响后续摄入。
- **APIs:** 无端点变更。
- **Risk:** 低。存证指纹口径变更不跨平面强比较（连接器/agent 分属不同平面，D-CN-1）；grep 守护防止回退。
