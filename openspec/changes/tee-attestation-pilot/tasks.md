# TEE 试点任务（Q2 证明链选型 / Q4 首个场景）

> 产出是**决策依据**，不是实现。任何一项拿不到实测条件的，必须在结论里标注「未实测/推断」，
> 不得用推断冒充实测（本仓的如实边界原则）。

## 1. 证明链选型（Q2）

- [x] 1.1 候选矩阵（**基于公开资料版，未实测**）：见 design 的「P1 候选矩阵」——三候选 × 六判据，
  每格标注证据等级（`[公开资料]` / `[未核实]` / `[需申请]` / `[本仓已验证]`），并附来源清单（检索日 2026-09-25）。
  其中「换链成本」一格是**本仓已验证**的：三种链的 quote 都能落到同一份证明契约（`mapVendorQuote` + 用例）。
- [x] 1.2（2026-10-14 可获性已在实践中确认：云上 TDX `g8i` 实例可开通并跑通真机全链 —— 见 `openspec/changes/tdx-attestation-pilot/evidence/rerun-20261014/`）原始文字：可获得性核实：**部分完成（2026-09-26 补检索，把「机型/区域」这一层做实）**——
  公开资料层面已确认「三家都能买到、云上都有路径」，且现在**具体机型代号/区域路径**也有出处：
  **TDX**：阿里云第八代企业级 ECS 集成 Intel TDX（g8i/c8i/r8i 一族，官方有「在 TDX 机型上搭建机密计算环境」
  文档），第九代 Intel 实例（c9i/g9i/r9i）已商业化并在国际站部分地域（中国香港/新加坡/印尼）可用；
  Azure 机密 VM SKU `DCesv5/DCedsv5/ECesv5/ECedsv5`（Intel TDX，另有新一代 `DCesv6/ECesv6`）；
  GCP Confidential VM on `C3`。**SEV-SNP**：Azure `DCasv5/ECasv5`、GCP Confidential VM（AMD 系列）。
  **CSV**：国产云 CSV 机密计算环境 + 厂商远程证明（含 pre-attestation）已铺开，**整机以海光 3/4 号 CPU 为主**。
  **仍未完成的部分（本项在拿到这些前不勾）**：① **开通/配额/审批周期**与② **信创整机的采购**（`[需申请]`），
  需要运维/采购侧给出；③ 「院内无外网时证明服务可达性」**仅当节点部署在院内时**才是 P4 已列明的动工前工程前置
  （云上默认形态 collateral 可在线取，该项不是共同前置）。院内路径三个候选的自托管方案见 P4，残余是运维落地。
  来源与检索日见 design「P1 候选矩阵」的来源清单（2026-09-25 与 2026-09-26 两批）。
  - **解锁三段式**：
    (a) **解锁动作**：运维/采购提交并拿到 ① 云上 TDX/SEV-SNP 的开通与配额批文（含审批周期），
    ② 信创 CSV 整机采购合同或明确「不走信创」的书面口径，③ **仅当节点部署在院内时**才需要的
    院内无外网时证明服务可达性方案
    （PCCS 私有化 / 预取 collateral / 自托管 CoCo / 缓存 VCEK，三选一并签字；
    云上默认形态 collateral 可在线取，该项不是共同前置）；
    (b) **归属方**：运维 / 采购（①②）+ 医院网络 / 运维（③）；
    (c) **验收证据**：批文/合同/方案原件入台账；design P1 对应格子从 `[需申请]` 改为
    `[本仓已核实]` 并写检索日与单据编号。公开机型资料**不得**用来勾本条。
