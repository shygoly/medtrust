# TEE 可信空间节点（C2）实施任务

> 目标：打开 MDOP 的 C2 通道，让可信空间节点成为一等节点；把「数据出域」换成「密文出域 + 只在被证明过的代码里解密」。
> 边界（贯穿全程，写进文档与合约，不得含糊）：**C2 MUST NOT 表述为「数据没有出医院」**——换的是信任锚
> （CPU 厂商证明根 + 代码度量 + 运营方 + KMS 释放策略），合规定性变成**委托处理/数据出域**，
> 且内存访问模式侧信道不在 TDX/SEV-SNP 防护范围内。

## 1. 治理先行

> **元语分工（本仓铁律）**：能进正册的条款必须有**可被抓住的 enforcement**。校验器对本仓的要求是：
> DOMAIN 覆盖表要与 `@Entity` 全表对拍、FLOWS 的 actor 必须真实存在、TRUST 的 control 块必须给出
> 存在的 enforcement 符号与 spec 路径。因此**涉及尚未落地组件的元语条目与代码同步落地**，提案阶段
> 只做「不依赖代码符号」的部分——否则等于把契约降级成作者建议（ARCHITECTURE §11 铁律）。

- [x] 1.1 修订 DECISIONS.md（**不依赖代码，已完成**）：
  - **D-MDOP-6** 加「落地补注（2026-09-25）」：登记开启方向与三条硬前提（运营方与密钥释放权分离 /
    节点内强制预算与发布审查 / 不得表述为「数据没出医院」），并**明确开关仍未打开**，须与内核代码同步翻转；
  - **D9** 加「落地补注」：口径分两类——院内连接器仍 `software`，可信空间节点落地后为**硬件证明**
    （标注 `csv` / `tdx` / `sev-snp` 与 TCB），且「设计已定」不等于「已具备」；
  - 新增 **D-TEE-1**（运营方与密钥释放权分离，含释放判据与失败错误码）与 **D-TEE-2**
    （查询预算、DP 与发布审查在节点内由被测代码强制）。
- [x] 1.1b **D-MDOP-6 的开关翻转**（**本轮完成，与内核代码同批**）：把「一律报 `E_CAPABILITY_MISMATCH`」
  改为「目标节点证明有效才可放置」。三条前提同时就位后才提交，本轮逐条核对：
  ① 编译器 C2 分支 `packages/mdop/src/label/lattice.ts#validateEdge`（目标未通告 `tee` 或不在合约
  `attestation_policy` 内即拒）、平台放置判定 `apps/api/src/mdop/mdop-jobs.service.ts#MdopJobsService`
  （`assertC2Target` → `MdopAttestationService#assertUsableForC2`）；
  ② 节点能力通告 `apps/connector/src/tee-node/providers.ts#nodeCapabilityAdvertisement`（真跑一次证明得出，
  软件提供者恒 `tee: null`，配置写着 `tdx` 也骗不过编译器）；③ KMS 释放判据
  `packages/mdop/src/attestation/release.ts#evaluateKeyRelease` 与凭据核对 `attestation/kms.ts`。
  **翻转的是判定方式、不是能力**：无硬件节点时无人通告 `tee{kind}`，C2 边仍被拒；「软件实现不得作为
  C2 目标」由三处独立保证（`attestation/push.ts` 只收硬件链型 / 能力通告取自真跑证明 / 连接器
  `capabilityAdvertise` 恒 `tee: null`）。元语同批落地：DECISIONS D-MDOP-6「开关翻转（2026-09-26）」补注、
  ARCHITECTURE §2/§3/§9、TRUST P-CTL-8 现状列与补记、DOMAIN「C2 通道」状态词汇、FLOWS FLOW-MDOP-02 状态、
  `docs/architecture-overview.html`。复核：`node scripts/check-meta-docs.mjs` 0 error。
- [x] 1.2 TRUST.md（**不依赖代码，已完成**）：
  - **P-CTL-8** 现状列更新：登记变更编号、D-TEE-1/D-TEE-2、方向已定而开关未开、以及**转正条件**；
  - 威胁模型摘要新增敌手面「可信空间节点（C2，待接入）」：运营方越权、伪造/复用证明、度量换版、
    TCB 过旧、用查询预算绕过出域闸、把「密文出域」说成「数据没出医院」。
  - **2026-09-26 证据审计**：本条写的是 2026-09-25 当时的 TRUST 快照（「开关未开」）。
    判定开关已由 §1.1b 翻转；现行 TRUST P-CTL-8 现状列写的是「判定开关已翻转 / 硬件与真实 KMS 未落地」。
    本条不改勾——它交付的是待接入表登记，不是开关状态。
- [ ] 1.2b **P-CTL-8 → 正册 CTL-29**（与实现同步）：enforcement 符号与 spec 路径**已齐**
  （节点证明代理 `apps/connector/src/tee-node/providers.ts#nodeCapabilityAdvertisement` /
  KMS 策略引擎 `packages/mdop/src/attestation/release.ts#evaluateKeyRelease` /
  出口守卫 `apps/connector/src/mdop/mdop-egress.ts`，各自有 spec），
  **但仍缺真实证明链与真实 KMS**（现为可插拔接缝 + 本机演练实现），故按本条自身的转正条件
  （真实实现 + §9.2/§9.3 演练）继续留在待接入表——**这不是欠债，是条件未满足**。
  - **解锁三段式（2026-09-26 补）**：
    (a) **解锁动作**：接入真实证明链与真实 KMS（§3.2/§3.3/§4.1），并完成 §9.2 单院演练与 §9.3 两院演练；
    (b) **归属方**：运维 / 硬件（证明链与机型）+ 医院 / 合规（KMS 归属书面接受，见 §4.3）+ 合规（转正决策）；
    (c) **验收证据**：TRUST.md 将 P-CTL-8 移入正册为 **CTL-29**（enforcement 符号与 spec 路径保持上列三处）；
    `node scripts/check-meta-docs.mjs` 仍 0 error；§9.2/§9.3 的演练记录（作业终态、回执链、真实 `chain_tx`）附在转正 PR。
- [x] 1.3 DOMAIN.md（**与实现同批落地**）：覆盖矩阵新增 `cp_mdop_attestation`（与 `@Entity` 全表对拍通过）；
  状态词汇新增「证明登记」「C2 通道」「封装/解封等级」三行；新增不变量 **INV-TEE-01**（平台不自己验 quote、
  校验方与度量白名单来自部署配置、历史保留、过期即拒、不伪造交易号）与 **INV-TEE-02**（软件实现不得作 C2 目标、
  C2 只能由 seal 产生、凭证冻结期望 vs 会话凭据的分工）。
  - C2 信封与查询预算账本**不是数据库实体**：信封是协议对象（`schema/data-envelope.ts`，已落地）、
    预算账本归可信空间节点组件（§3.7），因此不进覆盖面；这一点在本文里写明，避免后人误以为漏登记。
- [x] 1.4 FLOWS.md（**与实现同步，已登记**）：新增 **FLOW-MDOP-02**（封存 → 中继 → 证明与 KMS 释放 →
  节点内执行 → 只出 C3 → 销毁 → 锚定）——14 步、5 组 `dead_edge_check`，**所有 actor 都是真实存在的
  `ts:path#Symbol`**（`seal.ts#buildSealedEnvelope`、`mdop-node.service.ts#MdopNodeService`、
  `mdop-messages.controller.ts#MdopMessagesController`、`tee-node/poller.ts#pollNodeMessages`、
  `entry-guard.ts#TrustedNodeEntryGuard`、`packages/mdop/attestation/release.ts#evaluateKeyRelease`、
  `node-session.ts#TrustedNodeSession`、`publication-review.ts#NodePublicationReview`、
  `node-exit.ts#NodeExitGuard`、`tee-node/relay-receive.ts#receiveRelayedEnvelope`、
  `tee-node/witness-report.ts#reportWitness`、`node-receipts.ts#NodeReceiptChain`、
  `mdop-purge.service.ts#MdopPurgeService`、`mdop-receipt-chain.service.ts#MdopReceiptChainService`）。
  - **枚举与红线同步落地**：FLOWS 表新增 `control→node` / `node→control` / `node→kms` 三条边与
    `sealed-envelope` 载荷形态；checker 增加红线——**C2 信封只许走「持有方→控制面」「控制面→节点」
    或节点内部（仍是密文）**，解封后的明细仍受 `raw-local` 红线约束（只许 `none` / `connector→local`）。
  - 如实边界：本链的 enforcement 已落地并有用例；**C2 判定开关已翻转（§1.1b）但部署层仍为零**——
    真实硬件证明与真实 KMS 未接，节点不得通告 `tee{kind}`；流程块里已写明这一点。
- [x] 1.5 ARCHITECTURE.md（**不依赖代码，已完成**）：§3 的 C2 段落补「变更已立、设计已定、
  **代码未落地、开关未打开**」的进展说明；适用性对照仍以协议 §4.5 为权威，架构侧只指路。
  - **2026-09-26 证据审计**：本条是 2026-09-25 的架构快照；现行状态由 §1.5b 覆盖
    （放置改判证明登记；无硬件证明的部署里仍为零）。本条不改勾。
- [x] 1.5b ARCHITECTURE.md 的状态切换（**本轮完成，与实现同步**）：§3 的 C2 段落由「默认关闭」
  改为「**放置改判目标节点的证明登记；无硬件证明的部署里仍为零**」（不使用「默认关闭/已打开」这种
  会被误读为能力的二值措辞——两层状态分开写），并同步 §2 决策表（C2 与可信空间节点行）与
  §9 状态总表（MDOP 编排内核行：代码层开关已翻转、部署层仍为零、真实硬件与 KMS 未接）。
- [x] 1.6 REGULATORY.md（**不依赖代码，已完成**）：扩展 **REG-08**（源数据可核查性 vs 原始数据不出域）
  —— 补「C2 使出域性质变为委托处理」这一前提变化，并指向 D-TEE-1、D-MDOP-6 与变更目录；
  不新增 REG 条目（既不重复登记同一冲突，也不增加无 spec 的条目）。
- [x] 1.7 `node scripts/check-meta-docs.mjs` 为 0 error（**最新实测：0 error / 14 warning**，
  warning 均为存量项——REG/EVD 的 spec 待补与 DEPLOY 样例键的批量漂移；见 §10 的样例键清账）。
  注：本项是**每轮改动后都要重跑**的闸门，不是一次性交付物。
  - **2026-09-26 补：TEE 表述红线从「愿望」变成机检**。TRUST 红线清单第 4 条一直写着
    「代码出现 `'hardware'` 赋值即违规（grep 守护，v2）」，但仓库里**没有这个守护**；
    而 C2 落地后那句话本身也不再成立（证明契约必须产出硬件级结论）。现在新增
    `scripts/check-tee-claims.mjs`（+ `check-tee-claims.test.mjs` 8 条负例自检），挂进 `pnpm test`，
    三条判据：① `attestationLevel` 不得写成 `hardware`（含测试）；② `level: 'hardware'` 只许在
    `packages/mdop/src/attestation/**` 与测试夹具里；③ `isolation: 'hardware-enclave'` 只许在
    证明契约 / 节点组件 / 测试夹具里。三条都只认赋值写法，类型联合与「判定是不是硬件级」的比较不误伤。
  - **同日补：让「已有的负向验证」真的跑起来**。`pnpm governance:negative`（工厂校验器的注入式负向验证，
    VC-7/VC-8/FR-3）一直存在，但**没有任何闸门执行它**——不跑的守护等于没有守护。现在：① 把它挂进
    `pnpm test`；② 给它补上**注入前的原文备份 + try/finally 回滚 + 逐字节比对**，并在启动时**自愈**
    上次中断留下的注入（此前进程被杀会把 `AGENTS.md` / `AGENT-OPS.md` 留在被注入状态，下一次基线判红、
    看起来像文档坏了）。工厂侧维度 FC/AG 各 1 条，注入 → 报红且消息命中 → 回滚 → 转绿。

## 2. 协议与 schema（`packages/mdop`）

- [x] 2.1 `mdop.env/1.0` 数据信封：schema + 解析器 + 拒绝未定义字段；`export` 字段只允许 `C3_only`（本期）。
  - 已落地：`packages/mdop/src/schema/data-envelope.ts` + `data-envelope.spec.ts`（严格解析：未知字段拒、缺 `aad` 拒、
    `export` 非 `C3_only` 拒、`min_tcb` 支持单值与按链、密文摘要须 `sm3:<64hex>`）。
  - `aad` 为本实现新增的必填字段（绑定作业 / 凭证 / 合约），协议 §9.3 已补注；
    `assertEnvelopeBinding` 给出与 AEAD 同判据的显式版本，供入口守卫解密前先拒（`E_ENVELOPE_POLICY`）。
- [x] 2.2 `seal` 算子：类别 `seal`（协议 §5.1）、机制型（`system`），把本节点 C0 封装为 C2 信封；AAD 绑定 `job_id` / 凭证号 / 合约哈希。
  - 已落地：`schema/operator.ts` 允许 `system` 承载 `seal` 类别、并放开该类别的固定等级声明；
    `label/lattice.ts` 的 `deriveOutputLabel` 实现**双向规则**——封装（C2）只收 C0、解封（C0）只收 C2；
  - 「只有 `seal` 能产生 C2」按 R4 落地为：**从非 C2 输入算出 C2 一律 `E_LABEL_VIOLATION`**；
    R1 的 join 语义保持不变（纯 C2 输入仍可传递）。协议 §4.2 R4 已补注这两条。
  - 注：原稿写的「类别 `local`」与协议 §5.1 不符，已按协议改为 `seal` 类别（实现形态 `system`）。
- [x] 2.3a 契约形状（**试点已落地**）：`attestation_policy` **复用**标签格模块既有的 `AttestationPolicy`
  （不另立类型），并扩展两项：新增 `allowed_measurements`；`min_tcb` 支持按链给出
  （`{csv, tdx, sev-snp}`）——跨链 TCB 版本体系不可互比，详见 pilot design「P3 已产出的发现」。
- [x] 2.3b-i 合约 schema（**已落地**）：`schema/contract.ts` 新增可选 `attestation_policy`
  （`tee[]` 必填、`min_tcb` 单值或按链、`allowed_measurements` 可收窄；空清单 / 未知字段 / 非字符串阈值一律拒）。
  缺省即无 C2 资格（fail-closed），且**不进规范化**——非 C2 作业的合约 canonical 与哈希不变（向后兼容，有用例）。
- [x] 2.3b-ii 策略收窄语义（**已落地**）：`attestation/provider.ts` 的 `resolveMeasurementWhitelist`——
  注册中心白名单是上限、合约只能更严（取交集）；交集为空即 `E_MEASUREMENT_NOT_ALLOWED`，
  **不得退化成「不限」**。三处（编译期 / 复核 / KMS）调同一函数，避免各算一遍。
- [x] 2.3b-iii 平台侧接入（**已落地**）：`MdopContractTerms.attestationPolicy`（`packages/database`）+
  `buildMdopContract` 透传（camel → snake 映射，只在声明了 C2 时写键）+ `MdopOfferOptions.attestationPolicy`
  （要约时可声明）。三条用例：未声明时条款里不出现该键（**非 C2 合约哈希与升级前一致**）、声明后进入规范化
  且可被协议解析器回读、非法条款（空链型清单）在规范化后即被拦。
  - 合约页的可编辑入口归 §7.1（前端）。
- [x] 2.4 C2 边校验补齐（**已落地**；原条目与下方同号条目已合并，避免同一件事两处状态）：
  - **协议核心**：`label/lattice.ts` 的 C2 分支（能力 + 合约证明策略）+ `attestation/provider.ts` 的
    `verifyAttestationForC2`（级别 / 链型 / 验签 / 有效期 / 度量 / TCB 三层错误码），
    本轮又加了两条：**证明报告必须带一次性公钥**、**给了期望节点就必须身份绑定一致**。
  - **调用点**：编译器（§5.2 `MdopJobsService.assertC2Target`）与连接器出口/复核（§6.1/§6.5）各自调用同一套判据；
    节点侧入口守卫另有「本节点实际链型 vs 合约允许范围」的独立核对（不采信信封自述）。
  - **正反例合并**：未声明 C2 的作业出现 C2 边/投递 → `E_CAPABILITY_MISMATCH`；证明过期 → `E_ATTESTATION_FAILED`；
    度量不符 → `E_MEASUREMENT_NOT_ALLOWED`；TCB 过旧 → `E_TCB_TOO_OLD`。节点层再跑一遍见 §8.1。
- [x] 2.5 执行凭证扩展：签署内容增加执行环境期望；校验函数同步（含「凭证与节点实际会话证明一致」）。
  - 已落地：`TicketCore.attestation`（可选）= **按节点**存放的 `{ [node]: {tee, measurement, min_tcb?} }`
    ——各持有方签署的**代码身份与策略**（按节点存放是必须的：一份作业可能落到多个可信空间节点，
    各节点链型与度量可以不同，共用一个对象会逼它们用同一份期望）；
    要约时冻结、作业期间不变；**逐次会话的 quote 摘要不进凭证**（每次重新证明都会变），放在 KMS 的会话释放凭据里。
  - `attestation/execution.ts` 的 `verifyC2Execution` 把三者对起来：实际证明过策略 → 与凭证期望同链型同度量、
    TCB 达标 → 释放凭据签名有效、归属本作业、与本次证明同源、未过期。任一不符 fail-closed。
  - 这条「凭证冻结期望 / 会话凭据承载逐次证明」的分工是**实现期发现的**：若把 quote 摘要也冻进凭证，
    「每次会话重新证明」会与「凭证一次性冻结」直接冲突（每次执行都判不一致）。
- [x] 2.6a 错误码（**试点已落地**）：复用既有但从未被使用的 `E_ATTESTATION_FAILED`（承载「证明不可信/验签不过/已过期」），
  新增 `E_MEASUREMENT_NOT_ALLOWED` 与 `E_TCB_TOO_OLD`，三者均已标注可重试性。
  - 原稿的 `E_ATTESTATION_INVALID` 与既有码同义，已全量改名，不另造近义词（死词表是债）。
- [x] 2.6b 剩余错误码（**试点已落地**）：`E_KEY_RELEASE_DENIED`（由 `evaluateKeyRelease` 使用）、
  `E_ENVELOPE_POLICY`（信封策略；正式使用随着 §2.1 信封实现落地，当前在试点骨架中已用）。
- [x] 2.7 单测（**已落地**，逐项对应到用例）：
  - 信封严格解析与篡改：`schema/data-envelope.spec.ts`（未知字段 / 缺 `aad` / `export` 非 C3_only / 版本不符 / 摘要非法）；
  - AAD 不匹配：`data-envelope.spec.ts` 的 `assertEnvelopeBinding`（换作业 / 换凭证 / 换合约 / 策略合约不一致）；
  - 未声明 C2 的作业出现 C2 边：`label/lattice.spec.ts` 既有 C2 分支用例（目标未声明 TEE 能力 → `E_CAPABILITY_MISMATCH`）
    ＋ `provider.spec.ts`「合约未允许该链型」；此外 `deriveOutputLabel` 已封死「从非 C2 输入造出 C2」；
  - 凭证与证明不一致：`attestation/execution.spec.ts`（度量换版 / 链型不符 / 凭据不同源或过期 / TCB 低于凭证下限）；
  - 策略收窄：`provider.spec.ts`「度量白名单：注册中心是上限，合约只能更严」（取交集；交集为空即拒）。
  - **度量白名单的机制如实收口（2026-09-26 补）**：规格与 design 原先写着它「来自注册中心、
    与算子清单同一套签名与吊销机制」，但本变更自己的 **INV-TEE-01** 与 DEPLOY 都写的是
    **部署配置**，代码也是配置（`MDOP_ATTESTATION_MEASUREMENTS` / `TEE_NODE_MEASUREMENTS`）——
    规格在这一处**高估了机制**。已按元语（INV-TEE-01）对齐三处措辞（spec ×2、design ×1、DEPLOY ×1），
    并把「签名化签发 + 可吊销」写进 design 的 **Non-Goals**（升级路径、另立变更，涉及清单 schema、
    长轮询投递与吊销状态机）。**落地的那部分仍然明确**：平台侧清单是上限、合约只能更严、
    交集为空即拒、节点侧空集一律拒——这些都有用例。
  - 注：本条落地当时 `packages/mdop` **145 条**全绿（当时新增 62 条）。后续任务续增后的现行数字以 §10 / 闸门实测为准，不在本条回写。

