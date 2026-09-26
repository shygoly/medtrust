# C2 场景追溯表（机器可核）

> 用途：把两个变更（`tee-confidential-node` / `tee-attestation-pilot`）的**每一个 spec 场景**钉到
> **真实存在的 enforcement 符号**与**真实存在的用例**上。校验器：`node scripts/check-c2-traceability.mjs`
>
> 它逐条核对三件事：
> ① 变更里的每个场景都必须有且只有一条记录（少一条、多一条、场景标题写错，都判红）；
> ② 符号 `路径#符号` 必须真实存在（`路径` 存在，且文件里能搜到 `符号`；支持 `Class.method`）；
> ③ 用例文件里必须有含该关键词的 `it(...)` / `test(...)` / `describe(...)` 标题，**且该用例不是被跳过的**——
> 关键词只出现在注释里、或只命中的是 `it.skip` / `xit` / `(cond ? describe : describe.skip)` 这类
> 条件跳过用例，都判红（跳过的用例不算证据：数据/环境缺失时它根本不跑）。
>
> 为什么值得固化成表：本仓最容易溜过去的一类缺口是「**规格写了、代码没做**」——2026-09-25/26 两轮
> 就是靠人工逐条比对才发现的（节点阶段状态上报缺失、C2 阶段下发前不复检证明、节点给 C0 中间制品
> 登记对外句柄……）。把它变成一张表 + 一个校验器之后，这类缺口会在跑测试时当场变红，
> 而不是等到实机演练才暴露。
>
> 说明：有些场景的「enforcement」本身就是**一扫描/断言**（例如「平台不得接触数据密钥」），
> 这类记录的 `symbol` 指向那条扫描用例文件中的判据文本，而不是某个生产类。

## tee-confidential-node

### spec: local-plan-review（连接器侧本地复核）

- id: tee-confidential-node/local-plan-review#用途不符
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#MdopReviewService
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#用途不符
- id: tee-confidential-node/local-plan-review#本地合约未声明证明策略
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#MdopReviewService
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#本地合约未声明证明策略
- id: tee-confidential-node/local-plan-review#合约允许 C2 但平台未给出对端
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#recipients.includes
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#合约接收方之外的节点
- id: tee-confidential-node/local-plan-review#复核结论带出 C2 对端
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#c2Targets
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#C2 对端记入复核结论
- id: tee-confidential-node/local-plan-review#会话结束后核验节点证明（D13 的独立校验落点）
  symbol: ts:apps/connector/src/mdop/mdop-node.service.ts#onAttestationWitness
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#会话见证

### spec: mdop-protocol（协议与 schema）

- id: tee-confidential-node/mdop-protocol#信封跨作业重放
  symbol: ts:apps/connector/src/mdop/node/entry-guard.ts#TrustedNodeEntryGuard
  test: ts:apps/connector/src/mdop/node/c2-session.spec.ts#信封跨作业重放
- id: tee-confidential-node/mdop-protocol#策略出现非 C3 出口
  symbol: ts:packages/mdop/src/schema/data-envelope.ts#parseDataEnvelope
  test: ts:packages/mdop/src/schema/data-envelope.spec.ts#出口不是 C3_only
- id: tee-confidential-node/mdop-protocol#非 seal 算子产出 C2
  symbol: ts:packages/mdop/src/label/lattice.ts#deriveOutputLabel
  test: ts:packages/mdop/src/label/lattice.spec.ts#非封装算子不得从非 C2
- id: tee-confidential-node/mdop-protocol#合约缺少证明策略
  symbol: ts:apps/api/src/mdop/mdop-jobs.service.ts#assertC2Target
  test: ts:apps/api/src/mdop/mdop-jobs.spec.ts#合约未声明证明策略
- id: tee-confidential-node/mdop-protocol#证明过期后再次编译
  symbol: ts:apps/api/src/mdop/mdop-attestation.service.ts#assertUsableForC2
  test: ts:apps/api/src/mdop/mdop-attestation.spec.ts#已过期
- id: tee-confidential-node/mdop-protocol#合约已终止
  symbol: ts:packages/mdop/src/attestation/release.ts#evaluateKeyRelease
  test: ts:apps/connector/src/mdop/node/c2-session.spec.ts#合约终止
