# TEE 两变更收口报告（2026-09-26）

仓库：`/Users/mac/Sync/project/medtrust`
变更：`openspec/changes/tee-confidential-node`、`openspec/changes/tee-attestation-pilot`
方法：打开 `tasks.md` 声称的路径/符号/用例标题核对仓内文件；简写路径已解析。未跑真实硬件或真实 KMS。未提交 git。

## 1. 任务计数

| 变更 | 变更前 | 变更后 |
|---|---|---|
| tee-confidential-node | 80 / 90 | **80 / 90** |
| tee-attestation-pilot | 18 / 20 | **18 / 20** |

没有新增勾选，也没有把任何 `[x]` 改回 `[ ]`。
合法结论：**剩余 12 条全部被外部前置卡住**，仓内不能再推进。

## 2. 「证据不符合」的 `[x]` 处置

没有一条 `[x]` 的核心证据不存在或不覆盖对应要求。以下是**说明过时、实现已在**的条目——全部保持勾选，只改正文：

| 任务 | 问题 | 处置 |
|---|---|---|
| 1.2 / 1.5 | 正文仍写「开关未开 / 代码未落地」 | 加审计注：那是 09-25 快照，现行状态由 1.1b / 1.5b 覆盖 |
| 2.7 / 3.11 / 3.13 / 3.23 / 3.25 / 3.28 | 用例/场景条数是落地当时的数字 | 改为「当时数字 / 现行以闸门为准」；3.28 旧稿 89/185/810 不删，§11 另记本轮实测 |
| 3.13 | 边界句写「注册/心跳 HTTP 仍未落地」 | 该句作废；接线在 `tee-node/registration.ts`（§3.1） |
| 6.2 | 嵌套句写「C2 数据面仍待做」 | 该句作废；数据面在 §3.14 |
| 8.5（未勾） | 旧稿写「回执链仍是内存态」 | 该句作废；§3.16 `persist.ts` 已落地。路径改为 `apps/connector/scripts/verify-receipt-chain.mjs` |
| 9.1 / 9.5 | DEPLOY §4.3 现状列与代码不一致 | 同步 DEPLOY（见下），不改勾 |

未勾条目无一可在仓内完成，全部补了三段式，见 §5。

## 3. 本轮新增与修改的文件

| 文件 | 改动 |
|---|---|
| `openspec/changes/tee-confidential-node/tasks.md` | 过时说明更正；10 条未勾补三段式；新增 §11 证据审计 |
| `openspec/changes/tee-attestation-pilot/tasks.md` | 1.2 / 1.3 补三段式；新增 §5 证据审计 |
| `DEPLOY.md` | §4.3 组件表 #1：删「仍缺注册/心跳/长驻循环」；§9.5「离线核验」收窄为厂商 collateral |
| `docs/医疗数据跨节点算子编排协议规范（MDOP）v0.1.md` | §9.3 加更正注：示例仍写 SM4-GCM，权威在 v0.2（AES-256-GCM） |

未改：`docs/architecture-overview.html`（「2026-09-26 续：把「谁在说话」补齐」事实内容未动；`<p class` 19 / `</p>` 19 仍配平）。
未改：`.gitignore`、`.keel/`、`apps/agent/**`。未 `git add` / `commit` / `push`。

## 4. 闸门真实输出行

本机实测，不是推断。

```
Change 'tee-confidential-node' is valid
Change 'tee-attestation-pilot' is valid
```

```
check-meta-docs: 0 error(s), 14 warning(s)
```

```
check-c2-traceability: 0 error(s), 0 warning(s)（104 个场景，其中上游 22 个 / 104 条追溯记录）
```

```
check-protocol-error-codes: 0 error(s), 0 warning(s)（25 个码 / §11 表 25 行）
```

```
check-tee-claims: 0 error(s)（扫描 981 个 TS 文件）
```

```
✓ 负向验证（MedTrust）：2/2 条用例全部通过（VC-8 · FC/AG 两维度）
```

```
ℹ tests 22
ℹ pass 22
ℹ fail 0
```

```
✓ governance: 全部通过
```

完整 `pnpm test`（退出码 0，约 582s）：

```
check-meta-docs: 0 error(s), 14 warning(s)
check-c2-traceability: 0 error(s), 0 warning(s)（104 个场景，其中上游 22 个 / 104 条追溯记录）
check-protocol-error-codes: 0 error(s), 0 warning(s)（25 个码 / §11 表 25 行）
check-tee-claims: 0 error(s)（扫描 981 个 TS 文件）
ℹ tests 22 / pass 22 / fail 0
✓ 负向验证（MedTrust）：2/2 条用例全部通过（VC-8 · FC/AG 两维度）
packages/mdop test: Test Suites: 20 passed, 20 total
packages/mdop test: Tests:       204 passed, 204 total
apps/api test: Test Suites: 107 passed, 107 total
apps/api test: Tests:       819 passed, 819 total
apps/connector test: Test Suites: 3 skipped, 110 passed, 110 of 113 total
apps/connector test: Tests:       42 skipped, 678 passed, 720 total
packages/wasm-algorithms test: ℹ tests 60 / pass 60 / fail 0
apps/connector-ml test: 4 passed in 9.49s
apps/web test: Done
pnpm_test_exit:0
```