## 3. 可信空间节点（新组件 `apps/tee-node`）

- [x] 3.1 节点身份与登记（**已落地**）：自持密钥（0600）、注册只提交公钥、参与方 URN；
  与数据持有方连接器**同一套登记与心跳**（`POST /connectors/register` + `POST /connector/heartbeat`，
  证书签名头覆盖请求体），能力通告由**真跑一次证明**得出。
  - 已落地部分：会话装配以**注入**的方式使用节点身份（URN + 自持签名密钥，见
    `node-session.ts` 的 `node` 与 `node-receipts.ts` 的 `kid=公钥 SM3`）；证明报告现在带
    **身份绑定**（`AttestationReport.node`），判定侧给出期望节点时必须一致（有用例）。
  - 已落地部分（本轮）：**组件级身份**在 `apps/connector/src/tee-node/identity.ts`——
    私钥本地生成、文件权限 **0600**（组/其他可读即拒）、参与方 URN、只提交公钥；
    能力通告由 `providers.ts#nodeCapabilityAdvertisement` **真跑一次证明**得出（软件提供者恒 `tee: null`，
    硬件级报告才写 `{kind, min_tcb}` 且取自媒体本身）——「配置写着 tdx」骗不过编译器。
    用例：0600 生成/拒绝、UR→公钥自洽、通告来源。
  - 已落地（本轮）：**注册与心跳的 HTTP 接线**在 `tee-node/registration.ts`——
    `registerNode`（`POST /connectors/register`，只提交公钥 + operator 令牌；平台响应里若出现私钥字段
    立即标记为严重违约）、`sendNodeHeartbeat`（`POST /connector/heartbeat`，证书签名头
    `指纹 + 时间戳 + 对 ts:pid:bodySm3 的国密签名`，**签名覆盖请求体**），
    `mdop` 字段带能力通告。CLI：`tee-node -- register --token <jwt>` / `tee-node -- heartbeat`。
    用例 5 条（只提交公钥、私钥绝不上传、缺令牌/失败响应报错、签名头覆盖请求体且改一字节即验不过、
    无指纹拒发心跳）。
  - 如实边界：**真实链型与 `min_tcb` 仍依赖硬件**（D-TEE-3）——在接入真实证明前，通告里 `tee` 恒为
    `null`（`nodeCapabilityAdvertisement` 由真跑一次证明得出，配置写着 `tdx` 也骗不过编译器）；
    装上机器后只需换证明提供者实现，这条链不做任何改动。
- [ ] 3.2 证明代理：对接 CSV/TDX/SEV-SNP 证明链，产出「代码度量 + TCB + 一次性公钥 + 身份绑定」的证明报告；
  度量口径与注册中心下发一致（同一套哈希算法与清单）。
  - 已落地部分：**报告的契约形状**已按此补齐——`AttestationReport` 新增 `ephemeral_public_key`
    与 `node`（身份绑定），硬件实现**缺任一项即拒**（`E_ATTESTATION_FAILED`），`mapVendorQuote`
    缺项直接不产出报告；三条链的原生 quote → 同一形态的映射与用例在 `provider.spec.ts`。
  - 已落地部分（本轮）：**提供者接缝**在 `tee-node/providers.ts#createAttestationProvider`——
    `software`（开发替身）与 `hardware`（工厂注入）两条路径；未注入真实实现时**直接报错**
    （不静默降级成软件实现）；软件替身恒 `software/none`，永远过不了 C2 判定。
  - 待落地：**真实证明链对接**（出 quote → 验到厂商根 → 提取度量与 TCB）需要机器（D-TEE-3），
    实现后由部署方注入 `hardwareAttestation` 工厂即可，调用点不动。
  - **解锁三段式**：
    (a) **解锁动作**：在真实机型上实现 `hardwareAttestation` 工厂——出 quote → 验到厂商根 →
    提取度量与 TCB → 填 `ephemeral_public_key` + `node`，由部署方注入 `createAttestationProvider`；
    (b) **归属方**：硬件 / 运维（机型与证明服务可达性，D-TEE-3）；
    (c) **验收证据**：`nodeCapabilityAdvertisement` 的 `tee{kind,min_tcb}` 取自真实 quote
    （配置写 `tdx` 仍不得虚标）；`mapVendorQuote` 用真实 quote 再跑 `provider.spec.ts` 三条链映射；
    未注入时仍直接报错、不得静默降级。
- [ ] 3.3 KMS 客户端：提交「证明 + 凭证 + `key_id`」，收一次性公钥加密的数据密钥；证明有效期缺省 10 分钟，每次会话重新证明。
  - 已落地部分：客户端**接缝**与凭据核对在 `packages/mdop/src/attestation/kms.ts`
    （`KmsClient` / `KeyReleaseWarrant` / `verifyReleaseWarrant`），本机演练实现 `LocalDevKms`
    与「每次会话重新证明 + 有效期」都已进用例；节点会话在**解封前**核对凭据，跨会话重放会被拒。
  - 已落地部分（本轮）：组件侧接缝 `tee-node/providers.ts#createKmsClient`——`local-dev`（演练）
    与 `remote`（工厂注入）；未注入真实实现时直接报错。配置闸门要求 KMS 公钥来自**部署配置**
    （`TEE_NODE_KMS_PUBKEY`），缺了就起不来。
  - 待落地：**真实 KMS**（持有方自建或共管，D-TEE-1）与其密钥保管（HSM/门限/双签）；
    实现后由部署方注入 `remoteKms` 工厂即可。
  - **解锁三段式**：
    (a) **解锁动作**：部署真实 KMS 并注入 `remoteKms` 工厂（提交「证明 + 凭证 + `key_id`」，
    收回一次性公钥加密的数据密钥；有效期缺省 10 分钟，每次会话重新证明）；
    (b) **归属方**：医院 / 采购（KMS 归属见 §4.3）+ 运维（注入与密钥保管）；
    (c) **验收证据**：真实释放走同一份 `evaluateKeyRelease`；§4.4 七条负例在真实 KMS 上复跑仍拒且不回退；
    未注入时仍直接报错。
- [x] 3.4 入口守卫（**已落地**）：`apps/connector/src/mdop/node/entry-guard.ts` —— 解密前逐项核对
  信封结构（严格解析）、AAD 绑定（作业/凭证/合约）、出口形态（本期只 `C3_only`）、
  **本节点实际链型**是否在合约允许范围内（不采信信封自述）、信封策略对本地合约允许算子的覆盖
  （只能收窄不能放宽）、有效期、持有方签名（`sm2Verify` 对「去掉 `origin_sig` 的信封」规范化串）。
  任一不过即拒收并留痕；没有该持有方公钥也一律拒（fail-closed）。用例 5 条。
  - **顺带修掉一个真 bug**：`seal.ts` 的持有方签名原先**漏签 `aad`**（签的对象少了这个兄弟字段）。
    AEAD 仍能挡住解密，但「信封声明的绑定」会变成未签名字段，与「信封自带内容都经持有方签名」不符。已改为
    签「整封信封去掉 `origin_sig`」，并让测试的签名口径与守卫的验签口径一致。
- [x] 3.5 执行器（**已落地为复用**）：节点不另写执行器——沿用 `MdopStageExecutor`（`wasm`/`system` 两类语义、
  清单由注册中心签发、未加白/已吊销即拒，与数据持有方一侧同口径）。节点侧新增的是**入口与出口两侧的守卫**
  （§3.4/§3.8）与**发布审查**（§3.6），执行内核本身不重复实现。
  - 节点自己的白名单实例由装配方注入（与院内白名单同构，但内容独立）——装配代码随 `apps/tee-node` 落地。
- [x] 3.6 发布审查（**已落地**）：`node/publication-review.ts` 复用既有 `OutputGate`（minCell + 二次抑制 +
  行级/可识别内容拦截），**在节点内执行**；闸门拒放即 `E_RELEASE_CHECK_FAILED`，不做任何降级。
  抑制计数只进**节点本地审查记录**（随审计回执上报），**不进 C3 载荷**——否则抑制细节本身也被发布。
  - **DP 加噪本期未实现**：`dp` 只如实记录声明（`{mode:'none'}`），加噪与 ε 会计仍归 P-CTL-3（与 §7.3b 同源）。
  - **2026-09-26 补：把四处「高估」改成与代码一致**。本项一直写对了（「DP 加噪本期未实现」），
    但**规格、design、proposal 与协议正文**都写着「差分隐私加噪 MUST 在节点内由被测代码强制」——
    读的人会以为 ε-DP 已具备。已按代码 + TRUST P-CTL-3（待接入）对齐：规格把「发布审查 + 查询预算」
    与「ε-DP 未实现」拆成两条并要求**任何文档/界面不得把 `mode=epsilon` 读作已加噪**；
    design 把它写进 Non-Goals；proposal 与协议 §10.2 补上实现现状补注；界面侧核对无高估
    （控制台一直写「差分隐私声明」「DP 未启用」）。
- [x] 3.7 查询预算账本（**已落地**）：`node/budget-ledger.ts` —— 以「数据集 × 快照」计量（**换快照即换预算组**，
  防「换一批数据继续扫」）；`assertWithin` → 算 → `charge` 的顺序保证「拒了就不扣」；
  亚组与切点重算按 `kind` 计入并留审计流水；`detectDifferential` 对同一申请方的累计查询做最小告警实现。
  用例 3 条（超限即拒且不扣减、换快照换预算组、亚组计入 + 差分告警）。
  - **预算消耗与拒绝随签名回执上报（2026-09-26 补，规格原本只有这一句 MUST）**：此前消耗只出现在
    C3 载荷的发布审查清单里、拒绝只抛在内存里——**回执链上查不到**，而审计与结算要的正是回执。
    现在：① 成功路径的 `EXITED` 回执带 `budget{dataset,snapshot,unit,kind,cost,spent,limit}`（与 C3 清单同一口径）；
    ② 超限拒绝追加一条协议既有的 `STAGE_FAILED` 回执（含错误码与 `charged:false`，明示「一分没扣」），
    再用原异常继续上抛（失败路径与重试语义不变）。用例：`c2-session.spec.ts` 新增 1 条
    （消耗口径 + 拒绝入链 + 入链后链仍连续可验签 + 该回执可被 `parseAuditReceipt` 读回）。
- [x] 3.8 出口（**已落地**）：`node/node-exit.ts` —— C3 只放给合约接收方名单内的目标；
  **C1/C2 一律不得离开本节点**（C2 是入口形态不是出口形态）；C0 按 R5 **只能回原持有方**且记告警
  （正常链路不该出现），回别处一律拒。用例覆盖「名单外拒 / C1·C2 拒 / C0 回流允许但留痕 / C0 回别处拒」。
  - 刻意**不**与数据持有方一侧的出口守卫合并：那边判「合约允不允许送 C2」，这边判「出去的只能是 C3」，
    两份判据不同，合并会互相稀释。
- [x] 3.9 回执链（**已落地**）：`node/node-receipts.ts` —— 解封 / 执行 / 出口 / 销毁四类事件各出一条
  **节点自己签名**的回执（SM2，`kid` 为公钥 SM3 全长），`prev_receipt_hash` 成链；解封与执行两类带上
  本次证明的 `quote_digest / measurement / tcb`，使「在什么代码下处理过这份数据」可被第三方离线核验。
  `verify(jobId, publicKey)` 逐条验签并**指出断链位置**。用例 3 条（成链 + 验签 + 链头、改动后指出断点、换密钥验签失败）。
  - 2026-09-25 补齐（本轮）：**回执形状改成协议 `AuditReceipt` 本体**（`AUDIT_EVENTS` 增加
    `UNSEALED`/`EXECUTED`/`EXITED`/`PURGED`；schema 增加可选 `attestation` 与 `detail` 子对象，
    顶层仍拒未知字段），因此**平台已有的「按节点+作业收链、逐条验连续性、终态锚定链头」直接适用**，
    不必再造一种回执。产出前用 `parseAuditReceipt` **自检**（防止本地自洽、对外不合法）。
  - 上报端：`tee-node/receipt-report.ts`（`audit:${receipt_id}` 幂等）——本轮把「节点回执链也被平台锚定」
    这条链补全；用例：形状可被平台解析器读回、链头算法与平台 `chainHead()` 逐条一致、重复上报不重发。
- [x] 3.10 销毁（**已落地**）：`node/node-artifacts.ts` —— 销毁**真的删记录并丢弃载荷**（之后按句柄读取失败，
  不是打标记）；回执按顺序列出被销毁的句柄并签名；**同一幂等键重复指令返回同一份回执**
  （至少一次投递不该产出两份不同内容的回执）；另有 TTL 到期自主销毁（无需平台指令）。用例 3 条。
  - 如实边界：本实现擦除的是**节点运行时的制品表**；「内存与临时盘」的物理擦除依赖节点进程与宿主的
    部署方式（容器只读根 + 临时盘），属部署面，落地时在 §9 一并核。

- [x] 3.11 **节点会话装配（本轮新增，已落地）**：`apps/connector/src/mdop/node/node-session.ts`
  把上面各部件串成**一次**跑得起来的 C2 会话：
  `证明（每次会话重新证明）→ 入口守卫 → KMS 释放 → 解封（AAD 绑定 + 密文摘要对拍）→ 节点内执行
  → 发布审查 → 只出 C3 → 回执成链 → 销毁`。
  - 两处**可插拔接缝**（换硬件时改的是这两个实现）：`AttestationProvider`（证明提供者）与
    `KmsClient`（KMS 客户端）；另有两项由装配方注入：`unwrapKey`（在实例内用一次性私钥解密钥）与
    `verifier`（有厂商根就自验 quote，没有则依 KMS 释放凭据背书，D13）。
  - **顺序上的两处硬要求**：① 预算「先判不扣 → 算完再扣」（`assertWithin` 在解封/执行之前）；
    ② **C0/C1 制品不得进发布审查**（`E_LABEL_VIOLATION`）——等级不能靠过一遍闸门洗白成 C3。
  - 解封实现：`node/unseal.ts`（与 `operators/seal.ts` 严格对偶；本轮顺带修掉密文摘要口径——
    原先摘要的是 **base64 文本**，现改为**密文字节**的 SM3，两侧一致并有用例）。
  - 本轮还修掉封装侧一个真问题：`key_id` 的派生种子只看「作业 + 合约 + 产品 + 时间」，
    **同一毫秒内两家持有方会撞成同一把 `key_id`**（KMS 会把两条密钥记录当成一条，
    一方释放就等于替另一方释放）。种子已加上**持有方身份**，并让时间取注入时钟（确定性），
    用例断言「同一作业同一产品、两家各封一份必为两个 `key_id`」。
  - 端到端与负例：`node/c2-session.spec.ts`（两院合成数据 + 跨院配对；本条落地时 13 条，
    2026-09-26 证据审计时该文件 **16** 个 `it`/`test`，续增不改本条勾选）。
  - 边界：会话用**替身**提供者与演练 KMS 跑通的是接口与协议，**不是**「C2 已可用」；
    可部署节点组件**已落地**（`apps/connector/src/tee-node/`，见 §3.13）；真实证明与真实 KMS
    仍待落地（§3.1–3.3、§4.1–4.3）。

- [x] 3.12a **配对算子的 Wasm 模块（已落地）**：真实部署形态是注册中心签发的 `wasm` 模块
  （协议 §5.1：分析逻辑只许 `wasm`/`oci`，`system` 不许承载 `collab`），本仓已把它做出来：
  - **模块**：`packages/wasm-algorithms/modules/pairing-as/assembly/pairing.ts` ——
    **数字列 ABI**（`run(inOff, parties, n, strata, outOff)`：present/exposure/outcome/stratum 四段
    列 + 交集与逐分层计数），零能力（只导入 `env.memory`，不导入任何函数/表/全局量，不分配堆）；
    参数越界（`parties>8`、`strata>64`、负偏移）一律拒，不越界读写。
  - **决策中立的 ABI**：模块只认「已经对齐的下标与标志」，**假名键怎么对齐（共享盐 vs 跨院 PSI）
    它一行不改**——这条把 §3.12b 的方案选择与模块解耦，因此可以先做。
  - **与参考语义同源、逐字段对拍**：语义参考实现在 `packages/wasm-algorithms/src/pairing-model.ts`
    （`apps/connector/src/mdop/node/pairing.ts` 只转发，**不另存一份实现**）；
    `scripts/pairing-parity.test.mjs` 用同一组夹具比 cohortSize / exposed / outcome / both 与每个分层，
    模块与 TS 任一份改了而另一份没改即测试红。
  - **入库与可复现闸门**：`scripts/build.mjs` 扩成**多模块**（`PLATFORM_MODULES` 表驱动），
    清单里 `paired-cohort.wasm` 记录了 SM3（`575c5601…`）、字节数、编译器版本与固定编译参数；
    `scripts/check-reproducible.mjs` 对**每个平台模块**重建对拍（只覆盖平台模块——
    清单是共享的，第三方准入模块有自己的准入侧复现比对）。
  - 用例：模块对拍 3 条（逐字段一致 / 参数越界即拒 / 清单摘要与产物一致）；
    `pnpm --filter @medtrust/wasm-algorithms test` 共 60 条通过。
  - **算子声明形状随模块入清单（本轮补，修掉一个真问题）**：平台登记服务原先对每个 wasm 模块
    套同一份**默认形状**（`local` / `plain` / C0→table）——那会把「节点内协同算子」
    （输入 C2、只在 TEE 环境执行）冒充成「连接器本地统计算子」，编译器就可能把它放到医院侧。
    现在构建清单里带 `operator{id,category,environments,inputs,outputs}`，
    登记服务**优先按声明形状**建算子（没有声明的历史/第三方模块才走默认）。
    配对算子登记为 `rws.paired-cohort@1.0.0`、`category: collab`、`environments: ['tee']`、
    输入两个 `C2` 投影；用例断言声明形状优先与默认兜底两条路径。
  - 如实边界：模块已入库并**可复现**，但**尚未进各节点白名单**——白名单要等部署时按实际作业下发
    （`operator-whitelist` 的入口已就绪，属于部署动作，不是代码缺口）。

