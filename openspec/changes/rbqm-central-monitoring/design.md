# Design — rbqm-central-monitoring

## Context

平台已有跨中心聚合（rws-compute / federated-meta-analysis）、输出闸门小格抑制（OutputGate，minCell 硬底 5）、审计与告警（compliance）、上链存证（AttestationService）四层底座。缺的是把这些能力面向 **RBQM 质量信号**重新组织的一层：指标（KRI）定义、阈值（QTL）分层、站点级聚合、越限检测与展示。本 change 只做"质量信号层"，不新建密码学/闸门/链，全部复用。

## Goals / Non-Goals

- **Goal**：KRI 定义 + QTL 阈值分层（分类分层 = 风险等级 riskTier）；连接器站点级 KRI 聚合（本地算、过闸、仅回传聚合）；控制面越限检测 + 监查台 + 越限存证。
- **Non-Goal**：不做 EDC/试验数据采集；不替代 CTMS；不做患者级监查（只做站点级聚合信号）；实时流式监查留 future（本期为周期快照）。

## Key Decisions

### D1 — KRI 观测值是站点级聚合，永不含个体（复用 D1/D7 平面律）
连接器在本地把明细算成一个站点的 `{numerator, denominator, value}`，经 `OutputGate` 小格抑制（denominator < minCell → suppressed，value 不出域），只把这个三元组回传控制面。控制面三张表（`cp_kri_definition` / `cp_kri_observation` / `cp_qtl_breach`）全部是 **control-plane 平面**，与 settlement 台账同性质：聚合与元数据，永不落个体行。FLOWS 新增边 `connector-local → control-plane`，payload=`aggregate`，红线 `raw-local` 不出现。

### D2 — 分类分层 = KRI 定义上的 riskTier + 阈值分层
对齐 CSDR《RBQM 分类分层实施路径》："分类分层"落成两个正交维度：① KRI 定义带 `riskTier`（routine / elevated / intensive）；② 每个 KRI 的 `thresholds` 是一个**分层阈值数组** `[{level: 'warning'|'critical', op, value}]`。越限时取命中的最高层级。系统不内置"哪个 KRI 更重要"的排序——分层是配置，不是硬编码。

### D3 — 越限检测在控制面、fail-closed 复用既有语义
观测值入库即触发 `evaluateBreach`：按 KRI 的 `direction`（higher_worse / lower_worse）与分层阈值比较，命中则写 `cp_qtl_breach`（open），并把越限证据摘要 SM3 哈希经 `AttestationService.anchor` 上链（链不可达降级本地回执，与合约存证同）。越限同时进入 compliance 告警流（复用 audit 分类），无需新告警管道。

### D4 — 监查台是 compliance/operator 视角，复用角色门控
`/space/rbqm` 挂在 space-nav「合规 · COMPLIANCE」组，`roles: ['compliance','operator']`（与合规总览同门控）。展示：KRI 定义（带 riskTier）、站点 × KRI 观测矩阵（热力）、QTL 越限清单。

### D5 — 幂等种子，演示可离线自证
`RbqmService.onModuleInit` 幂等种子（`seed:` 前缀 id）：几个标准 KRI 定义 + 两个站点（华山/瑞金合成节点）的观测 + 一条命中 critical 的越限。理由：线上库易失（deploy 清空非种子），演示不依赖实时连接器也能展示完整信号链。与既有 settlement/contract 种子同规矩。

## Data Model（control-plane）

- `cp_kri_definition`：`{id, code, name, unit, category, riskTier, direction, windowKind, thresholds(json), description, status, createdAt}`
- `cp_kri_observation`：`{id, kriCode, siteId, siteName, studyId, periodStart, periodEnd, numerator, denominator, value, cohortSize, suppressed, sourceDigest, submittedAt, createdAt}`
- `cp_qtl_breach`：`{id, kriCode, siteId, studyId, observedValue, thresholdLevel, thresholdValue, severity, status, detectedAt, attestationTxHash, attestationBlock, createdAt}`

## Risks

- **KRI 聚合的分子/分母口径**由连接器域服务约定，跨中心口径一致性是研究效度问题（属 EVIDENCE 域），本期只保证"过闸 + 仅聚合"，口径统一留接入期倒逼。
- 无硬件 TEE，站点级聚合仍在软件密封 + 出域守卫下（与现有 RWS 同等保护，不降级）。