## 5. 仍然未勾的条目与解锁三段式

### tee-confidential-node

| 任务 | (a) 解锁动作 | (b) 归属方 | (c) 验收证据 | 仓内做不了的原因 |
|---|---|---|---|---|
| 1.2b | 真实证明链 + 真实 KMS + §9.2/§9.3 演练通过后，把 P-CTL-8 移入正册 CTL-29 | 运维/硬件 + 医院/合规 | TRUST 正册 CTL-29；check-meta-docs 0 error；演练记录附转正 PR | 转正条件要求真实实现与演练，替身不算 |
| 3.2 | 真实机型上实现 hardwareAttestation 工厂并注入 | 硬件 / 运维 | 通告取自真实 quote；mapVendorQuote 用真 quote 再跑 | 需要机器出 quote |
| 3.3 | 部署真实 KMS 并注入 remoteKms | 医院/采购 + 运维 | 七条负例在真 KMS 上复跑；未注入仍报错 | 需要真实 KMS |
| 3.12b | 医院/合规书面选定 PSI 或共享盐 | 医院 / 合规 | 取向写入 DECISIONS；模块 ABI 不动 | 需要医院/合规决策 |
| 4.1 | 按 P4 接真实信任根（真验 quote + 真取料） | 硬件 / 运维 | 七负例 + collateral 时效在真根上复跑 | 需要证明服务可达 |
| 4.2 | 真 KMS 用一次性公钥封装；实例退出密钥不可恢复 | 运维 / 硬件 | 换私钥解不出；重启后旧 DEK 失效 | 演练实现把密钥留在进程内存 |
| 4.3 | 书面选定自建或共管并部署 | 医院 / 合规 / 采购 | 部署清单 + platform-no-key-access 仍绿 | 归属是决策不是代码 |
| 8.5 | 真部署上带链跑完整合成数据链 | 运维 + 硬件 | PURGED + 回执 valid + 真实 chain_tx | 分块用例不是带链整跑 |
| 9.2 | DEPLOY §4.3 步骤 2–7 单院 MVP | 运维 / 采购 / 硬件 | 不得用软件提供者/LocalDevKms 勾选 | 需要真实机与 KMS |
| 9.3 | 9.2 通过后两院合成数据演练 | 运维 + 两院配合 | 两院+节点链 valid；缺回执不得 PURGED | 需要两院实部署 |

### tee-attestation-pilot

| 任务 | (a) 解锁动作 | (b) 归属方 | (c) 验收证据 | 仓内做不了的原因 |
|---|---|---|---|---|
| 1.2 | 拿到开通/配额批文、信创采购或书面放弃、院内无外网可达性方案 | 运维/采购 + 医院网络 | P1 格子改为 [本仓已核实] 并写单据编号 | 公开机型资料不是采购核实 |
| 1.3 | 在 1.2 的机器上出真实 quote 并验到厂商根 | 硬件 / 运维 | quote 原文或 SM3 + 校验日志 + 耗时 | 未拿到机器 = 未实测 |

## 6. SM4-GCM / 国密信封口径

实现：`apps/connector/src/mdop/operators/seal.ts#aeadSeal` 使用 `createCipheriv('aes-256-gcm')`，`payload.cipher = 'AES-256-GCM'`。

| 位置 | 口径 |
|---|---|
| 规格 / proposal / design / 协议 v0.2 §9.3 / DECISIONS D8 落地补注 | 一致：如实写 AES-256-GCM；禁止称「国密信封 / 全链国密」；收回条件＝受审计的 SM4-GCM |
| 协议 v0.1 §9.3 示例 | 仍写 `SM4-GCM`（历史稿）。本轮加更正注，指向 v0.2 |
| `docs/tech-debt.md` | 未单列此债。偏离已在 D8，不双记 |
| `docs/architecture-overview.html` | 无「国密信封 / 全链国密 / 本期 SM4-GCM」高估 |

**禁止**：自行实现 SM4-GCM 并宣称已收回。本轮未实现国密 AEAD。

## 7. 证据审计全表