- [x] 1.3（2026-10-14：真实证明打通 —— 出 quote → 校验到厂商根 → 提取度量与 TCB（TCB 5.1.3 / MRTD `sm3:14761963…a2ce2`）→ KMS 释放 → 解封执行闭环，证据同 `tdx-attestation-pilot/evidence/rerun-20261014/`）原始文字：真实证明打通（条件：拿到机器）：出 quote → 校验链到厂商根 → 提取度量与 TCB →
  用一次性公钥封装密钥 → 记录端到端耗时与结论；**未拿到机器则记为未实测**。
  - **解锁三段式**：
    (a) **解锁动作**：在 §1.2 解锁的机器上跑通「出 quote → 验到厂商根 → 提取度量与 TCB →
    用一次性公钥封装密钥」；
    (b) **归属方**：硬件 / 运维（与 `tee-confidential-node` §3.2/§4.1 同一批前置）；
    (c) **验收证据**：真实 quote 原文（或其 SM3）+ 校验日志（链到厂商根）+ 提取出的
    `measurement`/`tcb`/`ephemeral_public_key` + 封装往返耗时。未拿到机器则保持「未实测」，
    **不得用推断或软件替身勾选**。
- [x] 1.4 离线/受限网络下的校验方案（**资料层面已完成，见 design「P4」**）：本轮追加检索把原先的
  「CSV 与 SEV-SNP `[未核实]`」推进为**各家机制不同的可自托管路径**——
  **TDX**：PCCS 私有化（官方设计指南的缓存填充模式）+「预取 collateral 完全离线校验」（`dcap-qvl` 自述）；
  **CSV**：自托管 CoCo trustee `attestation-service`（含策略引擎）+ RVPS 参考值（CNCF 官方博客称已在海光
  CSV 上生产部署，OpenAnolis SIG 有实践文档）；
  **SEV-SNP**：VCEK → ASK → ARK 链，VCEK 取一次后缓存离线验签（`[公开资料，非厂商权威]`）。
  - **残余未实测项（两条，已在 P4 列明并写进 D-TEE-3）**：① **collateral 新鲜度策略**——
    CRL/QVL/VCEK 会轮换、TDX 还有 TCB 恢复，气隙网络必须定「离线刷新窗口 + 过期即拒」，
    KMS 侧真实 `TrustedRoot` 实现必须带 collateral 有效期；② **厂商根的获取程序**（带入院内须留档）。
    - **① 的判据已落地（2026-09-26 补）**：证明契约带 `collateral`（种类 / 摘要 / 取回时间 / 自身有效期，
      跨网络走严格解析）；`TrustedRootWithCollateral` 把「必须随带的种类 + 离线刷新窗口」做成真实信任根的
      **必填字段**，`createHardwareAttestationVerifier` 产出「验 quote + 判材料时效」的校验器：缺料 /
      已过期 / 超出刷新窗口 / 时间倒挂一律拒（`E_ATTESTATION_FAILED`，KMS 不释放）。
      证据：`collateral.spec.ts`（9 条）、`pilot-harness.spec.ts` 的释放路径用例；规格场景进
      `attestation-provider` 并钉进追溯表。**剩余的只是运维动作**（刷新节奏与厂商根台账）。
    - ② 仍是纯运维/合规动作：没有任何代码能替它完成。
  - 结论：D-TEE-3 的两条分支都不因离线校验不可行而失效；但上述第 ① 条**仅当节点部署在院内时**才是部署前的硬要求（云上默认形态 collateral 可在线取）。
- [x] 1.5 换链代价验证（**已完成，不改协议即换链**）：三种候选的 quote 字段全部映射到同一份证明形态
  ——`mapVendorQuote` 产出 `measurement` / `level` / `isolation` / `quote_digest` / `tcb`，
  本轮又补齐了协议 §9.4 要求、此前缺失的两项：**一次性公钥**（`ephemeral_public_key`，数据密钥的封装目标）
  与**身份绑定**（`node`）。三段证据：
  ① `provider.spec.ts`「三种链都能落到同一形态」「映射后的三种链都能通过各自策略的 C2 判定」；
  ② `pilot-harness.spec.ts` 用**同一段管线代码**跑 TDX 与 CSV 两遍、事件序列一致；
  ③ `apps/connector/src/mdop/node/c2-session.spec.ts` 在**连接器侧节点会话**上换链（TDX → CSV），
  除证明提供者与合约阈值外管线一行未改、结果一致。
  - **发现必须改协议的点**（已逐条回写）：① 跨链 TCB 版本不可互比 → `min_tcb` 支持按链给出（P3 发现 1，已落地）；
    ② 证明报告必须携带一次性公钥与身份绑定——原协议 §9.4 有文字要求但契约里没有字段，本轮补上（P3 发现 4）；
    ③ 错误码复用而非新增（P3 发现 2）。**结论：换链＝换提供者 + 换信任根与合约阈值，协议与调用点不动。**
