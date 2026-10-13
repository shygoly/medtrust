## ADDED Requirements

### Requirement: L4 迁移消费既有台账与闸门

L4 的通道与状态 SHALL 只由迁移台账决定（`fl.l4-prediction`），状态推进 MUST 依次满足：
证据在案 → `cutoverAt` → 连续稳定运行满 5 天 → 删旧接线 → `state=legacy-removed`。
MUST NOT 跳过其中任何一步；MUST NOT 用改台账的方式做回滚演练（会撞 legacy 只减不增）。

#### Scenario: 证据未齐就切换

- **WHEN** `fl.l4-prediction` 尚无 `equivalenceEvidence` 就被置 `cutoverAt` 并提交旧入口
- **THEN** 评审 MUST 拒绝；守护 MUST 在缺证据的 `channel=mdop` 条目上报红

#### Scenario: 观察窗内回滚

- **WHEN** 切换后在观察窗内需要回滚
- **THEN** MUST 用非生产演练开关 `ORCHESTRATION_FORCE_CHANNEL=fl.l4-prediction=legacy` 在旧通道上跑通并留证；台账 MUST 保持不变

#### Scenario: 未满 5 天就下线

- **WHEN** `cutoverAt` 距今不足 5 天就把 `fl.l4-prediction` 置 `legacy-removed`
- **THEN** `pnpm check:orchestration` MUST 报红（O7）

#### Scenario: 批次 1B 被顺手打开

- **WHEN** 本变更把 `fl.lora-fedavg` 也改成 `channel=mdop` 或移除其 `blockedBy`
- **THEN** 评审 MUST 拒绝（D-MDOP-8 未落册前 MUST NOT 开工）