| 任务号 | 声称的证据 | 实际核对结果 | 处置 |
|---|---|---|---|
| tee-confidential-node 1.1 | DECISIONS D-MDOP-6/D9/D-TEE-1/D-TEE-2 落地补注 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 1.1b | lattice.ts#validateEdge / MdopJobsService#assertC2Target / nodeCapabilityAdvertisement / evaluateKeyRelease | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 1.2 | TRUST.md P-CTL-8 + 威胁模型 | 存在且覆盖（正文「开关未开」是历史快照，现行 TRUST 已写翻转） | 加审计注，不改勾 |
| tee-confidential-node 1.3 | DOMAIN cp_mdop_attestation / INV-TEE-01/02 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 1.4 | FLOWS FLOW-MDOP-02；release.ts 简写=packages/mdop/src/attestation/release.ts | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 1.5 | ARCHITECTURE §3 当时快照 | 存在且覆盖（已被 1.5b 覆盖现行状态） | 加审计注，不改勾 |
| tee-confidential-node 1.5b | ARCHITECTURE §2/§3/§9 现行两层状态 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 1.6 | REGULATORY REG-08 C2 前提变化 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 1.7 | check-meta-docs + check-tee-claims + governance:negative | 存在且覆盖 | 保持 [x]；本轮复跑 0 error/14 warning |
| tee-confidential-node 2.1 | schema/data-envelope.ts + spec | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 2.2 | operator.ts seal + lattice deriveOutputLabel | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 2.3a | AttestationPolicy + allowed_measurements + 按链 min_tcb | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 2.3b-i | schema/contract.ts attestation_policy | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 2.3b-ii | resolveMeasurementWhitelist | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 2.3b-iii | MdopContractTerms.attestationPolicy + buildMdopContract | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 2.4 | validateEdge C2 + verifyAttestationForC2 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 2.5 | TicketCore.attestation + verifyC2Execution | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 2.6a | E_ATTESTATION_FAILED / E_MEASUREMENT_NOT_ALLOWED / E_TCB_TOO_OLD | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 2.6b | E_KEY_RELEASE_DENIED / E_ENVELOPE_POLICY | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 2.7 | data-envelope/lattice/provider/execution specs；145 条为当时数字 | 存在且覆盖 | 条数改为「当时/现行以闸门为准」 |
| tee-confidential-node 3.1 | identity.ts / providers.ts / registration.ts + 5 条用例 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.4 | entry-guard.ts + 5 条用例 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.5 | 复用 MdopStageExecutor | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.6 | publication-review.ts；DP 未实现已如实写 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.7 | budget-ledger.ts + EXITED/STAGE_FAILED 回执 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.8 | node-exit.ts | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.9 | node-receipts.ts + receipt-report.ts | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.10 | node-artifacts.ts | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.11 | node-session.ts + c2-session.spec.ts（当时 13，现 16 it） | 存在且覆盖 | 回写条数口径 |
| tee-confidential-node 3.12a | pairing.ts / pairing-model.ts / wasm-algorithms/scripts/{build,check-reproducible,pairing-parity}* | 存在且覆盖（简写路径解析到包内 scripts） | 保持 [x] |
| tee-confidential-node 3.12c | buildPairedCohortPlan + collect-paired-cohort | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.12d | stage-dispatch.ts 两阶段 + 7 条用例 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.12e | reportNodeStageStatus | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.12f | pairing-sandbox / wasm-runner / createNodeExecutor | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.12g | operator-store.ts + E_REVOCATION_UNSYNCED | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.13 | tee-node/ 可部署部分；旧稿称注册/心跳未落地 | 存在且覆盖（接线已由 3.1 落地） | 删过时边界句 |
| tee-confidential-node 3.14 | POST /mdop/envelopes + relay-receive + poller | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.15 | contract-store.ts 6 条 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.16 | persist.ts + state.ts 6 条 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.17 | fragment-review + NodeMessageRouter | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.18 | TrustedNodeRuntime + createTrustedNodeAssembly | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.19 | contractCopiesForOffer + storeContractCopies | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.20 | c2-conformance-e2e.spec.ts | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.21 | dispatchReadyStages assertUsableForC2 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.22 | C0 不登记对外句柄 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.23 | traceability.md + check-c2-traceability.mjs；67 为当时集合 | 存在且覆盖 | 注明现行 104 |
| tee-confidential-node 3.24 | check-protocol-error-codes 25 码 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.25 | 上游 22 + 104 场景；旧稿 89/89 与 104 并存 | 存在且覆盖 | 以 104 为准改写 |
| tee-confidential-node 3.26 | c2-failure-e2e.spec.ts | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.27 | c2-multi-node-e2e.spec.ts | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 3.28 | 完整 pnpm test；旧数字 89/185/810 | 存在且覆盖（闸门仍绿，数字过时） | §11 回写本轮实测 |
| tee-confidential-node 4.4 | kms.spec.ts 七负例 + c2-session 节点层 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 5.1 | MdopAttestationEntity + Service；当时 10 条，现 20 it | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 5.2 | assertC2Target + mergeAttestationPolicies | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 5.3 | offerTickets 冻结 attestation[node] | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 5.4 | 调度同构片段节点 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 5.5 | nodesToPurge 含可信空间节点 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 5.6 | anchorQuoteDigest + retryPendingAnchors | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 5.7 | platform-no-key-access.spec.ts | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 5.8 | ingestWitness + mdop-witness.spec.ts | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 5.9 | push.ts + acceptEndorsement + attestation-probe | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 6.1 | mdop-egress.ts decide C2 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 6.2 | seal.ts aeadSeal AES-256-GCM；旧稿「数据面仍待做」 | 存在且覆盖（数据面已由 3.14 落地） | 删过时说明 |
| tee-confidential-node 6.3 | 连接器 tee 恒 null | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 6.4 | 未声明 C2 / 过期 / AAD 三处用例 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 6.5 | mdop-review 第 4 项只判策略与对端 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 6.6 | 连接器仍拒 ε>0 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 6.7 | witness.ts / ingestWitness / witness-verify.ts | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 7.1 | c2-policy-panel.tsx | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 7.2 | 作业页凭证与回执链 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 7.3a | 合并结果面板 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 7.3b | release-manifest 随 C3 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 7.4 | witness-status-view + API witnessStatus | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 8.1 | 协议层+节点层证明负例 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 8.2 | 越权出口 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 8.3 | 重放与新鲜度 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 8.4 | 查询预算超限不执行 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 9.1 | DEPLOY.md §4.3 组件表 | 存在且覆盖（本轮修正 #1 现状列过时句） | 同步 DEPLOY，保持 [x] |
| tee-confidential-node 9.4 | DEPLOY §4.3 上线/回滚 | 存在且覆盖 | 保持 [x] |
| tee-confidential-node 9.5 | DEPLOY §4.3 如实边界；「离线核验」易与回执工具混淆 | 存在且覆盖 | 收窄为厂商 collateral |
| tee-confidential-node 1.2b | P-CTL-8→CTL-29；enforcement 已齐，缺真实链/KMS/演练 | 存在但不覆盖转正条件 | 保持 [ ] + 三段式 |
| tee-confidential-node 3.2 | 报告契约+接缝已齐；缺真实 quote 链 | 存在但不覆盖真实对接 | 保持 [ ] + 三段式 |
| tee-confidential-node 3.3 | KmsClient/LocalDevKms 已齐；缺真实 KMS | 存在但不覆盖真实客户端 | 保持 [ ] + 三段式 |
| tee-confidential-node 3.12b | 配对模块决策中立；方案未定稿 | 不存在（医院/合规决策） | 保持 [ ] + 三段式 |
| tee-confidential-node 4.1 | evaluateKeyRelease + collateral 判据已齐；缺真验 quote/取料 | 存在但不覆盖真实信任根 | 保持 [ ] + 三段式 |
| tee-confidential-node 4.2 | LocalDevKms SM2 封装已齐；缺真实保管/退出即失效 | 存在但不覆盖部署强制 | 保持 [ ] + 三段式 |
| tee-confidential-node 4.3 | D-TEE-1 + platform-no-key-access；两种模式未实现 | 存在但不覆盖归属落地 | 保持 [ ] + 三段式 |
| tee-confidential-node 8.5 | 分块用例+离线工具已齐；缺带链真跑 | 存在但不覆盖整跑演练 | 保持 [ ] + 三段式；废「内存态」旧稿 |
| tee-confidential-node 9.2 | 仅标题，无演练记录 | 不存在（需真实机/KMS 部署） | 保持 [ ] + 三段式 |
| tee-confidential-node 9.3 | 仅标题，无演练记录 | 不存在（需两院实部署） | 保持 [ ] + 三段式 |
| tee-attestation-pilot 1.1 | design P1 候选矩阵 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 1.2 | 公开机型已补；开通/采购/可达性未完 | 存在但不覆盖须申请项 | 保持 [ ] + 三段式 |
| tee-attestation-pilot 1.3 | 真实 quote 打通 | 不存在（未拿到机器） | 保持 [ ] + 三段式 |
| tee-attestation-pilot 1.4 | design P4 离线路径 + collateral 判据 | 存在且覆盖（残余②是运维） | 保持 [x] |
| tee-attestation-pilot 1.5 | mapVendorQuote + pilot-harness + c2-session 换链 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 1.6 | D-TEE-3 推断版 | 存在且覆盖（已标未实测） | 保持 [x] |
| tee-attestation-pilot 2.1 | 合成数据无跨院主体 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 2.2 | 亚组数据现成 / 非能力增量 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 2.3 | design P2 + c2-session 闭环 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 2.4 | 四条硬前置清单 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 2.5 | 与 confidential-node 排期对齐 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 3.1 | pilot-harness + pilot-tee + anchorChainHead | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 3.2 | verifyAttestationForC2 软件级必拒 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 3.3 | 换链/换 KMS 不动调用点 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 3.4 | D9/CTL-09 无越级表述 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 3.5 | P3 发现 1–4 / 6–7 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 4.1 | DECISIONS D-TEE-3 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 4.2 | DECISIONS D-TEE-4 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 4.3 | confidential-node design/tasks 收窄 | 存在且覆盖 | 保持 [x] |
| tee-attestation-pilot 4.4 | 三闸门 valid | 存在且覆盖 | 本轮复跑仍 valid |