- [x] 3.12c **首个场景的编译与收集路径（已落地；节点侧两阶段执行已在 3.12d 落地）**：模块有了、策略有了，
  但「跨院配对」这个作业现在还**编不出可跑的计划**。两处具体结论（都已核对代码）：
  - **落点是够用的**：`placeStage` 的规则是「显式 `at` > 单上游节点 > 平台」，且显式 `at`
    指定的节点会照走 `assertC2Target`（合约策略 + 证明登记）。因此**只要模板把 `pair` 阶段的
    `at` 写成本场景选定的可信空间节点**，多院 C2 输入就不会被默认丢给平台——这条不需要改编译器。
    但**没有模板**：`plan-templates.ts` 目前只有 L15 一条，缺「两院 source → seal → 节点内配对」
    的模板（含 `at` 取节点 URN、`minCell`、合约号）。
  - **汇总路径缺一半**：节点的 C3 投到平台后，`MdopMergeService.mergeIfReady` 直接调
    `mergeProportionality`，它只吃 `disproportionality` 四格表——配对结果（`paired-cohort`）
    会在合并阶段抛错。要么加一个 `merge.paired-cohort@1.0.0` 收集算子（单节点交付时是
    退化情形：分层求和/透传），要么在合并服务里按分析类型分派。
  - **已落地（本轮）**：
    ① **模板**：`plan-templates.ts#buildPairedCohortPlan`（各院 `source`→`seal`、节点内 `pair`
    与 `declassify.small_cell` 都写 `at: <teeNode>`、`minCell`/`strata`/合约号透传）+ 端点
    `POST /mdop/jobs/paired-cohort`；用例断言阶段链形状、参数护栏，以及「不写 `at` 就会被丢给平台」
    这条落点规则（用 `placeStage` 直接钉）。
    ② **收集路径**：`operators/collect-paired-cohort.ts`（单一产出节点＝原样交付；多节点＝按分层
    key 求和重算，如实标注为保守口径）+ `MdopMergeService` **按投递内容分派**（不再假定一律失衡）
    + 清单处理：收集路径**原样带回节点那份清单**，不覆盖写（`withReleaseManifest` 本就拒绝覆盖）。
    ③ **顺带修掉一个真 bug**：`expectedNodes` 原先按「所有片段持有方」收齐 C3——C2 作业里持有方
    只出 C2（封存），C3 是节点出的，于是平台**永远等两院的 C3**、作业卡在 RUNNING。现在按
    「阶段里产出 C3 的节点」判定（无阶段记录的历史夹具退回旧口径）。
  - 用例：模板 3 条、收集 4 条（单节点原样交付+进 SUCCEEDED+清单随行 / 多节点求和 / 类型不一致拒 /
    形状不对拒）。
  - 节点侧**两阶段执行**（先 `pair` 再按片段跑 `declassify.small_cell`）**已在 §3.12d 落地**。

- [x] 3.12d **节点侧把「配对 → 降密」两阶段跑完（本轮落地）**：模板把 C2→C3 的降密表达成节点上的
  `declassify.small_cell@1.0.0` 阶段（与连接器同构、也是协议模型里的标准写法），节点侧现在按片段
  **逐阶段**跑完，并且**中间制品不出节点**：
  - **会话拆成三段**（`mdop/node/node-session.ts`）：`run()`＝`runStageAt()` + `publish()`，
    另有 `executeLocalStage()`。`runStage` 只到「节点内产物」为止（证明 → 入口守卫 → KMS 释放 →
    解封 → 执行 → `UNSEALED`/`EXECUTED` 回执），`publish` 负责出口那一半（记账 → 出口守卫 →
    C3 制品 → `EXITED` 回执）。**发布审查全流程只做一次**，且由**降密算子**做——若出口处再审查一次，
    第二次的 `suppressed` 会因为「已经抑制过」而算成 0，随行清单就会**少报**抑制格数（这是一个真问题，
    不是洁癖）。`executeLocalStage` 是本地输入阶段（吃本节点制品、没有解封那一步）的执行路径，
    同样**先证明再执行**并写 `EXECUTED` 回执（`detail.local_stage`），否则链上会缺掉「降密那一步
    是在什么代码下跑的」。
  - **降密算子**（`tee-node/declassify-op.ts`）：把**发布审查本身**注册成 `declassify.small_cell@1.0.0`
    的 system 算子——minCell 取「合约与参数较大值」、缺则拒、输出恒为 C3；审查记录按 `作业:阶段`
    存下，供出口造随行清单（**不放进载荷**：抑制明细是节点本地事实）。
  - **阶段派发器**（`tee-node/stage-dispatch.ts`）：有 C2 信封的阶段走 `runRelayedStage`，
    本地输入阶段走 `executeLocalStage`。**出口判据只有一条结构事实**——本阶段产物有没有**同节点下游**
    （`hasSameNodeDownstream`，取自平台编译出的片段）：有下游＝节点内中间产物，必须留在节点内；
    没有下游＝该节点的终点产出，才走审查与出口。不新增协议字段、不从消息自述取任何东西；
    片段非法即 `fail-closed`。
  - **一次阶段可吃多份封存输入**（跨院配对就是两条，持有方各一条）：`runRelayedStage` 收
    `relays[]`，**齐了才跑、一次会话解封全部输入**（一次证明、逐份释放、逐份见证）。
    `receiveRelayedEnvelope` 保留为单信封入口（既有装配与用例形状不变，`outcome.payload/label/published`
    取代原来的 `outcome.c3`：它现在也可能是「留在本地的 C2」）。
  - **出站只留一份实现**（`tee-node/c3-delivery.ts`）：句柄走控制面（`ArtifactReady`，不含载荷）、
    只有 C3 走数据面（`ResultDeliver`）；C2 与 C0 只登记句柄、不投递载荷。
  - **用例**：`tee-node/stage-dispatch.spec.ts` 7 条——第一段只留本地（C2 制品在节点制品库、
    句柄 label=C2、两条见证、**零投递**、链上是 `UNSEALED→EXECUTED`）；第二段吃节点内制品过闸门 →
    C3 → 投递 + 清单随行 + 链 `UNSEALED→EXECUTED→EXECUTED→EXITED` + 可逐条验签 + 预算**只扣一次**；
    出口判据四例（同节点下游/别处下游/无下游/片段非法）；负例三条（上游制品不在本节点即拒、
    产出 C3 却没有审查记录即拒、中间阶段产出 C3 即拒）+ 算子两例（合约与参数取大、缺 minCell 即拒）。
    既有 13 条 `c2-session.spec.ts` 与 14 条 `tee-node.spec.ts` 全绿（单阶段路径行为不变）。
  - 如实边界：这是**库级装配**（可被守护进程/CLI 调用、用例覆盖全流程），**节点守护进程的长驻循环、
    注册/心跳与平台侧的片段下发接线仍是部署动作**（§3.13/§3.14）；证明提供者与 KMS 仍为替身
    （§3.2/§4.x），因此「合成数据上端到端可跑」**不等于**「C2 已可用」；与 §3.12b 不耦合——
    假名键对齐方案未定之前，这套链路只跑合成数据。

- [x] 3.12e **节点侧阶段状态上报（本轮补，修掉一个真缺口）**：平台是**按 `StageStatus` 推进计划**的
  （成功→下游阶段置就绪并下发；失败→按错误码 30/60/120 秒退避重试最多 3 次，或把作业打成 FAILED），
  而节点组件此前**只登记句柄、投递 C3、上报见证与回执，从不报阶段状态**——于是多阶段作业会**卡在
  第一个节点阶段**：平台一直等一条永远不会来的状态，既不推进下游，也不进终态。这条不是文档欠债，
  是链路缺环；且它只在两阶段（§3.12d）真的跑起来以后才暴露出来。
  - 已落地：`tee-node/stage-status.ts#reportNodeStageStatus`（形状与数据持有方**完全同口径**：
    `job_id`/`stage_id`/`ticket_id`/`attempt`/`status`/`code`/`message`，幂等键同为
    `status:<job>:<stage>:<attempt>`——平台侧不需要为节点开特例）；`dispatchNodeStage` 把状态上报
    包在派发外面：成功在**投递之后**报（平台收到 C3 投递才合并），失败**也照报**（带错误码）再抛出，
    上报本身失败只告警、不掩盖原始错误。状态里只有摘要与等级，**不含任何制品内容**。
  - 用例：`stage-dispatch.spec.ts` 的三条负例现在都断言「失败状态已上报、但没有句柄/载荷出去」，
    两阶段主用例断言两次 `StageStatus`（`pair` label=C2、`dec` label=C3，attempt=1）的**顺序在投递之后**。

- [ ] 3.12b **可对齐假名键方案定稿（等医院/合规取向）**：跨院 PSI 或全空间共享盐，
  合规复杂度不同（PSI 不共享盐、交互式求交；共享盐构造简单但一旦泄露即跨院可链接），
  须医院接受该对齐基础设施。**在此之前**：配对只跑合成数据（合成数据里的对齐是构造出来的），
  不得据其下真实数据结论；真实数据演练（§9.3）排在它之后。
  - **解锁三段式**：
    (a) **解锁动作**：医院/合规书面选定「跨院 PSI」或「全空间共享盐」，并接受对应的泄露面
    （PSI：交互式求交、不共享盐；共享盐：构造简单、盐泄露即跨院可链接）；
    (b) **归属方**：医院 / 合规；
    (c) **验收证据**：取向写入 DECISIONS（D-TEE-4 补注或新条目）；配对模块 ABI
    （`pairing@1`）一行不改；**真实数据**演练才可启动（合成数据演练不受本条阻塞）。

- [x] 3.13 **节点组件的可部署部分（本轮新增，已落地）**：`apps/connector/src/tee-node/`
  —— 与连接器同包但**独立部署**（独立进程、独立密钥文件、独立配置；见 DEPLOY §2 的 `TEE_NODE_*`）：
  - `identity.ts`：自持身份（0600、URN、只提交公钥）；
  - `config.ts`：**两道配置闸门**——软件提供者/本机演练 KMS 需要显式开关，且 `NODE_ENV=production`
    下一律拒绝（软件隔离不是 TEE）；KMS 公钥必须来自部署配置；
  - `providers.ts`：两处可插拔接缝（证明提供者 / KMS 客户端）+ 能力通告（由真跑一次证明得出）；
  - `session.ts`：`runNodeSession` —— 跑一次会话并为**每个 `key_id`** 产出会话见证；
  - `witness-report.ts`：见证**上报端**（`AttestationReport`，节点私钥签名、幂等键含凭据摘要）；
  - `main.ts`：CLI（`tee-node -- keygen|advertise`，见 `pnpm --filter @medtrust/connector tee-node`）。
  - 用例：`tee-node.spec.ts`（本条落地时 14 条；2026-09-26 证据审计时 **17** 个 `it`/`test`）。
  - 如实边界：**打包形态**是「连接器包内的第二入口」，不是独立的 `apps/tee-node` 包；
    真实证明代理与真实 KMS 仍未落地（§3.2/§3.3）。**注册/心跳 HTTP 接线已由 §3.1 落地**
    （`tee-node/registration.ts`），本条旧稿「接线仍未落地」作废。C2 数据面传输见 §3.14。

- [x] 3.14 **C2 数据面传输（已按 design D15 选定「平台中继」并**端到端落地**）**：
  选型与边界见 design D15 / 协议 §9.6：**平台只转运不解密**（数据密钥封给节点本次会话的一次性公钥），
  平台逐项检查后转发，目标必须是本作业的片段节点。
  - **已落地（平台侧）**：`POST /mdop/envelopes`（`C2EnvelopeSubmit` → `C2EnvelopeRelay`）——
    六项检查（签名 / 合约声明策略 / AAD / **密文摘要** / 目标为片段节点 / 未过期）+ 幂等入发件箱
    + 审计只留句柄与摘要。用例 `mdop-relay.spec.ts` 6 条（含密文被换、目标越界、AAD 不符、过期、非法结构、缺字段）。
  - **已落地（持有方侧）**：`mdop-node.service` 在产出 **C2** 制品后按**复核结论里的 `c2Targets`** 中继
    （目标不猜、不从消息取；对端数 ≠ 1 则不投并留痕）；`MdopOutboundClient.relayEnvelope` 打数据面。
    用例：`mdop-node.spec.ts`「C2 制品按复核结论的对端提交中继」。
  - **已落地（节点侧）**：`tee-node/relay-receive.ts` —— 收到中继 → 跑会话 → 登记句柄（`ArtifactReady`，
    不含载荷）→ 投递 C3（`ResultDeliver`）→ 上报见证；用例断言三步顺序与载荷。
  - **已落地（节点长轮询）**：`tee-node/poller.ts` —— 用**本节点证书的签名头**拉
    `/connector/tasks/pending`（与连接器同一套认证，节点仍然只出站），取回后逐封验签 + 收件人 +
    时间窗（平台公钥来自部署配置）、按 `msg_id` 去重、只把**本节点的五类入站消息**
    （要约/凭证/C2 中继/阶段派发/销毁指令，见 §3.17）交处理器，
    `dispatchNodeMessages` 一条失败不影响其余。用例 `poller.spec.ts` 6 条（签名头/URL、伪造签名、
    收件人不符、重复投递、缺配置、派发隔离）。
    **如实边界（2026-09-25 已消除）**：原先去重表是内存态、重启后同一封可能重跑；
    现在去重表随 §3.16 的节点状态一并落盘（`tee-node/persist.ts`），重启后由 `hydrate()` 恢复。
  - **已落地（FLOW-MDOP-02 登记）**：见 §1.4（含 FLOWS 新增的三条边与 `sealed-envelope` 载荷 + 红线）。
  - 如实边界：真实硬件证明与真实 KMS 未接（§3.2/§3.3），节点侧合约副本获取另记 §3.15——
    因此这条链**只在开发替身下可复跑**，「C2 已可用」仍不成立。

- [x] 3.15 **节点侧的合约副本与验签（本轮落地）**：`tee-node/contract-store.ts` ——
  **两条签名都要过、公钥都不取自消息**：① 平台副署用部署配置里的平台节点公钥验；
  ② 持有方签名用登记在册的公钥验，且其 `kid` MUST 与条款里的 `provider_public_key_kid` 一致
  （否则「换个公钥再签一遍」就能改条款）。任一不过即拒、**不留半份副本**；
  `requireForSession(contractId)` 只从**验过的副本**取 `data_product_id` / `allowed_ops` /
  `attestation_policy` / `recipients`，没验过就拒（fail-closed）。
  - 已接线：`receiveRelayedEnvelope` 现在要求 `deps.contracts` + `deps.platformPublicKey`，
    并支持「首次随中继带来副本」——条款一律从验过的副本取，**不再由装配方手写条款**。
  - 为什么不能只验一边：只验平台副署 → 平台能替持有方「补一份」合约；只验持有方 → 无法确认
    条款经过平台副署（平台收齐各方签名那一步）。
  - 用例 6 条：两签都对→存档+取条款、平台副署换了公钥→拒且不存档、持有方指纹不符→拒、
    条款被改→拒、无副本→`requireForSession` 拒、缺任一公钥→拒。
  - 如实边界：副本的**取得路径**（复用 `ContractOffer/Accept` 还是随中继下发）由装配方定，
    判据只有本类这一份；生产取哪条路不影响判据。

- [x] 3.16 **节点本地的持久化（本轮落地）**：`tee-node/persist.ts` + `state.ts` ——
  把「回执链 / 未销毁制品 / 中继去重表」落进 `TEE_NODE_DATA_DIR`（缺省 `data/tee-node`）的
  `node-state.json`：
  - 权限与私钥同一口径：目录 **0700**、文件 **0600**；**原子写**（临时文件 + rename）；
  - 启动 `hydrate()`（回执链原序恢复、仍能逐条验签；制品句柄仍可读）、变更后 `persist()`
    （会话/销毁之后各一次）；状态文件非法**拒绝启动**，不把历史悄悄当空；
  - 去重表带 TTL（缺省 24h）清理，且**不会因为每次 persist 被续期**（续期会让清理永不生效）；
  - 导出：`tee-node -- export-receipts <jobId>` 从**节点自己的一手链**生成离线核验文件——
    重启后内存为空也能导出（这正是落盘要解决的问题）。
  - 用例 6 条（落盘权限/原子写、重启恢复+验签、TTL 不续期、非法状态拒启动、
    端到端会话后落盘+重启导出、导出文件离线工具核过）。
  - 如实边界：**状态里没有私钥、没有明文投影**（只有摘要、句柄与 C3 载荷）；
    C2 的解封明细从不进入这里。落盘目录必须挂持久卷。
  - 原缺口描述（留档）：节点组件的制品表与回执链原先都是**内存态**
  （`NodeReceiptChain` / `NodeArtifactStore` 用 Map），重启即丢：
  - 「回执链供平台锚定」这条链上，平台的副本是持久的，因此**平台侧**不受影响；
    但节点的**本地**副本是「我自己处理过什么」的第一手证据，生产必须落盘（与连接器侧的
    `MdopLocalStore` 同构：sqlite/文件 + 0600 + TTL 清理）。
  - 影响（已消除）：离线核验的输入可从节点自己导出；重启后同一封中继不再重跑（去重表已落盘）。

- [x] 3.17 **节点作为一等参与方的消息处理（本轮补，补掉链上最后一处「跑不起来」）**：
  此前节点组件只有「跑一次已装配好的阶段」的能力，**没有任何消息入口**——平台下发的
  `PlanFragmentOffer` 与 `PurgeOrder` 被长轮询如实记为「收到但暂无处理器」。这不是少一个功能，
  而是**链根本跑不通**，两处都是硬结论（都核对过平台代码）：
  - 平台 `MdopTicketService.holderNodes` = **全部片段节点**（排除平台自己），要约要收齐各方的接受签名
    才签发凭证 ⇒ **节点不接受，作业永远停在与要约阶段**，后面的中继与执行都不会发生；
  - 平台进入终态后向全部片段节点发 `PurgeOrder`、**收齐回执才进 `PURGED`** ⇒ 节点不回执，
    作业永远进不了终态（§5.5 只验证了平台侧**会**发给节点，没验证节点侧**会**回）。
  - **已落地（本轮）**：
    ① `tee-node/fragment-review.ts#reviewFragmentForNode` —— 节点侧的**九项本地复核**，只用本地输入
       （本地验过的合约副本 / 本地白名单 / 本节点能力通告），逐项对应固定错误码；跨节点输入的等级
       按**边界边**解析（本地没有对端阶段定义，`片段` 里带了全部相关边）；节点是 C2 的**接收方**，
       因此额外判「C2 边必须指向本节点」「凭证里给本节点冻结的期望必须与本节点**实际能力**相符」
       （链型 / 度量白名单 / TCB 下限，软件实现必然过不去）。与持有方复核的两处**刻意不同**：
       **预算**（节点有账本，可接受 `dp_budget`；持有方无账本一律拒）、**快照**（见下）。
    ② `tee-node/node-messages.ts#NodeMessageRouter` —— 五类消息的处理：
       要约（复核 → **节点自己签名接受** / 带错误码拒绝）、凭证（存下并**当场校验**，含快照比对）、
       C2 信封（按**已复核片段里的 C2 入边**绑定到阶段，目标不从消息猜）、阶段派发（信封齐了才执行）、
       销毁（销毁制品 + 签名回执 + 链上 `PURGED`）。
    ③ **信封与派发是两个来源、没有先后保证**：路由器做**会合**——先到的一方只登记，
       **不报 `StageStatus FAILED`**（把正常的竞态误报成节点故障会触发平台退避重试）；齐了立即执行。
    ④ **幂等**：按 `凭证:阶段` 记已执行结果，至少一次投递下重复派发返回同一结果、不再发消息。
    ⑤ `poller.ts` 的入站类型扩到五类（原字段名 `relays` 相应改名为 `messages`，
       `dispatchRelays` → `dispatchNodeMessages`，语义就是「本节点的入站消息」）。
  - **节点侧快照语义（新决策 D-TEE-5，协议 §7.5 已补注）**：持有方签的是**数据快照**；
    节点在要约时刻没有任何数据，它签的是**执行环境快照** = 将被执行的算子摘要 + 凭证冻结的期望 +
    **本节点当下的证明能力（链型 + 可信基）**。执行时用**当下**的能力重算比对：环境悄悄变了
    （固件/微码升级、救援过的机器）即 `E_SNAPSHOT_CHANGED`，作业须重新要约——宁可让人重新确认一次，
    也不让「环境变了照跑」。环境本身另有**更强**的一道：会话解封时的证明 + KMS 释放凭据
    （`verifyC2Execution`）；快照这一道是**声明层的绑定**，两道都要过。
  - 用例：`node-messages.spec.ts` 8 条——要约接受（**接受签名能被平台侧 `verifyHolderAcceptance` 验过**）、
    复核不过的六类拒绝（合约不覆盖算子 / 片段不是本节点 / 本地无覆盖副本 / 用途不符 / 跨节点 C0 边）、
    C2 期望对不上能力（软件实现恒 `tee: null`、换链型、度量不在白名单、合约允许但本地未加白）、
    未复核的凭证即拒 + 环境漂移即 `E_SNAPSHOT_CHANGED`（**拒了就一步没执行**）、
    两种到达顺序的会合（派发先到 / 信封先到）、同一持有方第二份不同信封即拒、
    销毁回执可被平台解析器读回 + 重复指令同一份回执 + 链上出现 `PURGED`。
  - 如实边界：**节点守护进程的长驻循环（注册/心跳/轮询调度）仍是部署动作**——本轮落地的是
    「拿到消息就能正确处置」的全部判据与状态机；证明提供者与 KMS 仍是替身（§3.2/§3.3/§4.x），
    因此这仍**不是**「C2 已可用」。