- id: tee-confidential-node/mdop-protocol#目标不是本作业的片段节点
  symbol: ts:apps/api/src/mdop/mdop-messages.controller.ts#relayEnvelope
  test: ts:apps/api/src/mdop/mdop-relay.spec.ts#目标不是本作业的片段节点
- id: tee-confidential-node/mdop-protocol#密文摘要与信封声明不符
  symbol: ts:apps/api/src/mdop/mdop-messages.controller.ts#relayEnvelope
  test: ts:apps/api/src/mdop/mdop-relay.spec.ts#密文摘要与信封声明不符
- id: tee-confidential-node/mdop-protocol#合约未声明证明策略
  symbol: ts:apps/api/src/mdop/mdop-messages.controller.ts#relayEnvelope
  test: ts:apps/api/src/mdop/mdop-relay.spec.ts#合约不在作业列表
- id: tee-confidential-node/mdop-protocol#节点收到中继后完成会话
  symbol: ts:apps/connector/src/tee-node/relay-receive.ts#receiveRelayedEnvelope
  test: ts:apps/connector/src/tee-node/tee-node.spec.ts#接收平台中继的 C2 信封
- id: tee-confidential-node/mdop-protocol#平台把见证转给持有方
  symbol: ts:apps/api/src/mdop/mdop-attestation.service.ts#ingestWitness
  test: ts:apps/api/src/mdop/mdop-witness.spec.ts#转发给持有方
- id: tee-confidential-node/mdop-protocol#持有方独立核验失败
  symbol: ts:apps/connector/src/mdop/node/witness-verify.ts#NodeWitnessVerifier
  test: ts:apps/connector/src/mdop/node/witness-verify.spec.ts#记拒绝
- id: tee-confidential-node/mdop-protocol#未配置 KMS 公钥
  symbol: ts:apps/api/src/mdop/mdop-attestation.service.ts#ingestWitness
  test: ts:apps/api/src/mdop/mdop-witness.spec.ts#未配置 KMS 公钥
- id: tee-confidential-node/mdop-protocol#持有方核验结论可见（控制台）
  symbol: ts:apps/web/src/lib/witness-status-view.ts#witnessStatusView
  test: ts:apps/web/src/lib/witness-status-view.test.ts#核验通过
- id: tee-confidential-node/mdop-protocol#多方清单汇总
  symbol: ts:packages/mdop/src/schema/release-manifest.ts#mergeReleaseManifests
  test: ts:apps/api/src/mdop/mdop-merge-manifest.spec.ts#两方都带清单
- id: tee-confidential-node/mdop-protocol#没有清单
  symbol: ts:packages/mdop/src/schema/release-manifest.ts#mergeReleaseManifests
  test: ts:apps/api/src/mdop/mdop-merge-manifest.spec.ts#双方都没有清单
- id: tee-confidential-node/mdop-protocol#清单非法
  symbol: ts:apps/web/src/lib/release-manifest-view.ts#releaseManifestView
  test: ts:apps/web/src/lib/release-manifest-view.test.ts#清单非法
- id: tee-confidential-node/mdop-protocol#预算耗尽的后续查询
  symbol: ts:apps/connector/src/mdop/node/node-session.ts#TrustedNodeSession
  test: ts:apps/connector/src/mdop/node/c2-session.spec.ts#预算消耗与拒绝都随签名回执上报
- id: tee-confidential-node/mdop-protocol#预算消耗与拒绝进回执链
  symbol: ts:apps/connector/src/mdop/node/node-session.ts#TrustedNodeSession
  test: ts:apps/connector/src/mdop/node/c2-session.spec.ts#预算消耗与拒绝都随签名回执上报

### spec: node-artifact-lifecycle（C0 不出节点 / 制品与销毁 / 回执）