## 8. 归档判断

按 openspec-verify-change：两个变更的 artifacts 已齐（isComplete=true），但 tasks 未全部勾选。
**现在还不能 archive**——未勾条目是外部前置，不是漏做。归档条件应是：要么外部前置满足并勾选，要么另立「条件归档」流程（本轮未做 archive）。

可归档的含义在本任务书里是「证据诚实、未勾写清、闸门绿」。按这个口径，两个变更已经到达可交代状态。

---

## 9. 第二段（同日续）：归档可执行性实测与闸门修复

第一段的结论是「证据诚实、未勾写清、闸门绿」。但它漏问了一句：**这两个变更到底能不能被归档？**
第二段把这一步做实，结论是「原先不能」——不是任务没做完，而是**归档这个动作本身会把 `pnpm test` 弄红**。

### 9.1 归档顺序是硬的（实跑，未动本仓）

把 `openspec/` 整份复制到临时目录跑 `openspec archive`：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 先归档本变更 | `openspec archive tee-confidential-node --yes` | **被拒**：`local-plan-review: target spec does not exist; only ADDED requirements are allowed for new specs` / `Aborted. No files were changed.` |
| ① 先归档上游 | `openspec archive mdop-kernel --yes` | `+40 / ~0 / -0`，`Specs updated successfully.` |
| ② 再归档本变更 | `openspec archive tee-confidential-node --yes` | `+24 / ~2 / -0`，成功 |
| ③ 归档试点 | `openspec archive tee-attestation-pilot --yes` | `+4 / ~0 / -0`，成功（只 `ADDED` 一张新能力，独立） |