- [x] 1.6 结论（**推断版，已写入 design 与 DECISIONS D-TEE-3**）：默认推荐 + 触发条件两条——
  ① 有信创硬要求 → CSV 优先、云上机型仅作开发床；② 无信创要求且要快速点亮 → 云上 TDX 先打通、CSV 作生产目标并行申请。
  并且写明**解除条件**（拿到机器并出一次真实 quote 才算实测）与条件化前置（**仅当节点部署在院内时**，院内无外网时的证明可达性/离线核验才是动工前前置；云上默认形态 collateral 可在线取）。

## 2. 首个业务场景（Q4）

- [x] 2.1 候选 A（跨院队列交集）评估（**已完成**）：**现有合成数据里没有「同一主体跨院出现」**——
  `data/rws-test-data/records.json` 的主体键是院级作用域（`demohospa-syn-*` / `demohospb-syn-*`，
  两院各 5000 条无一条跨院）；`data/synthetic/amr/{demohospa,demohospb}/episodes.jsonl` 的 subjectKey
  交集为 **0**。因此该形态必须**专门构造**，并配可对齐假名键：跨院 PSI（不共享盐、交互式求交）
  或全空间共享盐（构造简单、但对齐基础设施一旦泄露则跨院可链接）。两者成本对比见 design P2 表。
- [x] 2.2 候选 B（亚组与切点重算）评估（**已完成**）：分层维度（`ageBand`/`sex`/`conditions`）
  与切点都在既有记录里，**数据现成**；工程上复用既有节点/闸门/回执链，属「换一种查询」。
  价值边界：C3 下能做但须重跑整个作业（编译→要约→复核→凭证），C2 下同会话出表 →
  **是效率增量，不是能力增量**，因此不得单独论证 C2 的必要性。
- [x] 2.3 逐项打分（**已完成，见 design「P2 结论」表**）：六判据逐格标注证据等级，
  产出**首选 A（跨院队列交集）+ 备选 B（亚组重算）**；且 A 已在合成数据上闭环
  （`apps/connector/src/mdop/node/c2-session.spec.ts`：两院共享假名键 → 节点内配对 → 只出 C3；
  并用 `pairing.ts` 的 `joinableBounds` 断言「只用边际计数时交集不可判定」）。
- [x] 2.4 首选场景的前置条件清单（**已完成**）：① REG 路径 + 医院书面接受运营方与 KMS 归属；
  ② 可对齐假名键方案定稿（PSI 或共享盐）；③ 配对算子 wasm 模块入库 + 注册中心签发清单；
  ④ 预算与发布审查在节点内强制（D-TEE-2，已落地）。**① 或 ② 不满足即不启动真实数据**；
  合成数据演练不受限。
- [x] 2.5 与 `tee-confidential-node` 排期对齐（**已完成**）：A 落在该变更**迁移步骤 4（两院 C2 汇聚）**
  与**步骤 6（真实数据前合规闸）**之间；§9.3 的真实数据演练必须排在 ①② 之后。

## 3. 软件实现的边界与接口替身验证（不需要硬件）