- id: tee-confidential-node/node-artifact-lifecycle#尝试投递 C0 制品
  symbol: ts:apps/connector/src/mdop/node/node-exit.ts#NodeExitGuard
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#C0 制品出节点被拒
- id: tee-confidential-node/node-artifact-lifecycle#接收方不在合约里
  symbol: ts:apps/connector/src/mdop/mdop-egress.ts#MdopEgressGuard
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#C3 目标不在接收方列表
- id: tee-confidential-node/node-artifact-lifecycle#合约不允许 C2
  symbol: ts:apps/connector/src/mdop/mdop-egress.ts#MdopEgressGuard
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#C2 投递：
- id: tee-confidential-node/node-artifact-lifecycle#拿不出本次证明声明
  symbol: ts:apps/connector/src/mdop/mdop-egress.ts#MdopEgressGuard
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#无本次证明
- id: tee-confidential-node/node-artifact-lifecycle#证明过期的目标
  symbol: ts:apps/connector/src/mdop/mdop-egress.ts#MdopEgressGuard
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#证明过期
- id: tee-confidential-node/node-artifact-lifecycle#未声明 C2 的作业尝试投递
  symbol: ts:apps/connector/src/mdop/mdop-egress.ts#MdopEgressGuard
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#C2 投递：
- id: tee-confidential-node/node-artifact-lifecycle#句柄摘要与内容不符
  symbol: ts:apps/api/src/mdop/mdop-messages.controller.ts#MdopMessagesController
  test: ts:apps/api/src/mdop/mdop-messages.spec.ts#句柄未登记 / 摘要不一致
- id: tee-confidential-node/node-artifact-lifecycle#句柄缺凭证关联
  symbol: ts:packages/mdop/src/schema/artifact.ts#parseArtifactHandle
  test: ts:packages/mdop/src/schema/schema.spec.ts#句柄缺凭证关联
- id: tee-confidential-node/node-artifact-lifecycle#登记节点内的 C0 句柄
  symbol: ts:apps/connector/src/tee-node/stage-dispatch.ts#runLocalStage
  test: ts:apps/connector/src/tee-node/stage-dispatch.spec.ts#不登记对外句柄
- id: tee-confidential-node/node-artifact-lifecycle#TTL 到期
  symbol: ts:apps/connector/src/mdop/node/node-artifacts.ts#NodeArtifactStore
  test: ts:apps/connector/src/mdop/node/node-runtime.spec.ts#TTL 到期自主销毁
- id: tee-confidential-node/node-artifact-lifecycle#销毁后读取
  symbol: ts:apps/connector/src/mdop/node/node-artifacts.ts#NodeArtifactStore
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#销毁后不可读
- id: tee-confidential-node/node-artifact-lifecycle#销毁覆盖临时盘
  symbol: ts:apps/connector/src/tee-node/persist.ts#NodeStateStore
  test: ts:apps/connector/src/tee-node/persist.spec.ts#销毁必须覆盖
- id: tee-confidential-node/node-artifact-lifecycle#销毁回执被冒充
  symbol: ts:apps/api/src/mdop/mdop-purge.service.ts#MdopPurgeService.onPurgeReceipt
  test: ts:apps/api/src/mdop/mdop-purge-receipts.spec.ts#销毁回执不得替别人发
- id: tee-confidential-node/node-artifact-lifecycle#回执链断链
  symbol: ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#MdopReceiptChainService
  test: ts:apps/api/src/mdop/mdop-receipt-chain-node.spec.ts#断链
- id: tee-confidential-node/node-artifact-lifecycle#回执的 signer 被冒充
  symbol: ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#ingestAuditReceipt
  test: ts:apps/api/src/mdop/mdop-receipt-chain-node.spec.ts#signer 被冒充

### spec: orchestration-kernel（编译与放置 / 登记 / 凭证 / 调度与销毁 / 平台不持密钥）

- id: tee-confidential-node/orchestration-kernel#目标节点尚未登记证明
  symbol: ts:apps/api/src/mdop/mdop-jobs.service.ts#assertC2Target
  test: ts:apps/api/src/mdop/mdop-jobs.spec.ts#目标节点未登记证明
- id: tee-confidential-node/orchestration-kernel#证明在编译后过期
  symbol: ts:apps/api/src/mdop/mdop-scheduler.service.ts#c2DispatchBlocker
  test: ts:apps/api/src/mdop/mdop-ticket-scheduler.spec.ts#登记过期则不下发
- id: tee-confidential-node/orchestration-kernel#登记被伪造
  symbol: ts:apps/api/src/mdop/mdop-attestation.service.ts#register
  test: ts:apps/api/src/mdop/mdop-attestation.spec.ts#自报我已校验