- [x] 3.12f **节点侧的 wasm 执行接线（本轮补，补掉「配对阶段在生产里一步也跑不了」）**：
  `MdopStageExecutor` 对 `wasm` 类算子要求「本节点接入沙箱执行器」，而节点组件此前**没有任何 wasm
  接线**（用例里都是自己塞一个假 runner）。真实部署下 `pair` 阶段会直接
  `E_CAPABILITY_MISMATCH`（本节点未接入 wasm 沙箱执行器）——链断在这里，而它在合成数据用例里看不出来。
  - **沙箱的调用形状由宿主判死**（`domain/sandbox/sandbox-runner.ts` + `sandbox-worker.ts`）：
    请求新增 `abi`（缺省 `table@1` = `run(inOff,n,k,outOff)`，即既有 L1.5 形状；`pairing@1` =
    `run(inOff,parties,n,strata,outOff)`）。**模块自述不作数**——形状写死在宿主这一侧；
    `pairing@1` 缺 `parties`/`strata` 时**不启动 worker**（否则 4 参调 5 参模块会「算错而不是报错」）。
    既有 L1.5 路径行为一行未改（缺省仍是 `table@1`）。
  - **宿主适配**（`mdop/node/pairing-sandbox.ts`）：投影（`encodeForModule` 的四段数字列 + 4 字节对齐的
    输出区）→ 沙箱执行 → 回填 `rws.paired-cohort@1` 载荷，并对模块输出做**不变量校验**
    （交集规模 ≤ 主体总数、逐分层 `cohort ≤ cohortSize`、`both ≤ exposed ≤ cohort`）。
    **对齐与分层留在宿主**：模块只认「已对齐的下标与标志」，键文本与分层映射不进模块——这正是 §3.12b
    决策中立的落点（共享盐或跨院 PSI 都不改模块与本文）。
  - **执行接线**（`tee-node/wasm-runner.ts` + `tee-node/executor.ts`）：按摘要从**节点本地模块库**取字节
    （取不到即拒，不现取平台）、核对阶段声明的 `op_digest` 与清单一致、显式声明 `abi: 'pairing@1'`；
    `createNodeExecutor` 一次接齐两类算子（system 降密 + wasm 配对），未接线的算子一律
    `E_CAPABILITY_MISMATCH`、不回退内置实现。
  - 用例 11 条：`mdop/node/pairing-sandbox.spec.ts` 5 条（**真字节走真沙箱**，与 TS 参考语义
    `pairIntersection` 逐字段一致含逐分层；缺 parties/strata 即拒；`parties>8`/`strata>64` 由模块拒；
    输出被改过即被不变量校验抓住；单方配对即拒）、`tee-node/wasm-runner.spec.ts` 4 条、
    `tee-node/executor.spec.ts` 2 条（配对→降密一次跑通、未接线算子即拒）。
  - 如实边界：模块字节来自节点**本地模块库**（谁把它放进去、怎么验签加白，属部署动作，见 §3.12a 的
    白名单说明）；对齐方案本身仍是 §3.12b 的待定项，本文只保证「对齐换了也不用改模块与宿主代码形状」。

- [x] 3.12g **节点侧的算子清单 / 吊销 / 模块库（本轮补，补掉「每个阶段都会被拒」）**：节点复核要判
  「这个算子在不在清单、有没有被吊销、我能不能跑」，而节点组件此前**既没有清单来源也没有模块字节来源**
  ——真实部署下每一个阶段都会以 `E_OP_NOT_WHITELISTED` 被拒（或执行时找不到模块字节），链一步也走不动。
  - **平台侧本来就在发**：长轮询批次里带 `mdopOperators`（注册中心密钥签名的清单）与 `mdopRevocations`
    （平台节点密钥签名的吊销名单）；节点的 `poller.ts` 原先**只取 `mdop` 字段**、把这两项丢掉了。
    现在把它们一并交出来（本组件只搬运，验签在 `operator-store`）。
  - **已落地**：`tee-node/operator-store.ts` —— ① 清单：严格解析 + **注册中心公钥**（部署配置
    `TEE_NODE_REGISTRY_PUBKEY`）验签，**条目摘要与清单摘要必须一致**（否则「换摘要」就能把别的字节挂上去），
    非法/签名不符的整条丢弃；② 吊销名单：**平台节点公钥**验签 + **版本单调**（回退与同版本改内容都拒，
    且采纳失败不动本地状态）；③ 执行闸门：清单缺失 → `E_OP_NOT_WHITELISTED`；wasm 且**未同步到有效吊销名单**
    → `E_REVOCATION_UNSYNCED`（与连接器同口径的 fail-closed）；摘要已吊销 → `E_OP_REVOKED`；
    **本地模块库没有该摘要的字节** → 拒（不现取平台）。system 算子只判清单。
  - **关于「白名单」**：连接器有「医院本地按摘要加白」的独立动作；节点这边**模块字节存在与否本身就是
    本地准入决定**（运维把模块放进节点才可能有字节），因此不再另设一份「平台能写」的白名单——
    平台消息能做的只有「提供清单」与「吊销」。
  - **协议与代码同批**：`E_REVOCATION_UNSYNCED` 原先只在连接器本地定义、不在协议核的错误码集合里
    （而连接器的 `PlanFragmentReject` 会把该码发给平台）——本轮把它补进 `packages/mdop` 的错误码集合
    （不可重试）与协议 §11 表，节点复核也**原样带出**这个码（与「未加白」是两种不同处置）。
  - 用例 5 条（`tee-node/operator-store.spec.ts`）：清单验签/篡改/缺公钥、吊销名单验签与版本单调、
    执行闸门四种情形（未同步/已吊销/缺字节/齐全）、system 只判清单、`TEE_NODE_REGISTRY_PUBKEY` 逐键直读；
    `node-messages.spec.ts` 追加一条：复核失败时**原样带出 `E_REVOCATION_UNSYNCED`**。
  - 如实边界：清单与吊销名单**每轮长轮询刷新**，因此只放内存、不落盘（重启后到下一次轮询之间按
    「没有有效清单」处理，fail-closed）；模块字节由运维按摘要放进节点本地模块库（放置流程属部署动作）。
    `TEE_NODE_REGISTRY_PUBKEY` 已登记进 DEPLOY §2。

- [x] 3.18 **节点进程装配（本轮补，把「每块都对」变成「整条能跑」）**：此前每一步都有判据与用例，
  但**没有进程把它们串起来**——心跳没人发、探针没人跑、长轮询没人驱动、清单与吊销没人应用、
  消息没人派给路由器。逐块都是绿的，整条链却一步不通。
  - **长驻循环**（`tee-node/runtime.ts#TrustedNodeRuntime`）：一个 tick = 到点的心跳（60s）与证明探针
    （5min，**必须短于校验方给的背书有效期**）→ 拉一次批次（长轮询 25s）→ **先应用清单与吊销再处置消息**
    （否则同一批刚到的新清单赶不上这一批的要约复核）→ 逐条交给 `NodeMessageRouter` → 落盘。
    `hydrate()` 在构造时执行；`runOnce()` 把轮询失败抛给调用方（单次可见），`start()` 的循环把它降级为
    告警 + 退避继续（网络抖动不该让节点静默离线）；心跳/探针失败只告警（它们坏了影响的是**新作业**，
    不该拖住在途作业）。
  - **生产装配**（`tee-node/assembly.ts#createTrustedNodeAssembly`）：把配置、身份、两处提供者接缝、
    清单/吊销、**参与方登记公钥表**、本地模块库、执行面（`createNodeExecutor`）、会话、路由器与循环接齐；
    **配置不全就起不来**（缺平台公钥/注册中心公钥/证书指纹即报错；软件替身要显式开关、生产环境拒绝）。
    `tee-node -- serve` 即长驻运行，收到 SIGINT/SIGTERM 先停循环再退出。
  - **参与方登记公钥表**（`tee-node/participant-keys.ts`）：节点要验合约副本与信封的**持有方签名**，
    而公钥**必须来自部署**——若随消息下来，平台就能「换公钥 + 换条款 + 补签名」让节点接受一份持有方
    从未签过的合约（用平台给的公钥验平台给的签名，循环论证）。文件形状 `{ "<URN>": "<公钥hex>" }`，
    任一条不合法即整份拒。
  - 用例 13 条：`runtime.spec.ts` 5 条（先应用清单/吊销再处置、单条失败不影响其余、心跳与探针到点才发、
    失败只告警 / 轮询失败可见、循环不因一次失败退出）；`assembly.spec.ts` 4 条（齐全即装配成功、
    三类缺配置 fail-closed、配置闸门在装配期生效、运行时配置逐键直读）；`participant-keys.spec.ts`
    4 条（合法/带不带 `04` 前缀、任一条非法即整份拒、逐键直读）。
  - 如实边界：装配仍用**开发替身**跑通（软件提供者 + 演练 KMS，需显式开关）；真实证明代理、真实 KMS
    客户端与真实数据密钥解封仍待 §3.2/§3.3/§4.x（缺省实现会以明确报错拒绝，不返回空密钥）。

- [x] 3.19 **合约副本随要约下发（本轮补，补掉「节点拿不到合约副本」）**：复核第 2 项要求「本地合约副本」，
  而可信空间节点**不是合约提供方**——平台的 `ContractOffer` 只发给提供方，节点因此没有副本来源，
  真实部署下**每一份要约都会被 `E_CONTRACT_UNSIGNED` 拒掉**（链again卡在第一步）。
  - **平台**：要约随带**已双签的合约副本**（`mdop-ticket.service.ts#contractCopiesForOffer`：
    只带**两份签名都齐**的副本；缺签的副本不下发——那会把「合约还没签完」伪装成「节点复核失败」）。
  - **节点**：`NodeMessageRouter#storeContractCopies` 在复核**之前**收下副本，用**部署配置的平台公钥**
    验副署、用**参与方登记公钥表**验持有方签名（且其 kid 必须等于条款里的 `provider_public_key_kid`），
    验不过即整条丢弃；副本缺失或签名不全**不算错**，由复核第 2 项按「本地没有可用副本」拒（两处判据独立）。
  - 用例：`node-messages.spec.ts` 新增 1 条（不预置副本时，随要约带来的副本被验签存档、复核通过；
    副署被换成别的签名 → 副本丢弃 → 复核以 `E_CONTRACT_UNSIGNED` 拒）；`mdop-jobs.spec.ts` 的 C2 要约
    用例新增断言（要约体里带 `contracts` 且两份签名非空）。
  - 协议 §7.4 已补注（复核用的合约副本从哪来），如实边界：副本仍由平台**转发**，但节点**只采信自己验过的签名**。

- [x] 3.20 **C2 首个场景的**单进程端到端**用例（本轮补，一次跑通整条链并抓出两处真 bug）**：
  `apps/api/src/mdop/c2-conformance-e2e.spec.ts` —— 平台侧跑**真实实现**（真实控制器/服务 + 仓库替身），
  两院与可信空间节点按协议扮演，一条链跑完：
  **证明背书推送（D-TEE-6）→ 编译（C2 放置）→ 要约（带已双签合约副本）→ 三方签名接受 → 签发凭证
  （冻结节点执行环境期望）→ 各院 source/seal → C2 中继（平台只转运）→ 节点内 pair（C2 制品不出节点）
  → 节点内 decTee（只出 C3）→ 平台收集 → SUCCEEDED → 销毁编排（含节点）→ 收齐回执才 PURGED
  → 回执链 ingest**。
  关键断言：上游没就绪前**节点一个阶段都不会被下发**；中继落在**节点**的发件箱、平台侧 C2 只有转运记录
  （`payload === null`）；`pair`/`decTee` 同节点顺序推进；收集走 `paired-cohort` 分支且出域物里没有主体键；
  **只回两院销毁回执时作业不得进 PURGED**（缺节点回执就是没销毁完）。
  - **本用例抓到的两处真 bug（分块用例各自都过、整条链才暴露）**：
    ① 节点发出的 `ArtifactReady` 句柄**缺 `expires_at`**，而平台侧 `parseArtifactHandle` 把它列为必填
    —— 真实部署下节点每一次句柄登记都会被判 schema 非法（`c3-delivery.ts` 已补，含 `handleExpiry` 统一 72h 口径）；
    ② 节点的 C3 载荷只出 `buckets`，而平台收集方 `collect-paired-cohort` 读的是**规范分层表 `strata`**
    —— 配对作业会在收集阶段以「缺分层表」拒收（节点现在同时出规范 `strata` 与抑制输入 `buckets`，
    并让**降密算子把 `strata` 对齐到抑制后的判定**：被抑制的分层整格清零并标 `suppressed`，
    平台**拿不到未抑制的分层计数**）。
  - 如实边界：本用例里的两院与节点是**按协议扮演**的（各院/节点应用实现由 `apps/connector` 用例覆盖），
    因此它是**链路与判据的闭环证据**，不是「C2 已可用」的证据（真实硬件与 KMS 仍是 §9.2/§9.3）。

- [x] 3.21 **平台：C2 阶段下发前复检证明登记（本轮补，补掉一处「规格写了、代码没做」）**：
  规格里写着「编译通过后目标节点的证明在阶段下发前过期 → 调度 MUST NOT 下发该阶段」，
  而调度器此前**只看上游就绪与阶段状态**，从不复检证明——编译到下发之间证明过期时，平台仍会把
  `StageDispatch` 发给一个「已经不该承接 C2」的节点，等于把这道闸门放在了一个会过期的时间点上。
  - **已落地**：`dispatchReadyStages` 在 `RUNNING` 之后、入发件箱之前，对**接收 C2 的阶段**
    （上游阶段 `outputLabel === 'C2'`）调 `assertUsableForC2`（判据只有一份：链型 / 度量清单 /
    TCB 上限 / 未过期）。不可用即：**不下发** → 阶段 `FAILED`（`E_ATTESTATION_FAILED`）→
    作业走终态并按 §7.8 触发销毁编排。`TICKETED → FAILED` 在迁移表里非法，因此按
    `TICKETED → RUNNING → FAILED` 走（一次都没下发的作业也必须到终态，否则会永远停在 `TICKETED`）。
  - **fail-closed 口径**：合约服务或证明登记服务**未注入**时，接收 C2 的阶段**判不了就不下发**
    （而不是「没接服务所以照发」——那会让这条要求退化成可选项）。
  - **顺带修掉一处只有启动才暴露的坑**：新增的两个可选依赖一开始用 `import type` 引入，
    Nest 的类型元数据会退化成 `Object` → 应用启动即报「无法解析依赖」，而单元测试直接 `new` 服务
    看不出来。已改为**值导入**，并加一条元数据断言（`design:paramtypes` 里必须是值类型）钉住它。
  - 用例 3 条（`mdop-ticket-scheduler.spec.ts`）：服务缺失即不下发 + 作业 FAILED + 已发 `PurgeOrder`；
    登记有效则正常下发（`RUNNING`）、登记过期则不下发并 `E_ATTESTATION_FAILED`；类型元数据断言。
    `c2-conformance-e2e.spec.ts` 也改为注入真实服务，让这条复检在端到端链路上真的被走到。

- [x] 3.22 **节点：C0 中间制品不得出现对外句柄（本轮补，补掉一处规格场景没实现）**：
  规格「登记节点内的 C0 句柄」要求：节点内解封产生的 C0 制品 MUST 留在节点内，**MUST NOT 出现对外句柄**。
  而本地阶段的产物此前**一律**登记句柄（含 C0），等于把「这里有明细制品」这件事对外说了一次。
  - **已落地**（`tee-node/stage-dispatch.ts`）：本地中间产物只有 **C2** 才登记对外句柄
    （C2 本来就是跨节点形态，协议要求两侧都登记句柄）；**C0/C1 只留在本节点制品库**，连句柄都不登记，
   下游阶段仍按同一本地句柄取用。C3 的出口路径不变（发布审查 → 出口守卫 → 登记 + 投递）。

- [x] 3.23 **场景追溯表 + 校验器（本轮新增，把「规格写了、代码没做」变成会红的判据）**：
  本仓最容易溜过去的一类缺口，不是「某段代码写错了」，而是**规格里写了一条要求、代码里根本没有对应实现**
  ——最近三轮抓到的多处都属于这一类（节点从不回报阶段状态、C2 阶段下发前不复检证明、给 C0 中间制品
  登记对外句柄、节点拿不到合约副本……），而且**分块用例各自都是绿的**，靠人工逐条比对才发现。
  - **追溯表**：`openspec/changes/tee-confidential-node/traceability.md` —— 两个变更的**每个 spec 场景**
    （当时 `tee-confidential-node` 61 条 + `tee-attestation-pilot` 6 条 = 67 条；现行必查集合见 §3.25 / §10，**104** 个场景）各一条记录，指向
    ① 真实的 enforcement 符号（`ts:路径#符号`，支持 `Class.method`）与 ② 真实存在的用例（文件 + 标题关键词）。
    个别场景的 enforcement 本身是**一次扫描**（如「平台不得接触数据密钥」），这类记录指向那条扫描用例里的判据文本。
  - **校验器**：`scripts/check-c2-traceability.mjs` —— 逐条核对：场景必须**全覆盖且不重复**（少一条、多一条、
    标题写错都判红）；符号必须在文件里真的搜得到；用例文件里必须有标题含该关键词的 `it/test/describe`。
    `scripts/check-c2-traceability.test.mjs` 是它的**负例自检**（删记录 / 改符号 / 改关键词 / 改场景标题
    四种破坏各断言一次），已挂进根 `pnpm test`（`check:trace` / `test:trace` 两个脚本可单独跑）。
  - **它第一次跑就抓出两条真实覆盖缺口**（都已补上用例）：① `local-plan-review#合约允许 C2 但平台未给出对端`
    —— 复核里那条「C2 边的对端不在合约接收方/参与方之列 → `E_CAPABILITY_MISMATCH`」的判据**没有用例**
    （`mdop-node.spec.ts` 只覆盖了「未声明策略」「对端记入 c2Targets」「标签洗白」三条）；已补用例，
    同时断言「指向本节点自己是允许的」。② `node-artifact-lifecycle#登记节点内的 C0 句柄` —— §3.22 的规则
    当时也没有用例，已补「本地阶段产出 C0 → 只留本地、不登记对外句柄（只发 StageStatus）」。
  - 如实边界：追溯表证明的是「**每个场景都有符号与用例**」，不证明「用例足够强」——它挡的是
    「规格写了、代码没做／没测」这一类；判据本身的强度仍要靠 code review 与实机演练（§9.2/§9.3）。

