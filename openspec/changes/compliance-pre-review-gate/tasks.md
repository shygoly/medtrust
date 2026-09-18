## 1. 决策与治理先行

- [x] 1.1 就 design Q1（保障级口径）拍板并登记进 DECISIONS.md：已采用 (b)，登记为 D-CMP-1，含新保障级 `federated` 的定义（数据不出域 + 输出闸门 + 全程审计）
- [ ] 1.2 DECISIONS.md 登记「预审在合约层绑定、在任务层复核」，以及旧合约不设宽限期
- [ ] 1.3 TRUST.md 新增控制点「L2 合规预审闸门（合约申请 + 任务准入，fail-closed）」
- [ ] 1.4 FLOWS.md 增加「预审 → 合约申请」步骤和三类任务的准入复核；DOMAIN.md 登记合约的 `preReview` / `preReviewAck` 字段、跨平面按值引用，以及维度来源词汇 `derived | declared`
- [ ] 1.5 `node scripts/check-meta-docs.mjs` 为 0 error

## 2. 预审服务端校验与引擎修正

- [ ] 2.1 创建预审时校验场景和各层对象存在且为 `active`，拒绝时列出不合格对象
- [ ] 2.2 维度推导器：数据产品分级标签 → 数据敏感度；类别对照（有才推导）→ 人类遗传资源；任务涉及的医院数 → 参与机构数；输出每个维度的来源和冲突
- [ ] 2.3 引擎：总体风险取场景声明与维度判定中较高者（参与机构 ≥ 3、含人类遗传资源 → high）
- [ ] 2.4 引擎：新增阻断规则 `block-security-below-required`，各风险等级都强制所需保障级。按 D-CMP-1 实现：补上 L2 保障级 `federated` 数据行、代表「联邦就地计算 + 输出闸门」的已落地 L6 对象，并把风险策略改为 low → basic、medium → federated、high → enhanced
- [ ] 2.5 裁决快照：L2 规则稳定序列化后算 SM3 摘要；快照结构按 design D2
- [ ] 2.6 单测：未落地对象和不存在的对象被拒；推导值覆盖自报值并记冲突；三家机构升为 high；保障级不足被驳回；快照中的规则摘要可与当前规则比对

## 3. 分析类型与能力对象的对应关系

- [ ] 3.1 在种子叠加层给相关 L3 对象登记 `metadata.analysisTypes`，覆盖 disproportionality、comparative-effect、causal-*、algorithm-validation、FL 预测的模型类型、SecretFlow 训练
- [ ] 3.2 同步到线上注册表的数据脚本，做法与落地状态同步一致（事务 + 回滚 SQL）
- [ ] 3.3 单测：没有登记对应关系的分析类型被拒

## 4. 合约绑定

- [ ] 4.1 控制面合约表增加 `preReview`、`preReviewAck` 两列（simple-json，可为空）
- [ ] 4.2 `request`：必须带 `compositionId`；校验预审属于该药企；按当前规则加推导维度重新裁决；驳回则拒绝；把快照写入草稿
- [ ] 4.3 `approveDraft`：快照为需审批时必须提供 `preReviewAck { reason }`；快照为批准时不接受这个入参
- [ ] 4.4 `canonical()` 纳入 `preReview` 与 `preReviewAck`，`verifyIntegrity` 同样覆盖；如果 `connector-wasm-sandbox-disproportionality` 已先合入，两者的新增条款一并纳入
- [ ] 4.5 演示种子合约初始化时，生成配套的种子预审并写入快照
- [ ] 4.6 单测：未附预审、引用他人预审、重新裁决为驳回，都被拒；需审批未确认拒绝签发；改动快照导致完整性校验失败；种子合约带有快照

## 5. 任务准入复核

- [ ] 5.1 抽出 `PreReviewGate.check(contract, task)`：检查快照是否存在、任务范围、按任务层维度复评
- [ ] 5.2 接入 RWS、FL、SecretFlow 三处 `admit()`；删除 SecretFlow 请求体里的 `compositionId` 入口
- [ ] 5.3 单测与 e2e：无快照被拒、越界被拒、规则收紧后被拒、需审批已确认时放行、SecretFlow 忽略 `compositionId`

## 6. 前端

- [ ] 6.1 合规预审页：新增「用此预审申请合约」（选数据产品后发起申请）；去掉「仅供参考」的提示
- [ ] 6.2 申请合约按钮：选择自己的预审，并展示其裁决
- [ ] 6.3 医院审批操作：展示预审快照，包括场景、所选对象、参数、维度及来源、冲突、裁决；需审批时必须填写确认理由
- [ ] 6.4 三类任务的创建页：显示每份合约的预审状态，准入失败的原因原样展示

## 7. 验收与上线（演示结束后再做）

- [ ] 7.1 端到端：预审 → 申请合约 → 医院签发（含需审批确认）→ 创建 L2 任务 → 运行；再跑越界、规则收紧两个反例，确认都被拒
- [ ] 7.2 ali29 重建 API（会回到种子数据，种子带快照）和 web；重跑预跑任务；核对存证里的合约哈希覆盖了预审快照