原因：本变更的 `local-plan-review` / `node-artifact-lifecycle` 是 `## MODIFIED Requirements`，
被改的需求只存在于 `mdop-kernel` 的 `## ADDED Requirements` 里——**上游不先归档，本变更无法归档**。

### 9.2 闸门原先扛不住归档（本轮发现并修复）

`scripts/check-c2-traceability.mjs` 只认未归档路径，三处：

1. 表路径写死 `openspec/changes/tee-confidential-node/traceability.md` → 归档后**表找不到**；
2. 上游场景只从 `openspec/changes/<变更>/` 收集（`archive` 被显式过滤）→ `mdop-kernel` 的
   **22 条上游追溯记录全变「孤儿」**（报「spec 里没有这个场景」）；
3. id 前缀白名单只收未归档目录名 → 归档后 `mdop-kernel/…` 前缀报「不是任何已知变更」。

即：**归档 = 闸门变红 = 永远到不了「可归档」**。已修复为「active 优先、回退 `archive/<日期>-<名>/`」，
上游 id 用逻辑名（去日期前缀）故归档前后 id 不变；找不到或同名归档有多份一律报错（fail-closed）。

### 9.3 证据

- 新增 4 条归档布局自检（`scripts/check-c2-traceability.test.mjs`）：**修复前 2 条是红的**（归档后布局
  0-error、同名两份归档 fail-closed），修复后该文件 13/13 绿；合计负例自检 **26/26**（原 22/22）。
- 真仓代码 + 三步归档后的 `openspec/`（symlink 拼临时根）复跑：
  **0 error（104 个场景 / 上游 22 / 104 条记录）**，与归档前逐项相同。
- 本仓**未执行归档**：任务尚未全勾（80/90、18/20），且归档是发布动作，须由人确认。

### 9.4 仍然未完成的（未变）

12 条未勾仍是外部前置（真实证明链与真实 KMS、KMS 归属决策、假名键取向、带链锚定的整跑与两院演练、
CTL-29 转正、pilot 采购/审批与真实 quote）。**仓内已无剩余可推进项**——本轮补掉的是「归档路径本身」
这一条，它是前置条件，不是任务勾选。

### 9.5 第三段：归档后四道机检全扫 + runbook 定稿（实跑）

镜像做法：临时根里 symlink 真仓的全部顶层条目，只把 `openspec/` 换成**三步归档后**的副本、
`scripts/` 用真副本（`check-meta-docs.mjs` 的 `ROOT` 由脚本位置推导，必须用副本才能在镜像里跑）。

| 机检 | 归档前 | 归档后（改引用前） | 归档后（改引用后） |
|---|---|---|---|
| `check-meta-docs` | 0 error / 14 warn | 0 error / **16** warn | 0 error / **14** warn |
| `check-c2-traceability` | 0 error · 104/22 | 0 error · 104/22 | 同 |
| `check-protocol-error-codes` | 0 error · 25 | 0 error · 25 | 同 |
| `check-tee-claims` | 0 error · 981 | 0 error · 981 | 同 |

新增的 2 条警告就是 `ARCHITECTURE.md` 里对该变更路径的两处引用
（`openspec/changes/tee-confidential-node`、`…/traceability.md`）。把它们改指
`openspec/changes/archive/2026-09-26-tee-confidential-node/…` 后，警告**精确回到 14 条且与基线
逐条相同**（`diff` 输出为空）。**归档 runbook（已实测）**：