- [x] 3.24 **错误码对拍（本轮新增，并修掉一处真实分叉）**：本仓铁律是「元语与代码同批落地」，
  而**错误码是最容易悄悄分叉的一处**——本轮实测发现：代码集合 `packages/mdop/src/errors.ts` 里有
  **4 个码根本不在协议 §11 的错误码表里**：`E_MEASUREMENT_NOT_ALLOWED`、`E_TCB_TOO_OLD`、
  `E_KEY_RELEASE_DENIED`、`E_ENVELOPE_POLICY`（它们在 §9.3/§9.6 的正文里被提到过，但**读错误码表的人
  ——尤其外部实现方——看不到**；§11 是正册那一面，缺行就是缺契约）。
  - **已修**：协议 §11 表补齐这 4 行（阶段 / 含义 / 可重试三列，可重试与代码里的 `RETRYABLE` 对齐）。
  - **已加校验器**：`scripts/check-protocol-error-codes.mjs` —— ① 代码里的每个码都必须在 §11 表里有行；
    ② §11 表里每行也必须在代码集合里（防死条目）；③「可重试」列必须与 `RETRYABLE` 一致
    （「视原因」按不可重试处理，不算错）。`scripts/check-protocol-error-codes.test.mjs` 是它的负例自检
    （少一行 / 多一行 / 改可重试列 / 删小节，四种破坏各断言一次），与追溯校验器一起挂进根 `pnpm test`
    （`check:errors` 可单跑）。
  - 如实边界：这条对拍保证的是**码表两侧一致**，不保证每个码在文档里的「含义/可重试」描述与实现的
    细节完全一致——那部分仍靠 code review 与用例。

- [x] 3.25 **追溯覆盖扩到上游（被本变更 MODIFIED 的既有契约）**：C2 改动不只是「新增能力」——
  它还**改了已经生效的契约**：本变更里 `local-plan-review` 与 `node-artifact-lifecycle` 两个能力是
  `## MODIFIED Requirements`（其余三个是纯 ADDED）。于是「C2 改动碰坏既有行为」这条回归面，
  只看本变更自己的场景是看不出来的。
  - **校验器自动推导上游清单**（`scripts/check-c2-traceability.mjs`）：凡本变更标了
    `## MODIFIED Requirements` 的能力，**别处（未归档变更）同名能力下的全部场景**都进入必查集合；
    id 前缀也从「只许这两个变更」放宽为「必须是真实存在的变更目录」（防变更名写错这类静默漏项）。
    现在必查集合 = 本变更 72 + 试点 10 + 上游 `mdop-kernel` 22 = **104 个场景**，全部有追溯记录
    （2026-09-26 新增四条：「存证链不可达时的锚定记录」「证明登记的上链补偿」「预算消耗与拒绝进回执链」
    「未随带材料 / 材料过期或超出离线刷新窗口」）。
  - **上游 22 条的落地**（`mdop-kernel/{local-plan-review,node-artifact-lifecycle}`）：逐条指向真实符号
    （复核 `usableContract` / 合约库 `MdopContractStore` / 凭证校验 `verifyTicketForExecution` /
    制品库 `NodeArtifactStore` / 出口守卫 / 回执链服务 ……）与真实用例。绝大多数在既有用例里有对应；
    **唯一没有对应用例的是上游 `local-plan-review#拒绝消息的内容`**（「拒绝只回错误码与一句说明，
    不带本地策略原文」，连接器侧）——已补用例：驱动 `PlanFragmentOffer` → 复核失败（本地合约已撤销）
    → 断言 `PlanFragmentReject` 的 body **恰好**只有 `{ticket_id, signer, code, message}`，
    且 `message` 里既没有撤销理由、也没有本地策略字段、长度还是一句说明。
  - 用例：`mdop-node.spec.ts` 当时 27 条全绿。追溯校验器现行数字以 §10 为准（本条旧稿「89/89」是扩表前快照，与同段「104 个场景」并存——以 104 为准）。
  - 如实边界：上游追溯证明的是「既有场景仍有符号与用例」，不证明「这段既有代码被 C2 改动影响后的行为
    仍完全正确」——真正的回归结论仍来自跑全量套件（本轮 `mdop-node.spec.ts` 与整条链的用例都跑过）。

- [x] 3.26 **C2 首个场景的失败与销毁路径（端到端，本轮新增）**：成功路径已有一条端到端
  （`c2-conformance-e2e.spec.ts`），但**熔断分支最容易「看起来对而没走到」**：作业失败后没人销毁、
  只销毁了部分节点、或没收齐节点回执就放行。新增 `apps/api/src/mdop/c2-failure-e2e.spec.ts`，
  在**同一套真实平台实现**上跑完这条分支：
  两院 source/seal → C2 中继到节点 → 节点内 pair 成功 → **节点内 decTee 失败**
  （`StageStatus FAILED` + `E_RELEASE_CHECK_FAILED`，即发布审查拒放）→ 作业进 `FAILED` 并记下拒绝原因
  → **没有任何 C3 交付物**（不静默算空集）→ 终态即触发销毁编排，**两院与节点都被要求销毁**
  → 先回两院回执时作业**仍是 `FAILED`**（缺节点回执不放行）→ 补节点回执才进 `PURGED`。
  - 顺带钉住一处协议细节：节点失败要**如实报错误码**（`E_RELEASE_CHECK_FAILED` 不可重试 → 直接失败，
    不进入 30/60/120 的退避重试），否则平台会把「审查拒放」误当成可重试的运行时抖动。
  - 用例 1 条（整条链，约 30s，跑完 6 阶段）；`apps/api` mdop 套件由 18 增至 **19 套**。
  - 如实边界：与成功路径同一口径——平台侧真实实现，两院与节点按协议扮演（模拟「被证明过的节点在
    审查不过时如实报 FAILED」）；真实硬件/KMS 仍待 §9.2/§9.3。

- [x] 3.27 **多可信空间节点（多分片）的 C2 端到端（本轮新增，覆盖收集的多节点分支）**：
  单节点场景里平台是**原样收集**一份 C3；多节点分支要求平台**按分层 key 求和并重算率**
  （`collect-paired-cohort` 的多表分支），并且**销毁要覆盖两个节点**。这一支在变更文档里被标为
  「异常/未来多分片，本场景不会出现」——因此它是**覆盖面**而不是首个场景的必经路径，
  但它一旦被用到，出错的方式很隐蔽（少收一个节点、求和口径错、只销毁其中一个节点）。
  - 形态：**四家持有方分成两组**，各自在同组两方之间配对（`pair_0/dec_0` 落节点 1、`pair_1/dec_1` 落节点 2），
    两个节点各出一份 C3，平台收集求和。`apps/api/src/mdop/c2-multi-node-e2e.spec.ts`，一条链跑完：
    编译（两节点各只拿到自己的阶段）→ 要约发给 **6 个片段节点** → 6 方签名接受 → 签发凭证
    （**两个节点各自冻结自己的执行环境期望**）→ 各院封存并**按组中继**（断言每个节点只收到本组的 2 条信封，
    没有串台）→ 两个节点各自 pair/dec → 两份 C3 投递 → 平台收集。
  - 关键断言：收集结果 `cohortSize=7`、`exposed=5`、`exposedWithOutcome=3`、`rate=3/5`，
    且分层表是**同一 key 求和**后的一行（不是两份并排）；作业 `SUCCEEDED`；出域物里没有主体键；
    销毁编排覆盖 **4 家持有方 + 2 个可信空间节点**，**收齐全部六份回执才 `PURGED`**（只回五份时仍是 `SUCCEEDED`）。
  - 顺带修掉一处用例口径问题：销毁回执的两个参数是「回执 + **平台节点**（从销毁范围里排除的那一个）」，
    我此前把「发出回执的节点」当成了第二个参数——那会让「缺回执不得 PURGED」这条断言**偶然成立**而不是真的成立。
    两个端到端用例（成功路径 / 失败路径）与多节点用例现在都按正确口径调用。
  - 如实边界：与其它端到端用例一致（平台侧真实实现，持有方与节点按协议扮演；真实硬件/KMS 仍待 §9.2/§9.3）；
    多分片这条分支的**业务触发条件**（何时才会真的把同一分析拆到两个节点）仍属设计问题，不在本任务里回答。

- [x] 3.28 **全量套件跑通 + 修掉一处存量 flaky 断言（本轮收尾）**：本轮把仓库自己的完整闸门
  `pnpm test`（= `check-meta-docs` → `check-c2-traceability` → `check-protocol-error-codes` →
  两个校验器的负例自检 → `pnpm -r test` 全工作区）跑到底，**首次运行即暴露出一个与本变更无关的存量问题**：
  `apps/api/src/security/crypto/encryption.integration.spec.ts` 的
  「should not decrypt with wrong key」在**全量 107 套**并发/顺序下**概率性变红**
  （`expect(...).toThrow()` → `Received function did not throw`），单跑该套件却全绿。
  - **实测定位**：CBC 只做 PKCS#7 填充校验、**没有完整性校验**，错密钥有一定概率恰好通过填充校验并返回乱码。
    本机实测：4000 组随机错密钥中 **32 组（0.8%）未抛错**，其中**没有任何一组还原出真正的明文**。
    因此原断言 `toThrow()` 断的是**错的属性**——它会把「实现按设计工作」判成失败，而真正的安全回归
    （错密钥还原出明文）即使不抛错也会被它漏掉。
  - **已修**：断言改成「错密钥**拿不回明文**」（抛错即记为未还原；不抛错则必须 `!== plaintext`），
    并把上面的实测数字与理由写进用例注释（谁改这一段都能看到为什么不是「断言抛错」）。
  - **如实边界（顺带登记的观察，未实现）**：`sm4Encrypt/sm4Decrypt` 目前没有完整性校验，
    错密钥可能返回乱码而不是报错。要让它**必然报错**得改存储格式（加魔数/认证标签），
    属于独立的安全加固项，不在本变更范围内；本次只修正了用例的判据。
  - **证据（本轮实测，完整闸门一次通过，退出码 0）**：`check-meta-docs` 0 error / 15 warning；
    `check-c2-traceability` 89/89；`check-protocol-error-codes` 25/25；校验器自检 10/10；
    `packages/mdop` 18 套/185 条；`apps/api` **107 套/810 条**；`apps/connector` 110 套通过（3 套跳过）/674 条通过；
    `apps/web`、`apps/connector-ml`、`packages/wasm-algorithms` 均 Done。

## 4. KMS 与密钥释放

- [ ] 4.1 KMS 策略引擎：校验「证明链到厂商根 + 度量在允许清单 + TCB ≥ `min_tcb` + 证明未过期 + 凭证有效 + 合约未终止 + `key_id` 属于本作业片段」。
  - 已落地部分：**判据引擎**就是 `evaluateKeyRelease`（一份定义，平台编排/KMS 客户端/演练 KMS 共用），
    七项逐条 fail-closed，并被 §4.4 的七条负例逐条钉住；演练 KMS 的入口在 `LocalDevKms.requestRelease`。
  - 待落地：厂商根的**真实实现**——`TrustedRoot.verifyQuoteDigest` 目前是配置侧替身；真实实现需要机器与
    证明服务可达性（§3.2）。**落地路径已在试点 design 的 P4 给出**：TDX 走 PCCS 私有化或预取 collateral
    完全离线校验；CSV 走自托管 CoCo trustee `attestation-service` + RVPS；SEV-SNP 走缓存 VCEK→ASK→ARK。
    **collateral 时效的判据已落地**（2026-09-26，P4 残余项 ①）：真实信任根用 `TrustedRootWithCollateral`
    **必须**声明「必须随带的材料种类 + 离线刷新窗口」，并用 `createHardwareAttestationVerifier` 产出
    「验 quote + 判材料时效」的校验器（缺料 / 过期 / 超窗口 / 时间倒挂一律拒 `E_ATTESTATION_FAILED`）；
    因此真实实现只剩「真去验 quote + 真去取料」这一半，**没有「忘了判时效」这个选项**。
  - **解锁三段式**：
    (a) **解锁动作**：按试点 design P4 接真实信任根——TDX 走 PCCS 或预取 collateral、CSV 走自托管
    CoCo trustee、SEV-SNP 走缓存 VCEK→ASK→ARK；`TrustedRoot.verifyQuoteDigest` 换成真验 quote + 真取料
    （时效判据已由 `TrustedRootWithCollateral` 强制）；
    (b) **归属方**：硬件 / 运维（证明服务可达性与厂商根带入台账）；
    (c) **验收证据**：§4.4 七条负例在真实根上复跑；缺料 / 过期 / 超窗口 / 时间倒挂一律 `E_ATTESTATION_FAILED`；
    §9.2 演练记录附上。
- [ ] 4.2 密钥封装：用证明报告中的一次性公钥加密数据密钥；密钥只存在于该实例内存，实例退出即失效。
  - 已落地部分：`LocalDevKms` 用 **SM2 加密到报告里的一次性公钥**（`crypto/sm2.ts` 的 `sm2Encrypt`），
    释放凭据带**封给哪把一次性公钥的指纹**；节点实例用一次性私钥解开（`unwrapKey`，私钥不出实例）。
    用例断言：只有对应私钥能解出数据密钥，换私钥解不出。
  - 待落地：KMS 侧的密钥保管与「实例退出即失效」的强制由真实 KMS/部署保证（演练实现把密钥留在进程内存）。
  - **解锁三段式**：
    (a) **解锁动作**：真实 KMS 用报告里的一次性公钥封装 DEK；实例退出后密钥不可恢复（HSM/门限由部署保证）；
    (b) **归属方**：运维 / 硬件（KMS 与宿主隔离）；
    (c) **验收证据**：只有对应一次性私钥能解出 DEK（换私钥解不出）；实例重启后旧 DEK 失效；
    写入 §9.2 演练记录。
- [ ] 4.3 归属实现两种模式：① 持有方（医院）自建 KMS；② 与运营方共管（门限/双签）。平台 MUST NOT 持有解密能力。
  - 归属**原则**已定（D-TEE-1）并有平台侧防回归断言（`platform-no-key-access.spec.ts`：解封/解包/取密钥
    路径全部禁止）；两种模式的**实现**待真实 KMS 选型（§4.1 待落地项）。
  - **解锁三段式**：
    (a) **解锁动作**：医院/合规书面选定「持有方自建」或「与运营方共管（门限/双签）」并完成采购/部署；
    (b) **归属方**：医院 / 合规 / 采购；
    (c) **验收证据**：选定模式的部署清单 + `platform-no-key-access.spec.ts` 仍绿 +
    部署审查记录写明「平台无解密能力」。未选定前不得把演练 KMS 当作任一模式的实现。
- [x] 4.4 负例测试（**已落地**，逐条断言拒绝且不回退）：`packages/mdop/src/attestation/kms.spec.ts`
  覆盖**伪造证明 / 度量换版 / TCB 过旧 / 证明过期 / 凭证过期 / 合约已终止 / `key_id` 串作业**七条；
  节点层再跑一遍（`apps/connector/src/mdop/node/c2-session.spec.ts`：伪造/过期/换版/TCB/凭证/合约终止），
  并断言**一步都没执行**（拒绝发生在执行之前）。另有用例钉住「请求方自报的密钥归属不算数，以 KMS 登记为准」
  与「改写后的凭据即便数值自洽也验不过签名」。
  - 边界：这些负例跑的是**判据引擎**（`evaluateKeyRelease`），真实 KMS 实现必须复用同一引擎，
    因此判据等价；但**真实 KMS 的集成**仍要在 §9.2 演练里跑一遍。

## 5. 平台内核（`apps/api/src/mdop`）

- [x] 5.1 `cp_mdop_attestation` 表与登记服务（**已落地**）：
  - 实体 `MdopAttestationEntity`（`node` / `kind` / `measurement` / `tcb` / `quote_digest` / `verified_at` /
    `expires_at` / `verified_by` / `warrant_digest` / `chain_tx` / `chain_block`），**一次会话一条、历史保留**
    （覆盖写会让「当时什么度量、谁验的」查不到）；已进 `controlPlaneEntities` 与 DOMAIN 覆盖矩阵。
  - `MdopAttestationService`：`register`（校验方必须在**部署白名单**内 + 释放凭据验签 +
    度量在注册中心白名单 + 未过期，否则逐条拒）、`latestFor`、`assertUsableForC2`（编译期判定）、
    `recordAnchor`（`0xLOCAL:` 降级回执不写假交易号）。
  - **平台不自己验 quote**：平台没有 DCAP/厂商证明服务；登记的是「配置白名单内的校验方已验过」的摘要。
    真正的 quote 校验在连接器 / KMS 侧（`verifyAttestationForC2`）——这处分工已写进服务注释。
  - 用例 10 条（含「自报我已校验」被拒、合约收窄后判不可用、跨体系 TCB 阈值 fail-closed、历史取最新）。
- [x] 5.2 编译期放置 C2（**已落地**）：`mdop-jobs.service` 在推导出某阶段输入含 C2 时调用
  `assertC2Target(node, mergedPolicy)`；`validateEdge` 的 C2 分支也补上了合约证明策略的上下文
  （原先没传策略 ⇒ C2 边永远判不过，等于这条校验形同虚设）。
  - 多合约作业的策略**取更严的一侧**（`mergeAttestationPolicies`：链型取交集、度量取交集、TCB 逐链取较高；
    跨体系阈值不做数值猜测），实现与用例在 `packages/mdop`。
  - 四条用例：合约未声明策略即拒（作业 REJECTED）、有策略但节点未登记即拒（不得「稍后补证明」）、
    未接入证明登记服务即拒（fail-closed）、有策略 + 有效登记则编译通过且 C2 边落在该节点。
- [x] 5.3 凭证签发（**已落地**）：`MdopTicketService.offerTickets` 在要约时对「**片段里有 C2 输入**」的节点
  查证明登记，把 `attestation[node] = {tee, measurement, min_tcb}` 冻进凭证核心——各持有方签署的
  就是「批准在这份代码下执行」。判据刻意不是「节点有没有 TEE 能力」而是「**它的片段里有没有 C2 输入**」。
  - 要约时**重新**核对一遍登记（编译到要约之间证明可能已过期，要约时刻才是权威）；缺合约服务或登记服务即
    fail-closed；非 C2 作业的核心**不带该字段**（向后兼容，各院签名口径不变）。三条用例覆盖。
  - 「任一持有方拒绝或超时仍进 REJECTED」沿用既有 `accept`/`expireNegotiation` 流程与用例（未改）。
- [x] 5.4 调度覆盖可信空间节点（**已验证**）：可信空间节点与医院节点**同构**——它是片段节点，
  调度器按 `stage.node` 下发，不区分节点类型。用例：一个「华山封存 + 可信空间节点降密」的作业，
  要约发给两方、两阶段各下发一次，`StageDispatch` 的接收方含该节点。
- [x] 5.5 销毁覆盖可信空间节点（**已验证**）：`nodesToPurge` 由片段推导、只排除平台自己，
  可信空间节点天然在内；同一用例断言 `orchestratePurge` 的 `ordered` 含该节点。
- [x] 5.6 证明摘要锚定（**已落地，2026-09-26 补上补偿队列**）：`MdopAttestationService.register` 复用存证适配器把
  `SM3(quote_digest)` 上链并回写 `chain_tx`/`chain_block`；链不可达（`0xLOCAL:`）时降级为本地记录、
  **不写假交易号**，登记本身不受影响。回执链头锚定沿用既有 `MdopReceiptChainService`（未改）。
  - **本轮补齐规格里那句「链不可达时进补偿队列」**：原先只做了「尝试一次 + 失败打日志」——`chain_tx` 空着的
    登记**没有任何人去补**，等于「补锚」无人执行。现在：`pendingAnchors()` 枚举未锚登记、
    `retryPendingAnchors()` 幂等补锚（已锚跳过；仍失败保持未锚、不写假号），并由服务自身的
    **30 分钟节拍**驱动（与回执链服务同一套路，无定时器则补偿队列永远不排空）。
    登记与补锚共用**唯一实现** `anchorQuoteDigest`（同一摘要、同一 payload——两处漂移会让链上出现两种记录）。
  - 用例：`mdop-attestation.spec.ts` 新增 4 条（不可达→补偿→链恢复→补齐且 payload 一致 / 一直降级不写假号 /
    已锚不重复上链 / 未接链返回 0），场景已进 orchestration-kernel 规格并钉进追溯表。