- [x] 3.1 用现有 `TeeEnclave` / `SoftwareSealedCompute` 跑通骨架：seal → 证明占位 → 释放占位（mock KMS 按 D-TEE-1 判据打桩）
  → 节点内执行 → 发布审查 → 只出 C3 → 回执链 → 链头锚定。
  - **两处骨架互补**：
    ① 协议核侧（不依赖任何 app）：`packages/mdop/src/attestation/pilot-harness.spec.ts`
      ——封存/AAD → 证明 → `evaluateKeyRelease` → 节点内执行 → minCell 闸门 → 只出 C3 → 回执链 →
      **链头锚定**（`anchorChainHead`）；
    ② **连接器侧用仓库既有的 `TeeEnclave` / `SoftwareSealedCompute`**：`apps/connector/src/mdop/pilot-tee.spec.ts`
      ——`SoftwareSealedCompute.seal/run` 承担「节点内执行」那一半（换硬件时替换的是它的实现，调用点不动），
      证明与 KMS 由独立提供者承担（软件提供者恒 `software/none`，只用于证明接口通；硬件替身用于验证换实现），
      链头同样走 `anchorChainHead`。
    ③ **锚定那一步不再是「只断言链头可锚」**（2026-09-26 补）：协议核新增
      `packages/mdop/src/anchor/anchor.ts#anchorChainHead`——有写入端 → `status=anchored` + `tx_id` +
      `anchored_at`；未接链 / 写入失败 / 写入端没给交易号 → `status=pending`，且记录里**没有 `tx_id` 键**
      （协议 §10 原文：锚定失败进补偿队列重试，不得伪造交易号）；链头形状非法则直接抛错
      （调用方 bug 不得降级成 pending）。证据：`anchor.spec.ts` 6 条 + 两处骨架各一条
      （接链 → anchored、未接链 → pending），并已补规格场景与追溯行
      （`tee-confidential-node` 的 orchestration-kernel「存证链不可达时的锚定记录」）。
      **为什么值得单列**：此前本项写着「跑到链头锚定」，但**协议核的 `anchorRecord` 当时是零调用方的
      死 schema**，「链不可达只记 pending」只存在于平台回执链服务（部署侧）——现在协议核与两处骨架
      共用同一份判据。
  - 释放判据本身进了生产代码：`packages/mdop/src/attestation/release.ts`（KMS 实现只需调它，不各写一套）。
  - **如实边界**：软件提供者**过不了** C2 判定（有用例），所以两处骨架都**不能**当作「C2 已可用」的证据。
- [x] 3.2 断言软件实现**不可能**被当作 C2 目标：`level=software` 或 `isolation=none` 的节点
  在判定中 MUST 被拒（用例固化，防后人「先用软件顶上」）。
  - 已落地在协议核心：`packages/mdop/src/attestation/provider.ts` 的 `verifyAttestationForC2`，
    含「软件实现恒 software/none」「声明 hardware 但 isolation=none 也拒」「哪怕政策与信任根都齐全仍拒」三条用例。
  - 连接器与编译期的**调用点接入**归 `tee-confidential-node` §5.2 / §6.5。
- [x] 3.3 证实「除证明提供者与 KMS 客户端外无需改动任何调用点」，把该结论写成可复跑的验收测试。
  - 已落地两条可复跑用例：① `mapVendorQuote` 把三种链的原生 quote 映射到同一份证明形态
    （度量 / TCB / 有效期 / quote 摘要不丢）；② `pilot-harness.spec.ts` 里「TDX 换 CSV」用
    **同一段管线代码**跑两遍，事件序列与产出完全一致，只有释放凭据摘要不同。
  - 第三条（连接器侧）：`pilot-tee.spec.ts` 里「软件提供者 vs 硬件替身」共用**同一段 `TeeEnclave` 管线**
    与同一段发布审查/出口逻辑，差别只在「谁出证明、谁释放密钥」——即换硬件时改的是两个类，不是管线形状。
  - **第四条（KMS 客户端那半边，2026-09-26 补）**：结论里写的是「除**证明提供者与 KMS 客户端**外无需改动调用点」，
    但此前只有「未注入真实 KMS 客户端即拒」的接缝用例，**没有换实现的等价性验证**。现补：
    `c2-session.spec.ts` 里新增一份**独立的 `KmsClient` 实现**（`SelfHostedKmsDouble`，模拟持有方自建 KMS，
    不复用 `LocalDevKms`，只用协议核共享的 `evaluateKeyRelease` 与国密原语），信封改写成「密钥由该 KMS 保管」，
    跑**同一段会话代码**：断言 ① 真的用了新实现（`kmsRef` 与调用计数）；② C3 载荷与回执事件序列与演练 KMS **完全一致**；
    ③ 回执链仍可验签。规格补场景「换 KMS 客户端不动调用点」并进追溯表。
  - 结论：换链 = 换提供者 + 换信任根与合约阈值，协议与调用点不动。