1. `openspec archive mdop-kernel --yes`（上游必须先归档，否则本变更被工具拒）
2. `openspec archive tee-confidential-node --yes`
3. `openspec archive tee-attestation-pilot --yes`
4. 把 `ARCHITECTURE.md` 里那两处引用改指 `openspec/changes/archive/2026-09-26-tee-confidential-node/…`，
   并把「变更已立」的措辞改成已归档

注意：警告不参与退出码，所以第 4 步不做也**不会**让 `pnpm test` 变红——但它会让元语里留下两个指向
不存在路径的引用，属该做未做。

### 9.6 对外表述缺口：`docs/医院端数据流转流程-v2.md` 的「全链国密」（本轮发现，**未擅自改**）

事实（逐条核过）：

| 该文档的说法 | 仓库事实 |
|---|---|
| 4 处「全程国密 / 全链国密」（第 4、99、158、173 行） | **D8 的 2026-09-26 落地补注第 ③ 条**：对外表述 MUST NOT 声称「全链国密」或「国密信封」（因 C2 信封载荷是 AES-256-GCM 的临时偏离） |
| 「通道：SM2 密钥协商 + **SM4 加密**」（第 4 行） | 连接器↔中心通道是 `secure-channel.service.ts` 的 **SM2 加密 + SM3 完整性 + SM2 签名**（无密钥协商、无 SM4） |
| 「**SM4-GCM** 加密」（第 99 行） | **全仓没有 SM4-GCM**：SM4 仅用于静态列加密 / KEK / LoRA 载荷，且都是 CBC；C2 信封载荷是 AES-256-GCM（`seal.ts#aeadSeal`） |

时间线：该文档最后提交 **2026-09-07**，**早于** D8③（2026-09-26）——所以它是**陈旧**，不是明知故犯。

**处置：只登记、不擅自改。** 这份文档面向医院信息科 / 安全审计，是**对外承诺**，改它的口径是
医院/合规措辞决策（也正落在本目标自己划出的「医院与合规决策」之外侧），不该由 agent 单方面改写。
**建议改法**（供人确认）：`全程国密` → 「身份与签名为国密（SM2/SM3），通道为 SM2 加密 + SM3 完整性」；
删去「SM4 加密 / SM4-GCM」；并在结论处加一句如实边界「C2 信封载荷的 AEAD 当前为 AES-256-GCM，
收回条件见 D8 落地补注」。

**为什么不加成机检（R4）**：D8③ 与协议里的**禁止句本身就含这些短语**（`MUST NOT … 「国密信封 / 全链国密」`），
`openspec/…/mdop-protocol/spec.md:9`、`tasks.md` 与 `DECISIONS.md` 同理；schema 夹具还把 `"SM4-GCM"`
当样例值用（`packages/mdop/src/schema/data-envelope.spec.ts:13/37/80`）。粗正则要么把**禁止句自身**判红，
要么需要易碎的否定语境解析——两条都违反 `check-tee-claims` 自己写下的取舍原则
（「要么形同虚设，要么把合法代码判红」）。故此处**不加规则**，靠人 + 本段台账。
另：实现侧的「`cipher` 必须如实写实际算法名」（D8①）**已经有机器判据**——
`apps/connector/src/mdop/operators/seal.spec.ts:44` 断言 `envelope.payload.cipher === 'AES-256-GCM'`，
不需要补。

### 9.7 第四段：红线 1 的「声称的守护」补成真守护（同一类缺陷，第二个实例）

第 3 段顺着「已勾任务里还留着什么」往下查，落到一条**契约自己承认有守护、但守护不存在**的条目。

**事实**：`TRUST.md` 红线清单第 1 条（`sm-crypto` 引用白名单）写「守护：grep（v2 自动化）」。
实测——`scripts/` 无相关 grep 脚本、根目录**没有 ESLint 配置**、`.husky/pre-commit` 只跑 `pnpm lint`：

| 检查 | 结果 |
|---|---|
| 白名单里是否有守护脚本 | ❌ 无（`grep -rn "sm-crypto" scripts/` 零命中） |
| 是否有 ESLint `no-restricted-imports` | ❌ 无（全仓无 eslint 配置） |
| 生产代码实际直引 `sm-crypto` 的文件 | **9 个** |
| 契约字面允许的 | **3 个**（控制面 2 + 连接器 1） |

9 个里的 6 个落在**合法但契约没写**的入口上（`packages/mdop/src/crypto/{sm2,sm3}.ts`、
`packages/wasm-algorithms/scripts/wasm-utils.mjs`、`gm-crypto.service.ts`、`chain.adapter.ts`、
`apps/connector/src/domain/sm3.ts`）；另外 **3 个控制面文件是字面之外的直引**
（`common/canonical-json.ts`、`runtime/participant-identity/platform-key-store.ts`、
`runtime/rws-orchestrator/rws-orchestrator.service.ts`）。难怪守护没写出来——照字面写，第一天就是红的。

**处置（本轮已落地）**：