- [x] 5.7 防回归断言（**已落地**）：`platform-no-key-access.spec.ts` 扫描 `apps/api/src`，
  禁止出现解封（`unseal*`）、解包数据密钥（`unwrapDataKey`/`unwrapKey`）、调用 KMS 释放（`releaseDataKey`/`kmsDecrypt`）、
  任何「取密钥」HTTP 入口、信封解密实现；另断言登记服务不含 `privateKey`/`plaintext`/`ciphertext` 等字段，
  且平台侧**没有原始 quote 校验能力**（真正的 quote 校验在连接器/KMS 侧）。

- [x] 5.8 **会话见证的登记、存储与转发（本轮新增，已落地）**：`MdopAttestationService.ingestWitness`
  + 消息控制器 `AttestationReport` 分支 + `MdopOutboxService.enqueue`：
  - **验签**：用部署配置里的 KMS 公钥（`MDOP_KMS_PUBKEY`）走 `verifySessionWitness`（严格解析 → 凭据验签 →
    一次性公钥指纹 → 有效期 → 证明声明 → 与凭证里冻结的期望对拍），任一项不过即拒；
  - **落库本体**：`cp_mdop_attestation` 新增 `report` / `warrant` 两列——只存摘要时持有方**验不了**，
    「独立校验」会退化成「信平台」；**一次会话一条**（`sessionKey` = 释放凭据摘要，历史保留）；
  - **转发**：把同一份见证发给该作业的持有方（`AttestationWitness`，幂等键含凭据摘要，
    平台自己与上报节点除外）——平台能「不给」，做不到「伪造」（设计见 design D14）；
  - 用例：`mdop-witness.spec.ts`（登记+转发、逐会话一行、重发不重复转发、KMS 公钥不符即拒且不落库、
    发送方与见证节点不一致/作业不符/未登记证书→拒、未配置 KMS 公钥→拒）。
  - 前置校验：见证必须来自它自称的参与方（`sender === witness.node`）、作业存在、合约在作业的合约列表里、
    合约声明了证明策略——缺一即拒。

- [x] 5.9 **作业之前的证明登记来源（本轮落地，按候选 A；决策 D-TEE-6）**：编译期放置 C2 要求该节点有一份
  **未过期**的证明登记（`assertUsableForC2`），要约时刻再核一次；而本仓**唯一的登记生产者**原先只有
  节点自己上报的会话见证，见证又来自一次**作业绑定**的 KMS 密钥释放 ⇒ **先有鸡还是先有蛋**：
  除「刚跑完一次会话的窗口内」，作业都会在编译期被 `E_ATTESTATION_FAILED` 拒掉（不只是首个作业）。
  - **选定**：**A 校验方推送**（B 心跳带背书需往参与方消息表加类型；C 放宽判定等于把 fail-closed 换成
    「最近看起来还行」，已否决）。三候选与取舍见 design「Open Questions」第 7 条。
  - **已落地（协议核）**：`packages/mdop/src/attestation/push.ts` —— 背书推送的**共享判据**：
    签名覆盖 `{verifier, endorsement}` 整体（换节点/度量/有效期/校验方都要重签）、严格解析（未定义字段拒）、
    只接受硬件链型（**软件实现不得作为 C2 目标**，schema 层就拒）、过期/未来时刻/有效期早于校验时刻一律拒、
    公钥只能来自部署配置。`push.spec.ts` 5 条。
  - **已落地（平台）**：`MdopAttestationService.acceptEndorsement` + `POST /api/v1/mdop/attestations`
    （部署侧接口，与其它 mdop 管理接口同守卫）——用**部署配置的 KMS 公钥**（`MDOP_KMS_PUBKEY`）验签后，
    走既有 `register`（白名单 / 链型 / 度量清单 / 有效期 / 幂等）。**平台仍不自己验 quote**（§5.1 分工不变）。
    用例 5 条（含「推送后**编译期**即可用」这条闭环断言：不再卡在先有鸡还是先有蛋）。
  - **已落地（节点这一半）**：`tee-node/attestation-probe.ts` —— 真跑一次证明 → 带节点签名（与长轮询同一套
    认证口径）交给校验方；**校验方回传的背书由节点自己验**，并核对背书绑定的 `node` 与 `quote_digest`
    就是本次这份证明（否则「它说验过了」只是无法核对的转述）；软件提供者本地就拒、不发请求。
    用例 6 条。
  - **部署口径**：背书有效期由校验方按部署策略给（分钟～小时级），**探针节拍必须短于该有效期**，
    否则作业又会在编译期被拒——已写进 DEPLOY §4.3。
  - **如实边界**：真实 KMS / 证明服务未接，`verifier` 目前只是配置里的标识、签名由替身密钥产生；
    因此这条链**仍不是**「C2 已可用」（§3.2/§4.x 不变）。

## 6. 连接器侧

- [x] 6.1 出口守卫扩展（**修改既有「C0 不出节点」要求，已落地**）：`mdop-egress.ts` 的 `decide` 现在区分
  `C3`（只看接收方列表）与 `C2`（还要：本地副本条款里有 `attestation_policy`、拿得出本次证明声明、
  声明层面合规——级别/链型/有效期/度量/TCB，复用协议核心的 `verifyAttestationClaims`）。C0/C1 仍然一律拒。
  - **关键澄清**：合约声明的是**证明策略**而非节点名单（协议 §4.3）——我最初把 spec 写成「本地合约声明的
    可信空间节点」，与协议不符，已连同 spec 一起改正（改的是措辞，规则一致：校验对象是「这次拿出的证明是否满足策略」）。
  - quote 的验签不在这一步：连接器没有厂商证明根，由 KMS 验、以**签名释放凭据**背书（D13）。
    **凭据的持有方侧核验不在复核阶段**——凭据逐会话产生，复核时它还不存在；落点是**会话结束后的见证核验**
    （§6.7 / design D14）。
  - 用例：合约无策略 / 无本次证明 / 证明过期 / 软件级冒充 → 逐条拒；合规放行（5 个分支）。
- [x] 6.2 `seal` 执行接入（**已落地**）：`operators/seal.ts` + `operators/wire-seal.ts`。
  - 信封 `mdop.env/1.0`：AEAD 加密（本期 **AES-256-GCM**，`cipher` 字段如实写明；换 SM4-GCM 只替换 `aeadSeal`，
    AAD 绑定/密钥保管/策略字段都不动）、AAD 绑 `{job_id, credential_id, contract_id}`、水印、
    持有方 SM2 签名（`origin_sig{signer,alg,value}`，与信封 schema 对齐）。
  - **只封合约声明的那一份切片**：`dataProductId` 与本地合约副本的 `data_product_id` 不一致即拒。
  - **2026-09-26 补：把「SM4-GCM」的三处高估改成与实现一致**。规格、proposal 与协议 §9.3 的示例
    原先都写「本期 SM4-GCM」，而实现（`aeadSeal`）是 **AES-256-GCM**、`payload.cipher` 也如实写
    `AES-256-GCM`——读规格的人会以为载荷已是国密。已按实现更正三处，并把这次**对 D8「通信用国密加密」
    的临时偏离**登记进 DECISIONS D8 的落地补注（含四条约束：字段如实标注 / 其余环节国密未变 /
    不得称「国密信封·全链国密」/ 收回条件＝受审计的 SM4-GCM 落地）+ design Non-Goals + 协议补注。
    **这不是「措辞问题」**：它是合规相关的偏离，必须显式登记，而不是让它留在规格里默认成立。
  - **同一类审计续（同日）：句柄的两条要求也按事实收口**。①「节点侧句柄 MUST 与凭证编号、**合约 id**
    关联」——凭证是句柄 schema 的必填字段（`ticket_id`），**合约经 `job_id` 关联**（作业的合约列表为权威），
    句柄不冗余存 `contract_id`；并为「缺 `ticket_id` 即拒」补了**此前缺失的负例**
    （`schema.spec.ts`）与规格场景 + 追溯行。②「句柄 MUST 带摘要（**密文摘要与明文摘要各自独立**）」——
    事实是**只有一个密文摘要**，明文摘要**刻意不给**：持有密文的任一方（含平台）拿到它就能
    **确认明文内容**（内容预言机）；明文完整性由 AEAD 标签 + AAD 绑定保证。规格已按此改写。
  - **「销毁覆盖内存与临时盘」此前只有内存那一半有用例**（2026-09-26 补）：节点状态文件
    （`node-state.json`）里**确实存着 C3 载荷**，而销毁只在内存侧有断言。新增一条落盘级用例
    （`persist.spec.ts`：先证明未销毁时载荷在盘上 → purge + persist → 盘上标记消失、句柄读不到、
    重新 hydrate 也复活不了），并补规格场景「销毁覆盖临时盘」与追溯行。顺带核实部署路径：
    `node-messages` 的 `PurgeOrder` 处理器在销毁后**确实调用 `persist()`**（否则内存销毁不落盘，
    「销毁」在重启后就只是一句话）。
  - **`local-plan-review` 第 4 项的错误码写错了（同日更正）**：原文写「目标为可信空间节点而证明不可验证时
    为 `E_ATTESTATION_FAILED`」，但复核阶段**不承担证明校验**（同一能力末尾已写明），实现里也只出
    `E_CAPABILITY_MISMATCH` / `E_LABEL_VIOLATION`——该码真正产生在投递（出口守卫）与执行前
    （`verifyC2Execution`）。规格已按实现与设计意图更正。
  - **KMS 归属此前没有对拍（同日补上，安全相关）**：`verifyReleaseWarrant` 校验了 key_id、签名、
    凭据摘要、一次性公钥绑定与有效期，**唯独没有核对「签发凭据的 KMS 是不是信封
    `wrapped_key.kms` 指定的那个」**——而 D-TEE-1 的模型正是各持有方自建/共管 KMS，
    部署里一旦有多个 KMS，「谁有权释放这份数据的密钥」就必须逐份核对，否则会出现
    「信封指定持有方自建的 KMS 保管、却由别家 KMS 释放并被接受」。现已补：`expectedKms`
    可选入参 + 节点会话传 `envelope.wrapped_key.kms`（缺省不传时行为不变，向后兼容）。
    用例两层：协议核（`kms.spec.ts`：匹配通过 / 不传通过 / 不匹配拒）+ 端到端
    （`c2-session.spec.ts`：信封写「持有方自建 KMS」，本节点 KMS 客户端是另一家 → 拒且一步不执行）。
    场景与追溯行同步（97 个场景）。
  - **回执收链缺「身份 + 签名」两道（同日补上，安全相关）**：平台侧 `ingestAuditReceipt` 此前只做
    `parseAuditReceipt`（**只校验形状**）与连续性；`receipt.signer` 既不与消息层已认证的发送方对拍，
    密码学签名也从不验证。后果很具体：**任何已认证参与方都能把记录塞进别人的回执链**，
    让对方随后自己的诚实回执被判「断链」，并把伪造行一起锚定上链。现已改为「先认身份 → 再认签名 →
    最后认连续性」：`signer` 必须等于消息层发送方（URN 与证书公钥都来自**已认证上下文**，
    不采信回执自述），签名必须能被该参与方证书公钥验过。调用方（控制器）传入认证上下文；
    全部相关夹具改为**真签名**（`conformance` / `conformance-e2e` / `mdop-purge-receipts` /
    `mdop-receipt-chain-node` / `c2-conformance-e2e`），并新增负例：
    signer 冒充被拒 + 用别人私钥签名被拒（都不落库）。场景与追溯行同步（98 个场景）。
  - **销毁回执同样缺这两道（同日补上，安全相关）**：`PurgeReceipt` 此前也是**只验形状**、
    不与发送方对拍。后果比回执链更直接：任何已认证参与方都能提交一条 `node: 别家` 的销毁回执，
    让平台把它计入「已收到」——收齐即 `PURGED`，而对方机器上可能仍留着制品，
    「收齐全部销毁回执才算销毁完」这个保证当场失效。现已改为「先认身份、再认签名」：
    `MdopPurgeService#onPurgeReceipt` 增加**必填**的已认证发送方上下文（URN + 证书公钥），
    不符即 400 且不落库；控制器传入认证上下文；四个 spec 的销毁回执夹具改为**真签名**
    （`mdop-purge-receipts` / `conformance-e2e` / `c2-conformance-e2e` / `c2-failure-e2e` /
    `c2-multi-node-e2e`）。负例：`node` 冒充 → 拒；用别人私钥签 → 拒；两者都断言作业**不进 `PURGED`**。
    场景与追溯行同步（99 个场景）。
  - **阶段状态可以被替报（同日补上，安全相关）**：`StageStatus` 的入库路径此前**完全没有身份概念**——
    `MdopSchedulerService#onStageStatus` 只收 `{jobId, stageId, status, code}`，谁报的都一样处理。
    这条比前两条更狠：阶段状态**直接驱动平台状态机**——`SUCCEEDED` 会解锁下游下发（数据还没到就往
    前推进），`FAILED` 会触发重试、甚至把整个作业打成 `FAILED`（DoS）。现已补：`StageStatusInput`
    必填 `reporter`（来自消息层已认证上下文），`onStageStatus` 核对 `stage.node === reporter`，
    不符即 400 且状态机一动不动。负例覆盖「替报成功」与「替报失败」两种；场景与追溯行同步
    （100 个场景）。
  - **接受 / 拒绝也可以替别家发（同日补上，安全相关）**：`PlanFragmentAccept` 只按 `body.signer`
    去证书目录取公钥验签（挡得住伪造，但 `signer` 与发送方脱钩）；`PlanFragmentReject` 更弱——
    **协议里根本没有签名**，平台却直接按 `body.signer` 把作业打成 `REJECTED` 并向各院广播 `JobAbort`。
    即任何已认证参与方都能替别家拒绝，**一次请求作废整个作业**。现已补身份绑定：`accept` / `reject`
    都接收消息层已认证上下文并要求 `signer === sender.urn`，不符即 `E_AUTH_INVALID`（不落库、不作废、
    不广播）；控制器与五个 spec 的调用点同步更新。负例：替报接受 → 拒；替报拒绝 → 拒且断言
    作业**未进 `REJECTED`**、**无 `JobAbort`**。场景与追溯行同步（101 个场景）。
  - **合约签署可被冒名提交（同日补上，防御纵深）**：`MdopContractService#agree` 的验签是对的
    （用**提供方登记证书**里的公钥验，不是自述），所以伪造不了签名；但「**谁在提交**」没绑——
    任何拿到过那份签署全文的一方都能替提供方提交，让平台副署并把合约激活。
    现已补：`agree` 接收消息层已认证的 `senderUrn`（**可选**，只有控制面消息路径传入），
    给了就要求它等于该合约的提供方；直连 REST 入口走 JWT + `ParticipantRolesGuard` 且仍需有效签名。
    负例：别家拿同一份签署全文提交 → 403 且状态停在 `offered`；提供方自己提交 → `active`。
    规格把这一整类收成一条新要求「平台侧 ingest 的身份绑定（统一判据）」并逐条列出五个路径，
    场景与追溯行同步（102 个场景）。
  - **「软件实现不得作为 C2 目标」的拦截点此前写错了地方（同日更正）**：pilot 规格把这条写成
    「**编译期与本地复核**要求证明为硬件级 / 复核遇到软件级目标即拒签」，但本变更自己的设计写明
    「复核阶段本次会话的证明还不存在，复核 MUST NOT 假装验证证明」——两处直接冲突。
    已按实现的事实改写：编译期（能力匹配）+ **投递（出口守卫）** + **执行前（`verifyC2Execution`）**
    才是硬件门槛生效处；复核那一条改名为「复核不采信「平台称其为 TEE」」并只保留它真正判的两件事。
    同时把「投递时遇到软件级证明」单独成场景（含「拿不出本次证明也拒」），追溯行随之改钉到
    `MdopReviewService` / `MdopEgressGuard` 与各自用例。场景与追溯行同步（104 个场景）。
  - **没有 KMS 保管口就拒绝产出信封**（不「先出信封、密钥稍后补」）；保管失败同样拒，不留半份信封。
    保管口是可插拔接口（生产=医院自建/共管 KMS；仓库内附带 `InMemorySealKeyDepositor` 仅供本机演练，
    且只存摘要、不保留密钥本体）。
  - 产出前**自检**：交给 `parseDataEnvelope` 验一遍，形状不合规就不产出。
  - 用例 5 条：信封可解析且 AAD 正确、密文无明文且 DEK 已交付、**AAD 被改则解不开**、
    合约无策略/切片越界即拒、保管失败即拒。
  - 说明：本条交付的是「封装」一侧。C2 **数据面投递**已由 §3.14 落地（平台中继 + 节点长轮询 +
    接收会话）；本条旧稿「数据面仍待做」作废。真实硬件/KMS 仍待 §3.2/§4.x。
- [x] 6.3 能力通告（**已明确并钉住**）：连接器的 `tee` **恒为 `null`，这是设计意图而非待办**——
  连接器是数据持有方组件，没有飞地也没有远程证明，MUST NOT 通告 TEE 能力；
  **通告 TEE 能力的是可信空间节点自己**（§3 组件，有自己的参与方身份与证明代理），平台按各自通告分别放置 C2 阶段。
  代码注释写明「任何让连接器也声明 TEE 以让 C2 跑起来」的想法都与 C2 前提冲突；用例钉住：
  即便设了 `CONNECTOR_MDOP_TEE_KIND` / `CONNECTOR_TEE_ENABLED` 这类环境变量，通告仍是 `null`，
  且 `supportsLabel(cap,'C2') === false`（连接器不会被当作 C2 目标）。
- [x] 6.4 单测（**已落地**，三条各自有两处证据）：
  - **未声明 C2 的作业出现 C2 投递 → 拒**：连接器出口守卫在本地合约副本无 `attestation_policy` 时拒投
    （`mdop-node.spec.ts` 的 C2 投递分支）；节点侧入口守卫也会拒掉「没有合约声明却送来的信封」。
  - **目标证明过期 → 拒**：出口守卫按证明**声明层面**判有效期（同上）；节点层由 KMS 判
    `E_ATTESTATION_FAILED` 并**不执行**（`c2-session.spec.ts`）。
  - **信封 AAD 与作业不符 → 拒**：入口守卫（`node-runtime.spec.ts`）与节点会话
    「跨作业重放 → `E_ENVELOPE_POLICY`」（`c2-session.spec.ts`）。
- [x] 6.5 本地复核扩展（**已落地**，并修正了原假设）：复核第 4 项对 C2 边**只判两件事**——
  ① 本地合约副本条款里有 `attestation_policy`；② 对端在合约接收方/参与方之列；并把对端记入复核结论
  `c2Targets` 供后续使用。
  - **原稿假设不成立**：写成「证明按合约策略由本地独立校验」——但**要约时本次会话的证明还不存在**
    （要到投递/执行时才产生）。三处判据因此分层：复核判**策略与对端** → 出口守卫判**本次证明声明**
    （§6.1）→ 执行前 `verifyC2Execution` 判**证明与释放凭据**。spec（`local-plan-review`）已按此改写。
  - 顺带补了一条防标签洗白的检查：**C2 边的上游阶段输出等级必须是 C2**（否则可把 C3 输出标成 C2 边，
    或把 C2 输出当 C3 投出去）。
  - 用例 3 条：合约无策略即拒、有策略则通过且带出对端、上游非 C2 标 C2 边即 `E_LABEL_VIOLATION`。