- [x] 3.4 在文档/元语中复核 SoftwareSealedCompute 的表述：`level=software`、`isolation=none`、
  「软件隔离不得表述为 TEE」（D9 / CTL-09），确保试点产出没有引入越级表述。
  - 已把「软件实现不得作为 C2 目标」写进试点 spec（能力 `attestation-provider`）与 D-TEE-1/D-TEE-2。
- [x] 3.5 **已产出的两项契约修正**（写进 design 的「P3 已产出的发现」）：
  ① 跨链 TCB 版本不可互比 → `min_tcb` 支持按链给出、不可比即 fail-closed（含用例）；
  ② 错误码复用 `E_ATTESTATION_FAILED`（原为死词表）而非新造 `E_ATTESTATION_INVALID`，
  只新增 `E_MEASUREMENT_NOT_ALLOWED` / `E_TCB_TOO_OLD`。
  - 协议 §9.3 的 `attestation_policy` 示例已补注；`tee-confidential-node` 的 design/tasks/spec 已同步改名。
  - ③（2026-09-26 补，见 design 发现 6）：**锚定的两态必须有唯一判据**——`anchorRecord` 原先零调用方，
    本轮把它接上 `anchorChainHead` 并固化「已锚必须有交易号、未锚必须没有 `tx_id` 键」；
    平台回执链服务按其适配器的 `0xLOCAL:` 降级回执判据独立记 pending（等价但未合并——合并要动
    平台落库形状，另立）。
  - ④（2026-09-26 补，见 design 发现 7）：**`collateral` 是一次协议字段扩展，按本变更的规则登记**。
    规格要求「既有契约装不下时 MUST 记录为设计缺陷、MUST NOT 就地扩展字段」；离线 collateral 的
    时效（取回时间 / 自身有效期）在既有契约里确实无从表达，因此加了 `collateral` 字段，并把
    影响面（严格解析、`TrustedRootWithCollateral`、`createHardwareAttestationVerifier`）与
    「为什么不塞进 `quote_digest`/`tcb`」写进 design。两个新场景已进 `attestation-provider` 与追溯表。

## 4. 决策回写

- [x] 4.1 Q2 结论 → `DECISIONS.md` 新增 **D-TEE-3：证明链选型（条件式默认）**，
  明确标注「公开资料推断、未实测」，并写清解除条件（拿到机器出一次真实 quote）与条件化前置（**仅当节点部署在院内时**，院内无外网时的证明可达性/离线核验才是动工前前置；云上默认形态 collateral 可在线取）。
- [x] 4.2 Q4 结论 → `DECISIONS.md`（**已完成**）：新增 **D-TEE-4「首个 C2 业务场景首选跨院队列交集」**，
  含六判据打分、四条硬前置（缺一不启动真实数据）、与 `tee-confidential-node` 迁移步骤 4/6 的排期对齐，
  并明确标注**价值项为推断**（未经业务方书面确认）与「② 假名键方案未定前只跑合成数据」。
- [x] 4.3 更新 `tee-confidential-node`（**已完成**）：design 的 Q2/Q4 由待定改为定稿（Q2→D-TEE-3 条件式默认、
  Q4→D-TEE-4 首选 A/备选 B），迁移步骤 4 写明「首个真实增量能力＝跨院主体配对」，
  tasks 按结论收窄：证明代理按 D-TEE-3 的两条分支收敛、配对算子与假名键对齐列入步骤 4 前置。
- [x] 4.4 三个闸门（**已完成**）：`node scripts/check-meta-docs.mjs` 0 error、`pnpm governance` 通过、
  `openspec validate --strict` 对 `tee-attestation-pilot` 与 `tee-confidential-node` 均 valid。

## 5. 证据审计（2026-09-26，收口轮）

- **结论**：18 条 `[x]` 声称的 design 段落 / 用例 / 决策条目均存在且覆盖对应要求。
  **没有一条因证据不存在或不覆盖而改回 `[ ]`**。
- **2 条未勾（1.2 / 1.3）**全部是外部前置（采购/审批/真实机器 quote），已各补解锁三段式。
  仓内不能再推进；软件替身与公开资料不得用来勾选。