- id: tee-confidential-node/orchestration-kernel#度量在执行前变化
  symbol: ts:packages/mdop/src/attestation/execution.ts#verifyC2Execution
  test: ts:packages/mdop/src/attestation/execution.spec.ts#代码被换版
- id: tee-confidential-node/orchestration-kernel#缺节点回执不释放
  symbol: ts:apps/api/src/mdop/mdop-purge.service.ts#MdopPurgeService
  test: ts:apps/api/src/mdop/mdop-purge-receipts.spec.ts#缺回执不进 PURGED
- id: tee-confidential-node/orchestration-kernel#平台接口被要求返回密钥
  symbol: ts:apps/api/src/mdop/platform-no-key-access.spec.ts#平台不得接触
  test: ts:apps/api/src/mdop/platform-no-key-access.spec.ts#没有任何解封
- id: tee-confidential-node/orchestration-kernel#存证链不可达时的锚定记录
  symbol: ts:packages/mdop/src/anchor/anchor.ts#anchorChainHead
  test: ts:packages/mdop/src/anchor/anchor.spec.ts#存证链不可达
- id: tee-confidential-node/orchestration-kernel#接受或拒绝被替报
  symbol: ts:apps/api/src/mdop/mdop-ticket.service.ts#MdopTicketService
  test: ts:apps/api/src/mdop/mdop-ticket-scheduler.spec.ts#接受/拒绝不得替别家发
- id: tee-confidential-node/orchestration-kernel#合约签署被冒名提交
  symbol: ts:apps/api/src/runtime/digital-contract/mdop-contract.service.ts#MdopContractService.agree
  test: ts:apps/api/src/runtime/digital-contract/mdop-contract.spec.ts#提交方不是该合约的提供方
- id: tee-confidential-node/orchestration-kernel#证明登记的上链补偿
  symbol: ts:apps/api/src/mdop/mdop-attestation.service.ts#retryPendingAnchors
  test: ts:apps/api/src/mdop/mdop-attestation.spec.ts#链不可达时进补偿队列

### spec: trusted-space-node（身份与能力 / 证明 / 密钥释放 / 节点内执行 / 背书 / 预算 / 销毁）

- id: tee-confidential-node/trusted-space-node#未声明 TEE 能力的节点被排除
  symbol: ts:packages/mdop/src/label/lattice.ts#validateEdge
  test: ts:packages/mdop/src/label/lattice.spec.ts#C2 目标未声明 TEE 能力
- id: tee-confidential-node/trusted-space-node#注册时提交私钥字段
  symbol: ts:apps/connector/src/tee-node/registration.ts#registerNode
  test: ts:apps/connector/src/tee-node/registration.spec.ts#私钥字段
- id: tee-confidential-node/trusted-space-node#代码度量不在白名单
  symbol: ts:packages/mdop/src/attestation/provider.ts#verifyAttestationForC2
  test: ts:packages/mdop/src/attestation/provider.spec.ts#度量不在允许清单
- id: tee-confidential-node/trusted-space-node#TCB 版本过旧
  symbol: ts:packages/mdop/src/attestation/provider.ts#verifyAttestationForC2
  test: ts:packages/mdop/src/attestation/provider.spec.ts#TCB 低于下限
- id: tee-confidential-node/trusted-space-node#复用旧证明
  symbol: ts:packages/mdop/src/attestation/kms.ts#verifyReleaseWarrant
  test: ts:apps/connector/src/mdop/node/c2-session.spec.ts#旧释放凭据重放
- id: tee-confidential-node/trusted-space-node#节点回执就是协议回执（可被平台校链与锚定）
  symbol: ts:apps/connector/src/tee-node/receipt-report.ts#NodeReceiptReporter
  test: ts:apps/connector/src/tee-node/tee-node.spec.ts#回执链上报
- id: tee-confidential-node/trusted-space-node#每次会话上报见证
  symbol: ts:apps/connector/src/tee-node/witness-report.ts#reportSessionWitnesses
  test: ts:apps/connector/src/tee-node/tee-node.spec.ts#每个 key_id 出一条见证