- [x] 6.6 第 5 项预算条款同步改写（**已落地**）：`mdop-review.ts` 的复核表与代码注释都写明
  「连接器本地仍不申请 DP 预算、ε>0 一律拒」，并区分两条边界——**查询预算属节点侧自记账**
  （`node/budget-ledger.ts`，D-TEE-2 要求由被测代码强制），**不是**靠开 C2 顺带打开院内侧账本。

- [x] 6.7 **释放凭据到持有方的载体（四段全部落地：协议核 / 节点发送端 / 平台 / 持有方）**：
  D13 选的是「持有方用**KMS 释放凭据**独立校验证明，不采信平台登记」——凭据本体（含 KMS 签名）
  因此必须**到达持有方**。本轮复核发现原实现里根本没有这条载体（凭据只活在节点会话内、平台只存摘要、
  连接器拿不到本体），于是「独立校验」只剩口号；**已按 design D14 落地**：
  - **协议核**：新增会话见证（`attestation/witness.ts`）——严格解析报告与凭据（`parseAttestationReport` /
    `parseKeyReleaseWarrant`）+ `verifySessionWitness`（KMS 签名 → 一次性公钥指纹 → 有效期 → 证明声明
    → 与凭证期望对拍）；消息类型 `AttestationReport`（节点→平台）与 `AttestationWitness`（平台→持有方）；
    审计事件 `WITNESS_VERIFIED` / `WITNESS_REJECTED`。**判据仍只有一份**（复用 `verifyReleaseWarrant` 与
    `verifyC2Execution`），换链换 KMS 不影响这里。
  - **平台**：`MdopAttestationService.ingestWitness` —— 用**部署配置里的 KMS 公钥**（`MDOP_KMS_PUBKEY`）
    验签、核对合约策略与凭证里冻结的期望、把**本体**落库（`cp_mdop_attestation.report/.warrant`），
    并**原样转发**给该作业的持有方（`AttestationWitness`，幂等键含凭据摘要）。平台能「不给」，做不到「伪造」。
  - **持有方**：`node/witness-verify.ts` —— 用 `CONNECTOR_MDOP_KMS_PUBKEY`（部署配置）独立核验，
    与本院签过的 `core.attestation[node]` 对拍，通过/拒绝都写审计回执（`mdop-node.service` 的
    `onAttestationWitness` 已接线，有用例证明**未配置公钥时记拒绝并上报回执**）。
    - **拒绝回执带结构化错误码（2026-09-26 补，规格原本就写着「含错误码」）**：此前错误码只出现在
      ①核验记录的自然语言 `reason` 里、②返回给平台的那一句 `detail` 里——**回执本体没有码**，
      于是「按码统计拒绝原因」在审计侧做不到。现在 `WitnessVerificationRecord` 带独立 `code`，
      拒绝回执的 `detail` 带 `{code, reason}`（三条拒绝路径：无本地合约 / 合约无证明策略 / 核验不过），
      对外返回也改成回错误码本身。
    - **顺带修掉一个静默丢字段的真问题**：持有方回执的 `audit()` 助手原先只把四个固定字段写进 payload，
      **`detail` 里的附加字段被整段丢弃**——任何「往回执里补证据」的改动都会静默失效。现在附加字段
      进 `detail` 子对象（顶层未知字段会被 `parseAuditReceipt` 拒收，所以不能摊平）。
    - 用例：`witness-verify.spec.ts` 断言 `record.code`；`mdop-node.spec.ts` 断言回执本体里的
      `detail.code= E_KEY_RELEASE_DENIED` 与 `reason` 非空。
  - **每次释放一条**：登记以释放凭据摘要为会话键（一次会话有几份封存输入就有几条，共享同一份证明）；
    `warrantDigest` 补上**逐会话变化的字段**（一次性公钥、`issued_at`）——否则同秒内的两次会话摘要相同，
    第二次凭据换不掉第一次的。
  - **发送端已落地**（本轮）：`apps/connector/src/tee-node/witness-report.ts` + `session.ts`
    ——`runNodeSession` 为**每个 `key_id`** 产出见证，`reportSessionWitnesses` 用**节点自己的私钥**签
    `AttestationReport` 发给平台（幂等键含凭据摘要）；用例断言信封的 msg_type/收发方/本体完整/验签通过。
  - 如实边界：真实硬件与真实 KMS 下的端到端仍待 §9.2/§9.3；本项的**载体本身**（协议、发送、登记、核验）
    已闭环并有用例。

## 7. 前端

- [x] 7.1 合约页 C2 策略（**已落地**）：新增 `components/console/c2-policy-panel.tsx`，在生效合约行内提供
  链型多选（CSV/TDX/SEV-SNP，附各自适用提示）、按链的最低可信基、允许度量清单，以及**一次显式勾选**的
  风险确认（默认不勾）——文案写明「开 C2 ≠ 数据仍在医院：信任锚换成厂商证明根 + 代码度量 + 运营方 + KMS 释放策略，
  合规定性是委托处理/数据出域，侧信道不在 TDX/SEV-SNP 防护内」；提交即带策略重新发起 MDOP 要约
  （条款变更 ⇒ 各院需重签）。API client 增加 `describeMdopContract` / `offerMdopContract`。
- [x] 7.2 作业页（**已落地**）：作业详情页新增两块——
  ① **执行凭证**：按节点列出「各院批准的是在哪份代码下执行」（链型 / 代码度量 / 最低可信基），
  非 C2 作业显式说明「未冻结执行环境期望」；② **审计回执链与锚定**：逐节点链连续性（连续 / 断链位置）、
  回执条数、锚定状态（已上链显示交易号与区块；`pending` 如实写「待上链（补偿队列，非伪造交易号）」）。
  为此 API 侧 `GET /mdop/jobs/:id` 增加 `ticket`（含按节点期望）与 `result`（平台合并结果）。
- [x] 7.3a 结果页展示可得字段（**已落地**）：作业详情页新增「合并结果（C3 交付物）与发布审查」面板，
  展示分析类型、队列规模、分层表行数与结果携带的 `warnings`（如统计效力不足），
  并**在界面上如实写明缺什么**：抑制计数、DP 声明与查询预算消耗目前不随 C3 载荷附带，控制台因此看不到。
- [x] 7.3b 抑制计数 / DP 声明 / 查询预算随 C3 附带（**已落地**，含与 §3.6 冲突的调和）：
  - **冲突的调和**（写在协议核与 spec 里）：**汇总数**随 C3 出域，**逐格明细**留在节点本地审查记录与
    审计回执——载荷里被抑制的格子本来就已归零，汇总数不额外泄露「具体哪一格」。
  - **协议核**：`schema/release-manifest.ts`（`mdop.release/1.0`）——严格解析、保留键挂载（不接受覆盖写）、
    `mergeReleaseManifests` 把单方/多方统一成**同一种可解析对象**（抑制数求和、阈值取最严、DP 取最强、预算逐方）。
  - **节点侧**：会话在发布审查后、出口前**先记账再出域**，把清单挂进 C3 载荷（`node-session.ts`）；
    逐格明细仍只进本地审查记录与回执（`EXITED` 回执里只有汇总数）。
  - **平台侧**：合并阶段把各方条目汇总进交付物（`mdop-merge.service.ts`）；**没有清单时不出现该键**（不伪造）。
  - **控制台**：`apps/web/src/lib/release-manifest-view.ts`（+4 条 node:test）把「没有清单 / 清单非法 /
    清单合法」分成三种状态渲染；作业详情页展示汇总数、逐方条目与预算消耗。
  - 用例：协议核 4 条、合并侧 3 条（两方汇总 / 单方 / 都没有）、节点会话 1 条（清单值＝审查记录值、逐格明细不出域）、
    前端 4 条。

- [x] 7.4 **持有方的见证核验结果进控制台（已落地）**：
  - **登记表补作业维度**：`cp_mdop_attestation` 增加 `jobId / credentialId / contractId / keyId`
    （可空）——原先只按 `node#warrantDigest` 登记，**无法回答「这个作业的会话证明是哪几条」**。
  - **对齐服务**：`mdop-witness-status.service.ts` 把「见证本体」与「持有方核验回执」按**凭据摘要**
    （旧回执按 quote 摘要兜底）对齐，并给出两个字段：`nodesWithoutWitness`（节点还没上报见证）、
    `nodesWithoutVerification`（有见证但没有本院核验回执）——**三态必须分开，未核验≠通过**。
  - **API**：`GET /mdop/jobs/:id` 增加 `witnessStatus`（参与节点按片段推导，平台自身排除）。
  - **控制台**：`apps/web/src/lib/witness-status-view.ts`（+4 条 node:test）与作业详情页新增
    「会话证明与本院核验」面板：逐节点显示度量/TCB/核验结论（未通过时带原因），并在有遗漏时
    如实列出「尚未上报见证」「尚无核验回执」的节点；说明文字写明核验由持有方完成、平台只转发。
  - 用例：对齐服务 5 条（verified / rejected+原因 / 未核验 / 未上报 / 旧回执按 quote 兜底）。

## 8. 一致性与安全测试

- [x] 8.1 证明类负例（4.4）在协议层与节点层各跑一遍（**已落地**）：
  - **协议层**：`packages/mdop/src/attestation/{provider,release,execution,kms}.spec.ts`——级别/链型/信任根/
    有效期/度量/TCB/凭证/合约/归属逐项；
  - **节点层**：`apps/connector/src/mdop/node/c2-session.spec.ts`——伪造证明 / 证明过期 / 度量换版 /
    TCB 过旧 / 凭证过期 / 合约终止，六条都断言**拒绝且一步未执行**（`executed() === 0`）。
- [x] 8.2 越权出口（**已落地**）：
  - 节点试图投出 **C0/C1**：等级检查在执行后、发布审查前拦下（`E_LABEL_VIOLATION`，用例
    「C0/C1 不得靠发布审查洗白成 C3」）；出口守卫本身也拒非 C3（`node-runtime.spec.ts`，含 C0 回流告警留痕）。
  - 节点把 C3 投给**名单外**目标：`E_LABEL_VIOLATION` 并留痕（`violationsLog`，有用例）。
  - 连接器把 **C2 投给未证明节点**：出口守卫按证明声明判（无本次证明/证明过期/软件级冒充 → 拒，
    `mdop-node.spec.ts`）。
- [x] 8.3 重放与新鲜度（**已落地**）：
  - **旧 quote 重放**：KMS 侧证明有效期与「每次会话重新证明」由用例钉住（过期即拒）；
  - **旧释放凭据复用**：跨会话重放被 `verifyReleaseWarrant` 摘要比对拒绝（`E_KEY_RELEASE_DENIED`，有用例）；
  - **信封跨作业重放**：入口守卫 AAD 绑定不符 → `E_ENVELOPE_POLICY`；密文被替换 → 摘要对拍即拒。
- [x] 8.4 查询预算（**已落地**）：超预算查询被拒且**不执行**（`c2-session.spec.ts`：
  上限 2，第三次拒、`executed()` 不变、拒了不扣）；亚组/切点重算计入与差分查询检出在
  `node-runtime.spec.ts`（`kind` 区分 + `detectDifferential`）。
- [ ] 8.5 端到端（合成数据）：两院 `seal` → 节点内跨院配对/亚组重算 → 只出 C3 → 销毁 → 回执链锚定；
  产出物可离线核验（回执链 + 证明摘要 + 链上锚定）。
  - **已完成部分**（`apps/connector/src/mdop/node/c2-session.spec.ts`）：两院 `seal` →
    证明 → KMS 释放 → 解封 → **节点内跨院主体配对** → 发布审查 → 只出 C3 → 销毁 →
    回执链逐条验签（用节点公钥，断链能指出位置）。
  - **本轮补齐**：节点侧的**两阶段**（配对留在节点内 → 节点内降密 → 出口 C3）也已端到端可跑
    （`tee-node/stage-dispatch.spec.ts`，7 条）：第一段只登记句柄与见证、**零投递**，第二段过闸门后
    投递载荷；链上事件为 `UNSEALED → EXECUTED → EXECUTED → EXITED`，预算只扣一次。
  - **未完成部分**（不得含糊）：① **链上锚定**这一段没跑——平台侧锚定服务（§5.6 的
    `MdopReceiptChainService`）是控制面组件，本用例不含数据库与链；② 证明与 KMS 都是**替身**，
    真实硬件 + 真实 KMS 的端到端仍待 §9.2/9.3。因此本项**不勾**。
  - **现状（2026-09-25 末）**：① 的代码路径**已全部有证据**——上报端（`receipt-report.ts`）、
    平台侧 ingest→校链→**真实交易号锚定**（`mdop-receipt-chain-node.spec.ts`）与链不可达记 pending、
    以及**离线核验**（`offline-verify.spec.ts` 用仓库工具复算并指出断点）都有用例；
    差的只剩**在真实部署上跑一次**（含链），而它与 ② 的真实硬件/KMS 是同一批前置。
    因此本条仍不勾，但「代码没写完」已经不成立——它是**演练项**。
  - 2026-09-25 补齐（本轮）：① 的**上报端**已落地——节点回执改成协议 `AuditReceipt` 形状并由
    `tee-node/receipt-report.ts` 上报（用例断言形状可被平台解析器读回、链头算法与平台
    `chainHead()` 逐条一致、重复上报不重发），因此平台既有的**收链 + 校连续性 + 终态锚定链头**
    对节点链直接适用。
  - 2026-09-25 再补齐（本轮）：**平台侧**「节点四类事件 ingest → 校链 → 链头用真实交易号锚定」
    与「链不可达记 pending、不写假交易号」都进了用例（`mdop-receipt-chain-node.spec.ts`，3 条）；
    **离线核验**也跑通：把节点回执链导出后用仓库的 `apps/connector/scripts/verify-receipt-chain.mjs` 复算
    （`offline-verify.spec.ts`，3 条：通过 / 改动即断链并指出位置 / 换公钥拒）。
    - **顺带修掉一个真 bug**：节点回执原先签的是「规范化串本身」，而离线工具与仓库其它签名对象
      都用 `signCanonicalObject`（对规范化串的 SM3 摘要签名）——于是离线核验一律判「签名验证失败」。
      已统一口径（这是本条用例实测抓出来的）。
  - 剩下的是**真跑一次**（含链上锚定的部署侧演练）与真实硬件/KMS。
    **§3.16 已落地节点本地持久化**（`tee-node/persist.ts`：0700/0600、hydrate/persist、导出一手链）；
    本条旧稿「回执链仍是内存态」作废。
  - **解锁三段式**：
    (a) **解锁动作**：在已接真实证明链、真实 KMS、且存证链可达的部署上，用合成数据跑完整条
    「两院 seal → 节点内配对/亚组重算 → 只出 C3 → 销毁 → 回执链锚定」；
    (b) **归属方**：运维（部署与链）+ 硬件（证明/KMS，与 §9.2 同一批前置）；
    (c) **验收证据**：作业终态 `PURGED`；节点回执链 `valid`；`tee-node -- export-receipts` +
    `node apps/connector/scripts/verify-receipt-chain.mjs` 通过；证明摘要与链头有**真实** `chain_tx`
    （非 `0xLOCAL:`）。替身提供者下的分块用例不得用来勾本条。

## 9. 部署与演练

- [x] 9.1 部署清单（**已写入 `DEPLOY.md §4.3`**）：五个组件/前提逐条列出（节点、KMS、主机能力、
  网络方向、合约声明），每行标了归属要求与现状（节点运行时与可部署节点组件
  `apps/connector/src/tee-node/` 已落地 / 真实证明与真实 KMS 未接 / 机型待采购）。
  **清单本身完成**；其中的运维项（机型、证明服务可达性）仍是待办，`§9.2/9.3` 的演练因此不能开跑。
- [ ] 9.2 单院 MVP 演练（合成数据）：证明 → KMS 释放 → 一个降密阶段在节点内执行 → 只出 C3。
  - **解锁三段式**：
    (a) **解锁动作**：按 `DEPLOY.md §4.3` 步骤 2–7 部署一台真实 TEE 机型 + 真实证明提供者 + 真实 KMS，
    用合成数据跑「证明 → KMS 释放 → 节点内一个降密阶段 → 只出 C3 → 销毁」；
    (b) **归属方**：运维 / 采购 / 硬件（机型、证明服务、KMS 部署）；KMS 归属书面接受另见 §4.3；
    (c) **验收证据**：作业终态 `PURGED`；节点回执链 `valid`；C3 被平台收集且无主体键；
    `tee-node -- export-receipts <jobId>` + `verify-receipt-chain.mjs` 通过；证明摘要有真实 `chain_tx`；
    记录端到端耗时。**不得**用软件提供者 / `LocalDevKms` 勾选本条。
- [ ] 9.3 两院演练：跨院配对/亚组重算跑通，作业终态 `PURGED`，两院与节点回执链均 `valid`。
  - **解锁三段式**：
    (a) **解锁动作**：§9.2 通过后，两院连接器 + 一个可信空间节点按 `DEPLOY.md §4.3` 步骤 7
    跑跨院配对/亚组重算（合成数据即可；真实数据还要等 §3.12b 与 REG-08 书面接受）；
    (b) **归属方**：运维（两院连接器与节点部署）+ 两院运维配合；
    (c) **验收证据**：作业终态 `PURGED`；两院与节点回执链均 `valid`；平台收集无主体键；
    销毁覆盖两院 + 节点（缺任一回执不得 `PURGED`）；链上锚定为真实交易号。
    分块端到端用例（`c2-conformance-e2e.spec.ts` / `c2-multi-node-e2e.spec.ts`）是链路证据，
    **不是**本条演练记录。
- [x] 9.4 `DEPLOY.md §4.3`（**已写入**）：组件清单 + 上线步骤（7 步，含 KMS 公钥来源、
  能力通告不得虚标、要约重签）+ **回滚方案**（关闭 C2 的方式：**合约取消 `attestation_policy` 声明
  + 节点下线**，既有 C3 链路不受影响；节点下线前必须先跑完销毁）+ 整体回退路径。
  - 如实标注：该节**是待上线清单、不是演练记录**，没有任何一行是实测通过。
- [x] 9.5 如实边界登记（**已写入 `DEPLOY.md §4.3` 末节**，逐条）：① 不得出现「数据没有出医院」
  类表述——C2 换的是信任锚，合规定性是委托处理/数据出域；② 侧信道不在 TDX/SEV-SNP 防护范围；
  ③ 仅当节点部署在院内时：证明服务可达性/离线核验未落地前不得开工（云上默认形态 collateral 可在线取，该项不是共同前置）；④ 替身实现只能用于开发与合成数据演练，
  真实数据必须换厂商证明链 + 持有方自建/共管 KMS；⑤ REG 路径与医院书面接受未完成前只跑合成数据。
  - 全仓检查（`grep` 过 `docs/`、`openspec/`、六本元语）：**C2 相关文档里没有**这类表述，
    一律写成「密文出域 + 只在被证明过的代码里解密」并**显式否定**该说法（tasks 开篇边界、proposal、
    TRUST P-CTL-8、DECISIONS D-MDOP-6 补注、控制台文案各一处）。仅有的两处
    「原始/患者层数据不出院」（`docs/amr-sentinel/PROPOSAL.md`、POC 介绍 HTML）说的是
    **C1/C3 的行级数据不出域**，与 C2 无关，属准确表述。

## 10. 复核记录（2026-09-26）

