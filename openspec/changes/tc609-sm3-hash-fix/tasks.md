## 1. 引入 SM3

- [x] 1.1 `apps/connector/package.json` 加 `sm-crypto` + `pnpm install`。
- [x] 1.2 新增 `apps/connector/src/domain/sm3.ts`（sm3Hex / sm3Fingerprint）+ `sm-crypto.d.ts`。

## 2. 替换伪 SM3

- [x] 2.1 `rws-orchestrator.ts` hash() → sm3Fingerprint。
- [x] 2.2 `settlement.ts` 台账哈希 → sm3Fingerprint。
- [x] 2.3 `mock-secretflow-adapter.ts` hashSecretFlowSpec → sm3Fingerprint。
- [x] 2.4 `deidentifier.ts` 假名 SHA-256 → sm3Hex + salt。
- [x] 2.5 `apps/agent/runtime.py` spec_hash 假前缀 SM3: → 诚实 SHA256:。

## 3. 治理

- [x] 3.1 `TRUST.md` 新增 CTL-15 + 更新红线 1（连接器 sm3.ts 单一入口）。
- [x] 3.2 `check-meta-docs.mjs` 加「伪 SM3」grep 守护（SM3: + sha256 同文件 = 红）。

## 4. 验证

- [x] 4.1 `sm3.spec.ts`：sm3("abc") 等于国密已知摘要（证真 SM3）。
- [x] 4.2 rws-orchestrator / settlement / deidentifier / secretflow-task-runner 回归通过。
- [x] 4.3 `node scripts/check-meta-docs.mjs` 0 error。
- [ ] 4.4 更新差距矩阵 7.5 交付存证（伪 SM3 项）与 2.4 伪 SM3 行状态。