- id: tee-confidential-node/trusted-space-node#凭证与请求不匹配
  symbol: ts:packages/mdop/src/attestation/release.ts#evaluateKeyRelease
  test: ts:packages/mdop/src/attestation/kms.spec.ts#请求方自报的密钥归属不算数
- id: tee-confidential-node/trusted-space-node#释放来自非指定的 KMS
  symbol: ts:packages/mdop/src/attestation/kms.ts#verifyReleaseWarrant
  test: ts:apps/connector/src/mdop/node/c2-session.spec.ts#释放必须来自
- id: tee-confidential-node/trusted-space-node#平台索取数据密钥
  symbol: ts:apps/api/src/mdop/platform-no-key-access.spec.ts#平台不得接触
  test: ts:apps/api/src/mdop/platform-no-key-access.spec.ts#没有任何解封
- id: tee-confidential-node/trusted-space-node#出口试图投出非 C3
  symbol: ts:apps/connector/src/mdop/node/node-exit.ts#NodeExitGuard
  test: ts:apps/connector/src/mdop/node/node-runtime.spec.ts#C3 → 接收方名单内放行
- id: tee-confidential-node/trusted-space-node#发布审查未通过
  symbol: ts:apps/connector/src/mdop/node/publication-review.ts#NodePublicationReview
  test: ts:apps/connector/src/mdop/node/node-runtime.spec.ts#小单元格被抑制
- id: tee-confidential-node/trusted-space-node#节点内中间制品不出域
  symbol: ts:apps/connector/src/tee-node/stage-dispatch.ts#hasSameNodeDownstream
  test: ts:apps/connector/src/tee-node/stage-dispatch.spec.ts#第一段只留在节点本地
- id: tee-confidential-node/trusted-space-node#阶段状态被替报
  symbol: ts:apps/api/src/mdop/mdop-scheduler.service.ts#onStageStatus
  test: ts:apps/api/src/mdop/mdop-ticket-scheduler.spec.ts#阶段状态不得替别家上报
- id: tee-confidential-node/trusted-space-node#未经节点内审查的产物不得出口
  symbol: ts:apps/connector/src/tee-node/stage-dispatch.ts#runLocalStage
  test: ts:apps/connector/src/tee-node/stage-dispatch.spec.ts#没有发布审查记录
- id: tee-confidential-node/trusted-space-node#一次阶段吃多份封存输入
  symbol: ts:apps/connector/src/tee-node/relay-receive.ts#runRelayedStage
  test: ts:apps/connector/src/tee-node/stage-dispatch.spec.ts#第一段只留在节点本地
- id: tee-confidential-node/trusted-space-node#推送后编译期即可用
  symbol: ts:apps/api/src/mdop/mdop-attestation.service.ts#acceptEndorsement
  test: ts:apps/api/src/mdop/mdop-attestation.spec.ts#编译期判为可用
- id: tee-confidential-node/trusted-space-node#伪造或过期的背书
  symbol: ts:apps/api/src/mdop/mdop-attestation.service.ts#acceptEndorsement
  test: ts:apps/api/src/mdop/mdop-attestation.spec.ts#背书已过期
- id: tee-confidential-node/trusted-space-node#校验方说「已验过」但背书不是给本次证明的
  symbol: ts:apps/connector/src/tee-node/attestation-probe.ts#runAttestationProbe
  test: ts:apps/connector/src/tee-node/attestation-probe.spec.ts#不把别人的背书当我自己的
- id: tee-confidential-node/trusted-space-node#超预算查询
  symbol: ts:apps/connector/src/mdop/node/budget-ledger.ts#NodeQueryBudgetLedger
  test: ts:apps/connector/src/mdop/node/c2-session.spec.ts#查询预算超限
- id: tee-confidential-node/trusted-space-node#差分查询
  symbol: ts:apps/connector/src/mdop/node/budget-ledger.ts#detectDifferential
  test: ts:apps/connector/src/mdop/node/node-runtime.spec.ts#差分查询
- id: tee-confidential-node/trusted-space-node#缺节点回执
  symbol: ts:apps/api/src/mdop/mdop-purge.service.ts#MdopPurgeService
  test: ts:apps/api/src/mdop/mdop-purge-receipts.spec.ts#缺回执不进 PURGED