- 三道闸门：`node scripts/check-meta-docs.mjs` **0 error / 14 warning**（warning 全为存量：
  REG/EVD 的 spec 待补、DEPLOY 样例键的批量漂移）；`pnpm governance` **全部通过**；
  `openspec validate tee-confidential-node --strict` 与 `tee-attestation-pilot --strict` **均 valid**。
- **样例键清账（同日，warning 15 → 14）**：本次变更引入的三条 connector 侧配置
  （`CONNECTOR_MDOP_WATERMARK` / `CONNECTOR_MDOP_KMS_REF` / `CONNECTOR_MDOP_CONTRACT_POLICY_FILE`）
  此前只登记在 DEPLOY §2、**没进任何样例文件**——即「文档要求配、样例里看不到」。已按样例风格补进
  `apps/connector/.env.example`（未注释，checker 只认行首键）。另删掉两个**全仓无人读取**的死键
  （`MP_SPDZ_PROTOCOL` / `FHIR_TIMEOUT`，只存在于样例里、代码与文档都不认），因此「样例文件键无人读取」
  这条 warning 归零。剩余 67 个「已登记键不在样例」是历史欠账（agent/MPC/FHIR 等其它子系统），
  不在本变更范围。
- 两个自建校验器：`check-c2-traceability` **104 个场景** 0 error；`check-protocol-error-codes`
  25 个码 ↔ 协议 §11 表 25 行 0 error；负例自检 **14/14** 通过（追溯侧 9 条 + 错误码侧 5 条）。
  - **同日把追溯的「用例」判据收紧**：原先只要求「用例文件里出现过关键词」——`it.skip(...)`、
    `xit(...)`、`(cond ? describe : describe.skip)(...)` 这类**根本不跑**的用例同样算命中，
    是新的静默黑洞；关键词只写在注释里也算。现在要求命中**非跳过**的用例标题，并新增 4 条负例
    （skip / 条件跳过 / 只在注释 / 正常用例不误伤）。
- **第三个自建校验器（2026-09-26 新增）**：`check-tee-claims`（TEE 表述红线：`attestationLevel`
  不得写成 `hardware`；`level: 'hardware'` / `isolation: 'hardware-enclave'` 只许在证明契约、
  节点组件与测试夹具里）——真仓库 **0 error**（扫描 981 个 TS 文件）、负例自检 **8/8**。
  它替掉的是 TRUST 红线清单里那条**声称存在但从未实现的**「grep 守护，v2」。
- **工厂侧负向验证进闸门（同日）**：`pnpm governance:negative` 此前从不被执行；现在挂进 `pnpm test`，
  并补上原文备份 / try-finally 回滚 / 逐字节比对 / 中断自愈。本轮实跑 **2/2**（FC 格式契约、AG 入口指针：
  注入 → 红且消息命中 → 回滚 → 绿）。
- **connector 全量跑的 jest 收尾告警：已查、未复现、如实留档（不追了）**。现象：全量跑完打印
  `A worker process has failed to exit gracefully`（**非致命**，套件全过）。本轮做的三件事与结论：
  ① 按同仓口径给 `ConnectorWorkerService` 的后台心跳与退避 `sleep` 加 `unref()`（此前没加，
  而 `MdopNodeService` / `CdmDataSourceRegistry` 都加了）——**修了不一致，但不是本告警的元凶**；
  ② `npx jest --detectOpenHandles`（in-band 全量）**没有报出任何 open handle**；
  ③ 分组复跑 tee-node(16 套) / mdop(11 套) / domain(81 套) / testdata+repro(5 套) **四组均不出现**
  （四组合计 113 套 = 全量），只有全量**并行**跑才出现——指向 worker 进程收尾时序，而不是某个套件泄漏。
  ④ 同一天再跑完整的 `pnpm test`，**该告警没有出现**（同一份代码、同一批套件）——印证「是收尾时序，
  不是确定性泄漏」。结论：**不改 `--forceExit`**（那会把真泄漏一起盖掉，与「不跑的守护等于没有守护」
  同一个道理）；留作后续可查项，至少下一轮不必再重复这几步。
- **api 全量跑出现过一次未复现的失败（如实留档）**：某次 `pnpm test` 在 api 包退出 1，
  但输出只留下「Failed」，没有抓到具体用例名（tail 截断）。随后：单独跑 api **1 次通过**、
  再跑完整 `pnpm test` **1 次全绿**、单独跑 api **连续 3 次全绿**（819/819 ×3）——
  共 5 次连续不复现，暂无法归因（该仓历史上出现过计时敏感用例，例如加密集成用例的 CBC 填充概率）。
  记录方式与上一条相同：**不掩盖、不假装没发生**；未拿到可复现的最小用例前不动断言，也不加 `--forceExit`。
- 用例：`packages/mdop` **20 套 / 204 条**通过（含新增锚定接缝 `anchor/anchor.spec.ts` 6 条、collateral
  新鲜度 `attestation/collateral.spec.ts` 9 条、`pilot-harness.spec.ts` 的 anchored/pending 与
  「缺料/过期即拒」各一条）；`apps/api` **107 套 / 819 条**通过（含证明登记补锚 4 条、回执/销毁回执/阶段状态/接受拒绝/合约签署**冒名负例 5 条**）；
  **完整 `pnpm test` 退出码 0**
  （connector 侧 110 套 / 678 条通过、3 套 42 条跳过）。
- 新增的 enforcement：① `packages/mdop/src/anchor/anchor.ts#anchorChainHead`（协议 §10「锚定失败进补偿队列、
  不得伪造交易号」的唯一判据，场景进 orchestration-kernel 规格）；②
  `packages/mdop/src/attestation/provider.ts#createHardwareAttestationVerifier` 与
  `TrustedRootWithCollateral`（D-TEE-3 残余项 ①：真实信任根**必须**声明 collateral 策略，
  缺料/过期/超离线刷新窗口/时间倒挂一律拒），场景进试点 `attestation-provider` 规格；
  ③ `MdopAttestationService#retryPendingAnchors`（证明登记上链的补偿队列，30 分钟节拍、幂等、不写假号）；
  ④ 预算消耗与拒绝进签名回执链（`TrustedNodeSession` 的 `EXITED` 带 `budget`；超限追加 `STAGE_FAILED`
  并标 `charged:false`）；⑤ 会话见证的拒绝回执带**结构化错误码**（`WitnessVerificationRecord.code` →
  回执 `detail.code`；顺带修掉持有方回执助手静默丢弃 `detail` 附加字段的问题）。
  五处都已钉进本表的追溯行。
- **未变的边界**：以上全部是**替身与合成数据**下的证据。真实证明链、真实 KMS、假名键对齐
  （§3.12b）与带链上锚定的整跑（§8.5 / §9.2 / §9.3）仍未完成，任务清单里逐条留白。

## 11. 证据审计（2026-09-26，收口轮）

- **结论**：80 条 `[x]` 声称的路径/符号在仓内都找得到（简写路径已解析：
  `packages/mdop/attestation/release.ts` → `packages/mdop/src/attestation/release.ts`；
  `scripts/{build,check-reproducible,pairing-parity}*` → `packages/wasm-algorithms/scripts/`；
  `scripts/verify-receipt-chain.mjs` → `apps/connector/scripts/verify-receipt-chain.mjs`）。
  **没有一条因证据不存在或不覆盖而改回 `[ ]`**。
- **过时说明已就地更正（勾选不变）**：§1.2/§1.5 的「开关未开」快照；§3.13 旧稿「注册/心跳未落地」
  （已被 §3.1 覆盖）；§6.2 旧稿「数据面仍待做」（已被 §3.14 覆盖）；§8.5 旧稿「回执链仍是内存态」
  （已被 §3.16 覆盖）；若干用例条数回写为「落地当时 / 现行以闸门为准」。
- **10 条未勾全部是外部前置**，已各补解锁三段式（动作 / 归属 / 验收），仓内不能再推进。
- **DEPLOY.md §4.3** 组件表 #1 现状列已与 §3.1/§3.18 对齐；§9.5 把「离线核验」收窄为厂商 collateral。
- **SM4-GCM**：规格 / proposal / design / 协议 v0.2 / D8 落地补注口径一致（实现 AES-256-GCM +
  收回条件）。v0.1 §9.3 示例仍写 `SM4-GCM`，已加「权威在 v0.2」更正注。`docs/tech-debt.md`
  未单列此债（偏离已在 D8，不双记）。`docs/architecture-overview.html` 的
  「2026-09-26 续：把「谁在说话」补齐」一段未改。
- **本轮闸门实测（2026-09-26，完整 `pnpm test` 退出码 0）**：
  `check-meta-docs` 0 error / 14 warning；`check-c2-traceability` 104/104；
  `check-protocol-error-codes` 25/25；`check-tee-claims` 0 error（981 TS）；
  负例自检 **26/26**（含归档布局 4 条，见下）；`governance:negative` 2/2；`pnpm governance` 全部通过；
  `packages/mdop` 20 套 / 204 条；`apps/api` 107 套 / 819 条；
  `apps/connector` 110 套 / 678 条通过 + 3 套 / 42 条跳过。
- **归档顺序是硬的（2026-09-26 第二段实测）**：本变更**不能单独归档**，三步顺序如下——
  ① `openspec archive mdop-kernel`；② `openspec archive tee-confidential-node`；
  ③ `openspec archive tee-attestation-pilot`（试点只 `ADDED` 一张新能力，独立可归档）。
  原因：本变更的 `local-plan-review` / `node-artifact-lifecycle` 是 `## MODIFIED Requirements`，
  而被改的需求只存在于 `mdop-kernel` 的 `## ADDED Requirements` 里；先归档本变更会被工具直接拒：
  「local-plan-review: target spec does not exist; only ADDED requirements are allowed for new specs」。
  实测方式：把 `openspec/` 整份复制到临时目录跑三步归档——`mdop-kernel` `+40 / ~0 / -0` →
  本变更 `+24 / ~2 / -0` → 试点 `+4 / ~0 / -0`，三步均「Specs updated successfully」。
  **未在本仓执行归档**（任务尚未全勾，且归档是发布动作，须由人确认）。
- **归档不再把闸门弄红（2026-09-26 第二段修复）**：`scripts/check-c2-traceability.mjs` 原先只认
  未归档路径——表路径写死 `openspec/changes/tee-confidential-node/traceability.md`、上游场景只从
  `openspec/changes/<变更>/` 收集、id 前缀只认未归档目录名。**后果：一归档就红**（表找不到，
  且 `mdop-kernel` 的 22 条上游追溯记录全变「孤儿」），等于这两个变更永远到不了「可归档」。
  已改为：表 / 变更目录 / 上游来源一律 **active 优先、回退 `archive/<日期>-<名>/`**，上游 id 用
  **逻辑名**（去掉日期前缀）因此归档前后 id 不变；找不到、或同名归档有多份 → 一律报错（fail-closed，不猜）。
  证据：`scripts/check-c2-traceability.test.mjs` 新增 4 条归档布局自检（**13/13 绿，其中 2 条在修复前是红的**：
  归档后布局 0-error 与「同名两份归档」），合计负例自检 26/26；再把三步归档后的 `openspec/` 与真仓
  `apps/`、`packages/` 拼成临时根复跑——**0 error（104 个场景 / 上游 22 / 104 条记录）**，与归档前逐项相同。
- **归档后四道机检全扫（2026-09-26 第三段实跑）**：在「真仓代码 + 三步归档后的 `openspec/`」的
  完整镜像里跑四道机检，结论是**全绿**：`check-meta-docs` 0 error / **16** warning（基线 14）、
  `check-c2-traceability` 0 error / 104 场景 / 上游 22、`check-protocol-error-codes` 0 error / 25 码、
  `check-tee-claims` 0 error（981 TS）。即归档**不会**让 `pnpm test` 变红；唯一退化是 +2 条
  ARCHITECTURE.md 警告（警告不参与退出码）。
- **归档 runbook 第 4 步（已实测）**：那 2 条警告是 `ARCHITECTURE.md` 里对该变更路径的引用
  （`openspec/changes/tee-confidential-node` 与 `…/traceability.md`）。归档后把这两处改指
  `openspec/changes/archive/2026-09-26-tee-confidential-node/…`，在镜像里复跑 **警告精确回到 14 条
  且与基线逐条相同**（`diff` 为空）。所以完整归档顺序是：① `archive mdop-kernel` →
  ② `archive tee-confidential-node` → ③ `archive tee-attestation-pilot` → ④ 改指这两处引用
  （顺手把「变更已立」的措辞改成已归档）。
- **对外表述缺口（本轮发现，未擅自改）**：`docs/医院端数据流转流程-v2.md`（**已入库**，最后提交
  2026-09-07，**早于** D8③）在 4 处仍写「**全程国密 / 全链国密**」，并写「通道：SM2 密钥协商 +
  **SM4-GCM** 加密」。而 D8 的 `2026-09-26` 落地补注第 ③ 条明确「**对外表述 MUST NOT 声称
  「全链国密」或「国密信封」**」，实现层面也**没有 SM4-GCM**——连接器↔中心的通道是
  `secure-channel.service.ts` 的 **SM2 加密 + SM3 完整性 + SM2 签名**，全仓 SM4 只用于静态列加密 /
  KEK / LoRA 载荷（均为 CBC），C2 信封载荷是 AES-256-GCM。
  这份文档是**面向医院信息科 / 安全审计**的对外承诺，改它的口径属**医院/合规决策**，故本轮只登记、
  不擅自改（明细与建议改法见 `docs/tee-two-changes-audit-2026-09-26.md` §9.6）。
- **红线 1 的「声称的守护」补成真守护（2026-09-26 第四段）**：`TRUST.md` 红线清单第 1 条
  （`sm-crypto` 引用白名单）此前写「守护：grep（v2 自动化）」，但**那个守护从未被写出来**
  （仓内无 grep 脚本、无 ESLint 规则、无钩子），且白名单自 2026-09 起就与代码不符——实测**生产代码
  9 个文件**直引 `sm-crypto`，契约只列了 3 处（`packages/mdop/src/crypto/` 与
  `packages/wasm-algorithms/scripts/` 从未被列入）。本轮补上 `scripts/check-crypto-imports.mjs`
  （**挂进 `pnpm test`**，6 条负例自检）：未登记直引即红；**在册偏离还清后仍留在名单里也判红**
  （防名单变成永久豁免）；名单条目路径不存在判红。字面之外的 3 处控制面直引如实登记为**在册偏离**
  （**不是合规**，写进 TRUST 红线 1 并扩项 `docs/tech-debt.md` TD-5，各带偿还方向）。
  这与本变更 §9.5 记下的「声称存在但从未实现的守护」是**同一类缺陷**，处置口径也相同（v2 → 实机检）。
  实测：真仓 0 error（白名单 6 + 在册偏离 3）；临时注入一个未登记直引文件 → **当场判红（exit 1）**，
  移除即恢复 0。负例自检总数 26 → **32/32**（四道机检 + 新增这道）。
- **守护清单对账：声称的 ↔ 存在的 ↔ 真被跑的（2026-09-26 第五段）**。上一段补了红线 1 的守护，
  这一段把「守护」这件事本身对账一遍，两侧都查：
  - **存在但没人跑？** 无。仓内校验脚本共 10 个（5 道机检 + 4 份负例自检 + `governance/negative-verify.mjs`），
    **全部在 `pnpm test` 链里**；另有 `packages/wasm-algorithms/scripts/check-reproducible.mjs`
    由该包 `test` 脚本随 `pnpm -r test` 跑到（其 README 写「挂进根 `pnpm test`」**属实**）。
  - **声称但不存在？** 除上一段修掉的红线 1 之外，逐条对过 TRUST / DOMAIN / FLOWS / DECISIONS /
    ARCHITECTURE / AGENT / EVIDENCE / REGULATORY / AGENT-OPS / AGENTS 十份里的守护声明：其余点名的
    脚本都真实存在且真被跑。`AGENT-OPS` §7 的 `X-1`…`X-6` 是**已登记的「无机器守护」缺口**
    （每条带失效条件），属如实登记，不是漏项。
  - **本轮发现并修掉的**：入口指针 `AGENTS.md` 自己漂了——它写「三个专用守护
    （`check:tee`/`check:trace`/`check:errors`）」，而上一段刚加了第 4 道 `check:crypto`；
    且它说这些**全部挂在 `pnpm test` 里**，但 `pnpm governance`（工厂 schema 对拍）**并不在** `test` 链里
    （只有 `governance:negative` 在里面）。两处都已修：AGENTS.md 去掉数量、列出四道守护、
    并声明「清单以 `package.json` 的 `test` 链为准」（这正是工厂判据 AG-3「写数字的文档注定漂移」
    的理由，此前那句「三个」就是活例）；`package.json` 的 `test` 链补上 `pnpm governance`，
    让「全部挂在 `pnpm test` 里」**变成真的**而不是措辞。
  - 证据：`pnpm governance` 输出 `✓ AGENTS 入口指针：7 本元语指针可解析 · 无数字断言 · 无契约段`；
    按新链条重跑根链全绿——5 道机检（meta 0/14 · trace 104/104 · errors 25/25 · tee 0/981 · crypto 0/9）
    + 自检 32/32 + `pnpm governance` 全部通过 + 负向验证 2/2；完整 `pnpm test` 退出码 0。
- **最后两个没跑过的闸门：`build` 与 `lint`（2026-09-26 第六段）**。前几段跑的是 `pnpm test` 链与治理闸门，
  这段补跑另外两处，并抓到一个陷阱。
  - **`pnpm build`：退出码 0**（`pnpm -r build`：`nest build` ×2 + `next build` + `tsc` ×3）。
  - **`pnpm lint` 此前过不去**（husky `pre-commit` 的唯一一步就是它）。apps/api 只读实测（故意**不加**
    `--fix`，那会重排工作区里正在改的约 50 个文件）：**1236 error / 53 warning、51 个文件**，
    其中 1235 条是 `prettier/prettier`，剩 **1 条不可自动修复**——`src/mdop/mdop-jobs.spec.ts:306` 的
    `@typescript-eslint/no-var-requires`。因为脚本带 `--fix` 但修完仍剩这 1 条 ⇒ **退出码 1 ⇒
    pre-commit 永远过不去**。已把那处动态 `require` 改回**顶层具名导入**（该文件本就 import 了
    `@medtrust/mdop` 的三个符号，`validateEdge` 由 `export * from "./label/lattice"` 导出）。
    证据：`eslint --fix-dry-run`（应用修复但**不写盘**）→ **退出码 0、剩余 0 error**（53 warning）；
    该 spec 单跑 14/14 通过。**其余 1234 条 prettier 全部可自动修复，但没有代跑 `--fix`**——
    它会把 WIP 的 50 个文件一起重排，属用户的取舍。
  - **死配置 `apps/api/.eslintrc.json`（已删）**：`apps/api` 同时有 `.eslintrc.js` 与 `.eslintrc.json`，
    而 ESLint 同目录只认一个（顺序 `.js` > `.cjs` > `.yaml` > `.yml` > `.json`）。`eslint --print-config`
    实证生效的是 `.js`（`no-unused-vars` 是 `["warn",…]` 而非 `.json` 的 `off`；含 prettier 插件；
    `no-prototype-builtins` 未设置——`.json` 那条 `extends eslint:recommended` 根本没进来）。
    即 `.json` 里每一条都不生效，而此时尤其危险：想静音那 1234 条 prettier 错误，最自然的动作就是去改
    `.eslintrc.json` 关掉 `prettier/prettier`——**改了不会发生任何事**。已删除（无人显式引用；
    可用 `git show HEAD:apps/api/.eslintrc.json` 取回），删除后 `--print-config` 仍解析到 `.js`、
    单文件 lint 退出码 0，**行为零变化**；若本意是那套更宽松的规则，改的地方是 `.eslintrc.js`。