1. 新增 `scripts/check-crypto-imports.mjs`：白名单（每条带「为什么这处可以直接引」的理由）+
   **在册偏离**（每条带偿还方向）+ 三条判据 —— R1 未登记直引即红；R2 **在册偏离还清后仍留在名单里也判红**
   （防名单变成永久豁免）；R3 名单条目路径不存在判红。注释行、`*.spec.ts`/`*.test.ts`/`__fixtures__/`、
   `*.d.ts` 不计入（测试与夹具不是信任路径）。
2. **挂进 `pnpm test`**（`check:crypto` 亦可单跑）+ 6 条负例自检（`scripts/check-crypto-imports.test.mjs`）。
3. `TRUST.md` 红线 1 改成实话：写出真实白名单、写出实机检脚本名、写出在册偏离与更正说明
   （原先那句「守护：grep（v2 自动化）」被点名作废）。`docs/tech-debt.md` TD-5 **扩项**登记这 3 处。
4. **没有**把这 3 处悄悄写进白名单当合规——按本仓既有做法（D8 对 C2 信封 AEAD 的处理）登记为偏离，
   且让它们在还清后必须从名单里消失。

**证据（实跑）**：

```
真仓：      check-crypto-imports: 0 error(s)（扫描直引 9 个文件：白名单 6 / 在册偏离 3）
注入探针：  未登记直引：apps/api/src/__guard_probe__/probe.ts（第 1 行）… → exit 1
移除探针：  check-crypto-imports: 0 error(s)（扫描直引 9 个文件）→ exit 0
自检：      scripts/check-crypto-imports.test.mjs 6/6；四道机检负例自检合计 26/26 → 32/32
其余闸门：  check-meta-docs 0/14 · check-c2-traceability 104/104 · check-protocol-error-codes 25/25 ·
            check-tee-claims 0（981 TS）· governance:negative 2/2 · pnpm governance 全部通过
```

**这是同一个缺陷类的第二个实例**：第 1 段修掉了 trace 闸门对归档路径的错误假设，本次修掉的是
「红线声称有守护、守护不存在」。两者都不是任务没勾，而是**判据本身不成立**——在这类项目里，
后者比前者更难被发现，因为文档读起来是安心的。

### 9.8 第五段：守护清单对账（声称的 ↔ 存在的 ↔ 真被跑的）

补完红线 1 的守护之后，把「守护」整体对账一遍——**两侧都查**，因为两类坏法对称：
「声称有守护但没有」与「有守护但没人跑」。

**（一）存在但没人跑？→ 无。**

| 脚本 | 被谁跑 |
|---|---|
| `check-meta-docs` / `check-c2-traceability` / `check-protocol-error-codes` / `check-tee-claims` / `check-crypto-imports` | 根 `pnpm test` 逐个 |
| 上述 4 份负例自检（`*.test.mjs`） | 根 `pnpm test` 的 `node --test` |
| `scripts/governance/negative-verify.mjs` | 根 `pnpm test` |
| `packages/wasm-algorithms/scripts/check-reproducible.mjs` | 该包 `test` → `pnpm -r test`（其 README 写「挂进根 `pnpm test`」**属实**） |

**（二）声称但不存在？→ 除 §9.7 已修的红线 1 外，没有第二处。** 十份元语/指针里点名的守护逐条对过
（TRUST 4 处点名脚本、DOMAIN/FLOWS/DECISIONS/ARCHITECTURE/AGENT/EVIDENCE/REGULATORY 指向
`check-meta-docs`、ARCHITECTURE 指向 `check-protocol-error-codes`、AGENT-OPS 指向 `pnpm governance`）。
`AGENT-OPS` §7 的 `X-1`…`X-6`（L2 放行无时间戳、迁移不可变无守护、fail-closed 削弱判定、血缘
append-only 只对已提交生效、密钥入库无 secret scanner、预算无运行时强制点）是**如实登记的
「无机器守护」缺口**，每条带失效条件——登记齐全，不是漏项。

**（三）本轮真正抓到的：入口指针自己漂了。** `AGENTS.md` 写「三者与**三个**专用守护
（`check:tee` / `check:trace` / `check:errors`）全部挂在 `pnpm test` 里」——两个问题：

1. 数量过期：§9.7 刚加了第 4 道 `check:crypto`（这正是工厂判据 **AG-3「写数字的文档注定漂移」**
   要防的事，而这句话就是活例）。
2. 事实不符：`pnpm governance`（工厂 schema 对拍）**并不在** `pnpm test` 链里，链里只有
   `governance:negative`；文档却说「全部挂在里面」。

**处置**：① `AGENTS.md` 去掉数量、列出四道守护、并声明「清单以 `package.json` 的 `test` 链为准」——
把「写死清单」换成「指向权威源」，下次增减守护不会再漂；② `package.json` 的 `test` 链**补上
`pnpm governance`**（耗时约 20ms），让那句话变成真的，而不是把文档改成将就现状。