- id: tee-confidential-node/trusted-space-node#销毁后读取
  symbol: ts:apps/connector/src/mdop/node/node-artifacts.ts#NodeArtifactStore
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#销毁后不可读

## 上游：被本变更 `MODIFIED` 的需求（`mdop-kernel`）

> 这两个能力（`local-plan-review` / `node-artifact-lifecycle`）在本变更里是 **MODIFIED Requirements**——
> 也就是说 C2 改动**动了已经生效的契约**。上游（`mdop-kernel`）里同名能力的场景同样必须被追溯覆盖：
> 「C2 改动碰坏既有行为」这条回归面，只看本变更自己的场景是看不出来的。
> 校验器自动推导这份上游清单：凡本变更标了 `## MODIFIED Requirements` 的能力，别处（未归档变更）同名能力下的
> 全部场景都进入必查集合。

### 上游 spec: mdop-kernel/local-plan-review

- id: mdop-kernel/local-plan-review#平台附带的合约与本地副本不一致
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#usableContract
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#作业引用多院合约时挑本院那一份
- id: mdop-kernel/local-plan-review#本地没有该合约
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#usableContract
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#本地没有合约副本
- id: mdop-kernel/local-plan-review#未经确认不签
  symbol: ts:apps/connector/src/mdop/contract-store.ts#MdopContractStore
  test: ts:apps/connector/src/mdop/contract-store.spec.ts#缺省人工确认
- id: mdop-kernel/local-plan-review#本地撤销立即生效
  symbol: ts:apps/connector/src/mdop/contract-store.ts#MdopContractStore
  test: ts:apps/connector/src/mdop/contract-store.spec.ts#本地撤销立即生效
- id: mdop-kernel/local-plan-review#用途不符
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#MdopReviewService
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#用途不符
- id: mdop-kernel/local-plan-review#申请 DP 预算
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#MdopReviewService
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#申请 DP 预算
- id: mdop-kernel/local-plan-review#缺少伦理批件
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#MdopReviewService
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#伦理
- id: mdop-kernel/local-plan-review#平台改动了片段
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#MdopReviewService
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#平台改动片段
- id: mdop-kernel/local-plan-review#人工复核超时
  symbol: ts:apps/api/src/mdop/mdop-ticket.service.ts#expireNegotiation
  test: ts:apps/api/src/mdop/mdop-ticket-scheduler.spec.ts#复核超时
- id: mdop-kernel/local-plan-review#拒绝消息的内容
  symbol: ts:apps/connector/src/mdop/mdop-node.service.ts#onFragmentOffer
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#拒绝消息只回错误码
- id: mdop-kernel/local-plan-review#篡改片段后下发
  symbol: ts:packages/mdop/src/ticket/verify.ts#verifyTicketForExecution
  test: ts:packages/mdop/src/ticket/verify.spec.ts#平台在签发后改动本节点片段
- id: mdop-kernel/local-plan-review#凭证缺少本院签名
  symbol: ts:packages/mdop/src/ticket/verify.ts#verifyTicketForExecution
  test: ts:packages/mdop/src/ticket/verify.spec.ts#凭证缺少本院签名
- id: mdop-kernel/local-plan-review#数据在接受后发生变化
  symbol: ts:packages/mdop/src/ticket/verify.ts#verifyTicketForExecution
  test: ts:packages/mdop/src/ticket/verify.spec.ts#数据在接受后变化
- id: mdop-kernel/local-plan-review#凭证过期
  symbol: ts:packages/mdop/src/ticket/verify.ts#verifyTicketForExecution
  test: ts:packages/mdop/src/ticket/verify.spec.ts#凭证过期

### 上游 spec: mdop-kernel/node-artifact-lifecycle

- id: mdop-kernel/node-artifact-lifecycle#非 C3 句柄带统计量
  symbol: ts:packages/mdop/src/schema/artifact.ts#parseArtifactHandle
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#非 C3 句柄带
- id: mdop-kernel/node-artifact-lifecycle#到期自主销毁
  symbol: ts:apps/connector/src/mdop/node/node-artifacts.ts#sweepExpired
  test: ts:apps/connector/src/mdop/node/node-runtime.spec.ts#TTL 到期自主销毁
