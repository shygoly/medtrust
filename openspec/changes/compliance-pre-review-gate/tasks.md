## 1. 决策与治理先行

- [x] 1.1 就 design Q1（保障级口径）拍板并登记进 DECISIONS.md：已采用 (b)，登记为 D-CMP-1，含新保障级 `federated` 的定义（数据不出域 + 输出闸门 + 全程审计）
- [x] 1.2 DECISIONS.md 登记「预审在合约层绑定、在任务层复核」，以及旧合约不设宽限期（D-CMP-2）
- [x] 1.3 TRUST.md 新增控制点 CTL-22「L2 合规预审闸门（合约申请 + 任务准入，fail-closed）」
- [x] 1.4 FLOWS.md 新增 FLOW-CMP-01（预审 → 合约申请 → 任务准入复核）；DOMAIN.md 登记合约 `preReview`/`preReviewAck` 字段、跨库按值引用、维度来源词汇 `derived | declared` + `composition.ownerParticipantId`
- [x] 1.5 `node scripts/check-meta-docs.mjs` 为 0 error（15 warning 均为既有）

## 2. 预审服务端校验与引擎修正

- [x] 2.1 创建预审时校验场景和各层对象存在且为 `active`，拒绝时列出不合格对象（ComplianceService.assertObjectsActive）
- [x] 2.2 维度推导器：数据产品分级标签 → 数据敏感度（deriveDataSensitivity）；任务涉及的医院数 → 参与机构数（任务层传入）；mergeDimensions 输出来源与冲突。人类遗传资源对照表暂缺（design Q3），继续按自报
- [x] 2.3 引擎：总体风险取场景声明与维度判定中较高者（dimensionRisk：参与机构 ≥ 3、含人类遗传资源 → high）
- [x] 2.4 引擎新增阻断规则 `block-security-below-required`；种子补 L2 保障级 `federated`、已落地 L6 对象 `federated-local-compute`、风险策略 low→basic/medium→federated/high→enhanced
- [x] 2.5 裁决快照：rulesDigest = SM3(stableStringify(rules))；PreReviewSnapshot 结构按 design D2
- [x] 2.6 单测：未落地/不存在对象被拒；推导值覆盖自报值并记冲突；三家机构升 high；保障级不足被驳回（engine spec）

## 3. 分析类型与能力对象的对应关系

- [x] 3.1 种子叠加层（landing.ts）给 L3 对象登记 `metadata.analysisTypes`（disproportionality/comparative-effect/causal-*/algorithm-validation），L4 `federated-learning` 登记 fl-prediction/secretflow-training；applyLanding 写入 metadata
- [ ] 3.2 同步到线上注册表的数据脚本（事务 + 回滚 SQL）——【留到 §7 上线】：applyLanding 已在写 analysisTypes，重跑 capability seed 即同步；独立事务补丁脚本随 ali29 重建（§7.2）一并做
- [x] 3.3 单测：没有登记对应关系的分析类型被拒（pre-review-gate.spec「未登记能力映射 → 拒」）

## 4. 合约绑定

- [x] 4.1 控制面合约表增加 `preReview`、`preReviewAck` 两列（simple-json，可为空；ContractPreReview/ContractPreReviewAck）
- [x] 4.2 `request`：必须带 `compositionId`；校验预审属于该药企；按当前规则+推导维度（数据敏感度）重裁决；驳回则拒；快照写入草稿
- [x] 4.3 `approveDraft`：快照为需审批时必须提供 `preReviewAck { reason }`；快照为批准时不接受该入参；确认记录 `{by,reason,at}`
- [x] 4.4 `canonical()` 纳入 `preReview` 与 `preReviewAck`，`verifyIntegrity` 经由同一 canonical 覆盖；与 pinnedModules 共存
- [x] 4.5 演示种子合约初始化时生成配套种子预审（medium 场景 + federated 协议 → auto_approve）并写入快照
- [x] 4.6 单测：未附预审/引用他人预审/重裁决驳回被拒；需审批未确认拒绝签发；快照计入哈希（改快照即改哈希）；种子合约带快照

## 5. 任务准入复核

- [x] 5.1 抽出 `PreReviewGate.check(contract, task)`：快照存在 + 范围（L3∪L4 的 analysisTypes 覆盖）+ 按任务层参与机构数复评（block 拒 / manual_review 须合约有医院确认）
- [x] 5.2 接入 RWS、FL、SecretFlow 三处 `admit()`（准入层复核）；删除 SecretFlow 请求体 `compositionId` 入口与 orchestrator 层旧闸门
- [x] 5.3 单测：无快照被拒、越界被拒、规则收紧后被拒、需审批已确认时放行（pre-review-gate.spec）、SecretFlow 忽略 `compositionId`（l2-gate.spec）；e2e 归 §7.1

## 6. 前端

- [x] 6.1 合规预审页：裁决通过后新增「用此预审申请合约」（复用申请按钮，预填 compositionId）；去掉「仅供参考」提示，改为说明已绑定合约+任务
- [x] 6.2 申请合约按钮：新增预审选择器（listMyCompositions，展示裁决/风险），未选拦截并提交 compositionId；新增 GET /compositions
- [x] 6.3 医院审批（ContractRowActions）：需审批（manual_review）签发须填确认理由（展示裁决/风险，计入哈希）；auto_approve 不需要
- [x] 6.4 任务创建页（RWS/FL）：contract-multi-select 显示每份合约预审状态（verdict/无预审）；准入失败原因经 msg 原样展示（既有）

## 7. 验收与上线（演示结束后再做）

- [ ] 7.1 端到端：预审 → 申请合约 → 医院签发（含需审批确认）→ 创建 L2 任务 → 运行；再跑越界、规则收紧两个反例，确认都被拒
- [ ] 7.2 ali29 重建 API（会回到种子数据，种子带快照）和 web；重跑预跑任务；核对存证里的合约哈希覆盖了预审快照