**证据（实跑）**：

```
pnpm governance → ✓ AGENTS 入口指针：7 本元语指针可解析 · 无数字断言 · 无契约段
                  ✓ governance: 全部通过
新链条重跑根链 → meta 0/14 · trace 104/104 · errors 25/25 · tee 0（981 TS）· crypto 0（9 文件）
                  自检 32/32 · pnpm governance 全部通过 · 负向验证 2/2
完整 pnpm test → 退出码 0
```

**这一段的收束**：可以停在这里了——「声称的守护」已无假项，「存在的守护」已无漏跑项，
剩下的 `X-1`…`X-6` 与 12 条未勾任务是**明确登记、带失效/解锁条件**的已知边界，不是隐藏缺口。

### 9.9 第六段：把最后两个没跑过的闸门跑了（build / lint），并拆掉一处死配置

前几段跑的是 `pnpm test` 链与治理闸门；这一段补跑另外两处。

**（一）`pnpm build` → 退出码 0**（`pnpm -r build`：`nest build` ×2 + `next build` + `tsc` ×3）。
即当前工作树**可构建**，不只是测试绿。

**（二）`pnpm lint` 此前过不去 —— 现已拆掉唯一的人工项。** `pnpm lint` 是 husky `pre-commit` 的**唯一**一步
（`pnpm -r lint` → apps/api 与 apps/web 的 eslint）。apps/api **只读**实测（**故意不加** `--fix`——
那会把工作区里正在改的约 50 个文件一起重排）：

| 项 | 值 |
|---|---|
| eslint 退出码 | **1** |
| errors / warnings | **1236 / 53**，分布在 **51** 个文件 |
| 其中 `prettier/prettier` | 1235（**可自动修复**） |
| 其中不可自动修复 | **1** —— `src/mdop/mdop-jobs.spec.ts:306` `@typescript-eslint/no-var-requires` |
| 出错文件里有改动的 | 50–51 / 51（即**全部来自这次未提交的 WIP**，不是存量腐化） |

后果：脚本带 `--fix`，但**修完仍剩那 1 条 error ⇒ 退出码 1 ⇒ pre-commit 永远过不去**（`--no-verify`
成了唯一出路）。**处置**：把 `const { validateEdge } = require("@medtrust/mdop")` 改回**顶层具名导入**
（该文件本就 import 了同包的 `computePlanHash/fragmentHash/sm2Sign`；`validateEdge` 由
`export * from "./label/lattice"` 导出），一处 1 行改动。

**证据**：`eslint --fix-dry-run`（应用修复但**不写盘**）→ **退出码 0、剩余 0 error**（53 warning）；
该 spec 单跑 **14/14 通过**。

**没有代跑 `--fix`**：其余 1234 条 prettier 全部可自动修复，但 `--fix` 会把这次 WIP 的 50 个文件
一起重排——那是用户对自己 diff 的取舍，不该由 agent 替做。**建议**：在你自己确认的时刻跑一次
`pnpm lint`（它会让 api 侧格式化归位并退出 0）。

**（三）死配置 `apps/api/.eslintrc.json`（已删）。** `apps/api` 同时存在两个 eslintrc，
而 ESLint 同目录只认一个，按固定顺序 `.js` > `.cjs` > `.yaml` > `.yml` > `.json`。
`eslint --print-config src/main.ts` 实证**生效的是 `.eslintrc.js`**：

| 规则 | 生效值 | 说明 |
|---|---|---|
| `@typescript-eslint/no-unused-vars` | `["warn", {argsIgnorePattern:"^_"}]` | `.js` 值；`.json` 写的是 `"off"` |
| `prettier/prettier` | `["error"]`，且插件含 `prettier` | 只有 `.js` 的 `plugin:prettier/recommended` |
| `no-prototype-builtins` | **未设置** | `.json` 里 `extends eslint:recommended` 才会设它 |

即 `.eslintrc.json` 的**每一条都不生效**（`unused-vars: off`、`ban-ts-comment: off`、
`no-require-imports: off`、`no-prototype-builtins: off`）。此时尤其危险：想静音那 1234 条 prettier 错误，
最自然的动作就是去改 `.eslintrc.json` 关掉 `prettier/prettier`——**改了不会发生任何事**。
已删除该文件（全仓无人显式引用；内容可用 `git show HEAD:apps/api/.eslintrc.json` 取回）；
删除后 `--print-config` 仍解析到 `.js`、单文件 lint 退出码 0、`fix-dry-run` 仍 0 error——**行为零变化**。
若本意是那套更宽松的规则，应当改的是 `.eslintrc.js`（或迁到 flat config），不是 `.json`。

**这一段的收益**：闸门清单里最后两个没验过的（build / lint）都验了；`pnpm lint` 从
「即使自动修复也过不去」变成「自动修复后能过」；一个会误导人的死配置被拆掉。
仍留给人的是「要不要真的跑 `--fix` 重排 WIP」——这是取舍，不是缺陷。