- id: mdop-kernel/node-artifact-lifecycle#销毁后不可读
  symbol: ts:apps/connector/src/mdop/node/node-artifacts.ts#NodeArtifactStore
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#销毁后不可读
- id: mdop-kernel/node-artifact-lifecycle#重复销毁指令
  symbol: ts:apps/connector/src/mdop/node/node-artifacts.ts#purge
  test: ts:apps/connector/src/mdop/node/node-runtime.spec.ts#重复指令返回
- id: mdop-kernel/node-artifact-lifecycle#尝试投递 C0 制品
  symbol: ts:apps/connector/src/mdop/node/node-exit.ts#NodeExitGuard
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#C0 制品出节点被拒
- id: mdop-kernel/node-artifact-lifecycle#接收方不在合约里
  symbol: ts:apps/connector/src/mdop/mdop-egress.ts#MdopEgressGuard
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#C3 目标不在接收方列表
- id: mdop-kernel/node-artifact-lifecycle#回执被删除或篡改
  symbol: ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#MdopReceiptChainService
  test: ts:apps/api/src/mdop/mdop-purge-receipts.spec.ts#删掉/改动一条即报断链
- id: mdop-kernel/node-artifact-lifecycle#链不可达
  symbol: ts:apps/api/src/mdop/mdop-receipt-chain.service.ts#MdopReceiptChainService
  test: ts:apps/api/src/mdop/mdop-receipt-chain-node.spec.ts#链不可达

## tee-attestation-pilot

### spec: attestation-provider（可插拔证明契约）

- id: tee-attestation-pilot/attestation-provider#软件实现冒充硬件级别
  symbol: ts:packages/mdop/src/attestation/provider.ts#verifyAttestationForC2
  test: ts:packages/mdop/src/attestation/provider.spec.ts#软件级证明作 C2 目标
- id: tee-attestation-pilot/attestation-provider#证明信任根来自消息
  symbol: ts:packages/mdop/src/attestation/provider.ts#createAttestationVerifier
  test: ts:packages/mdop/src/attestation/provider.spec.ts#信任根不来自消息
- id: tee-attestation-pilot/attestation-provider#计划把 C2 边指向软件实现节点
  symbol: ts:packages/mdop/src/label/lattice.ts#validateEdge
  test: ts:packages/mdop/src/attestation/provider.spec.ts#软件级证明作 C2 目标
- id: tee-attestation-pilot/attestation-provider#复核不采信「平台称其为 TEE」
  symbol: ts:apps/connector/src/mdop/mdop-review.ts#MdopReviewService
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#平台把这条边指向合约接收方之外的节点
- id: tee-attestation-pilot/attestation-provider#投递时遇到软件级证明
  symbol: ts:apps/connector/src/mdop/mdop-egress.ts#MdopEgressGuard
  test: ts:apps/connector/src/mdop/mdop-node.spec.ts#C2 投递：
- id: tee-attestation-pilot/attestation-provider#新增链需要扩展协议
  symbol: ts:packages/mdop/src/attestation/provider.ts#mapVendorQuote
  test: ts:apps/connector/src/mdop/pilot-tee.spec.ts#换实现不动调用点
- id: tee-attestation-pilot/attestation-provider#字段映射验证
  symbol: ts:packages/mdop/src/attestation/provider.ts#mapVendorQuote
  test: ts:packages/mdop/src/attestation/provider.spec.ts#三种链的 quote
- id: tee-attestation-pilot/attestation-provider#换 KMS 客户端不动调用点
  symbol: ts:apps/connector/src/mdop/node/node-session.ts#TrustedNodeSession
  test: ts:apps/connector/src/mdop/node/c2-session.spec.ts#换 KMS 客户端不动调用点
- id: tee-attestation-pilot/attestation-provider#未随带材料
  symbol: ts:packages/mdop/src/attestation/provider.ts#createHardwareAttestationVerifier
  test: ts:packages/mdop/src/attestation/collateral.spec.ts#缺策略要求的材料
- id: tee-attestation-pilot/attestation-provider#材料过期或超出离线刷新窗口
  symbol: ts:packages/mdop/src/attestation/provider.ts#createHardwareAttestationVerifier
  test: ts:packages/mdop/src/attestation/collateral.spec.ts#材料自身已过期
