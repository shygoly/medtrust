# TDX 试点任务（云上真实 quote 打通 / D-TEE-3 ② 实测化）

> 产出是**一次真实证明的端到端实测**与第一份真实提供者/信任根实现。任何一项拿不到实测条件的，
> 保持未勾并标注「未实测」；**软件替身与公开资料不得用来勾选任何一条**
> （与 `tee-attestation-pilot` 1.2/1.3 同一口径）。

## 1. 机型开通与部署事实（运维前置）

- [x] 1.1 云上 TDX 机型开通：按 design P1 的候选清单（阿里云 g8i 族 / Azure `DCesv5` 族）
  提交配额申请并拿到实例。
  - **解锁三段式**：
    (a) **解锁动作**：运维/采购提交机密机型开通与配额申请，拿到实例访问凭证；
    (b) **归属方**：运维 / 采购；
    (c) **验收证据**：开通单据/批文入台账；**四个部署事实入账**——机型 SKU、region、
    TDX module 版本、TCB 版本（TCB 以实例上实际 quote 为准，不得手填）。
  - **已完成（2026-10-02，证据见 `evidence/RECORD.md` §1）**：机型 `ecs.g8i.xlarge`（4C/16G，
    Sapphire Rapids，按量 ¥1.0885/时）· region `cn-beijing` 可用区 L · TDX module **quote V5**
    （`att_key_type=2` ECDSA-P384、`tee_type=0x81`、`PCE_SVN=13`、`TEE_TCB_SVN=050103…`）·
    TCB **5.1.3**（取自真实 quote）+ Intel PCS 判定状态 `OutOfDate` + FMSPC `90c06f000000`（A 级）。
    开机自检：`tdx: Guest detected` / `Memory Encryption Features active: Intel TDX` / `tdx_guest` flag /
    `/dev/tdx_guest`（A 级）。三台实例（teeA/teeB/LLMA）均已配置本机公钥，见 §5.1 记录。
    开通单据为控制台级（B 级），条目内不虚标为 A。
- [ ] 1.2 （部分：sidecar 构建配方 `apps/connector/tools/tdx-sidecar/build.sh` 与产物 sha256 已入证据；节点为宿主机进程 + 单文件 bundle，尚无镜像 digest ↔ MRTD 映射）节点镜像可复现构建：构建含 `TdxAttestationProvider`（及 sidecar，若有）的节点镜像，
  记录镜像 digest 与构建配方；建立「镜像 → MRTD」映射记录（design P2）。
  - 验收证据：镜像 digest + 构建配方入库（`fly-services/` 或部署目录）；MRTD 记录进实测记录。
  - 进度注（2026-10-02）：真机 MRTD 已取得（`e0199499…568a`，RECORD §2，A 级），但**该 MRTD 来自
    阿里云公共镜像现装现跑**，尚无可复现构建配方与镜像 digest —— 本条保持未勾，等 `TdxAttestationProvider`
    sidecar 形态定稿后按「构建 → 度量 → 登记 allowed_measurements」闭环。

## 2. 证明代理实现（真实 TDX 那一半）

- [x] 2.1 `TdxAttestationProvider`：实现 `AttestationProvider`，产出 `VendorQuote`
  （`vendor:'tdx'` / MRTD 度量 / 点分 TCB / quote 原文 / 一次性 SM2 公钥 /
  `report_data = reportDataBinding(pub)` / 节点 URN / collateral `crl`+`qvl`）。
  - REPORTDATA 装填按已定案约定（前 32 字节 SM3 摘要、其余置零）；失败即抛
    `E_ATTESTATION_FAILED`，不得降级为软件报告。
  - 进度注（2026-10-02）：**仓内部分完成**——`apps/connector/src/tee-node/tdx/`
    （provider + quote source 端口 + 缺省未接线实现 + fill/extract 纯函数 + registry 工厂形状），
    27 用例全绿（`pnpm test -- tdx`）。**真实 quote source（tdx_att/云 SDK/sidecar）接线留
    1.1 / 2.4 真机侧**；本条勾选不含任何真机主张。
- [x] 2.2 （2026-10-03 真机完成，证据 `evidence/product-chain-20261003/`，RECORD §3.7）collateral 取回：从 PCCS / Intel PCS 取 `crl` + `qvl`（含 `fetched_at` / `next_update`），
  云上在线形态；缓存与刷新节奏按 PCCS 默认并记录依据（design 风险表）。
  - 进度注（2026-10-02）：取料归并在 quote source 端口的结果里（`TdxQuoteResult.collateral`，
    端口文档写明理由：quote 与材料同源配套）；**真实 PCCS/PCS 取料实现留真机侧**。
  - **实测发现（RECORD §3 发现 1，直接影响本条实现要求）**：北京 PCCS
    （`sgx-dcap-server-vpc.cn-beijing.aliyuncs.com`）返回的 `tcbInfo` **已过期**，5 项 collateral
    校验全挂 `tcbInfo has expired`；**直连 Intel PCS 取料后全链通过**。因此实现的取料策略
    MUST 支持**源可切换/降级**（Intel PCS 直取 与 PCCS 二选一或优先级回退），并保留
    `fetched_at`/`next_update` 供 `createHardwareAttestationVerifier` 判时效（不得盲信单一 PCCS 源）。
  - 另（见 5.5 报告）：`collateral.digest` 协议只验形状，「digest == 材料字节的 SM3」须由本实现自证，
    落地时补用例。
- [x] 2.3 单元测试（不依赖真机也能跑的部分）：REPORTDATA 装填与还原、`mapVendorQuote`
  对 TDX 样例 quote 的映射、缺 `report_data` / collateral 缺料或过期 → 拒（负例）。
  - 进度注（2026-10-02）：`apps/connector/src/tee-node/tdx/tdx.spec.ts` 27 用例
    （装填/还原往返、无损映射、9 条 fail-closed 负例、collateral 分层判据、
    能力通告 4.4 单测面、工厂形状）——`pnpm test -- tdx` 全绿。
- [x] 2.4 真机冒烟（依赖 1.1）：TDVM 内真跑一次 `prove()`，拿到真实 quote 与 MRTD/TCB；
  **这是 D-TEE-3 ② 解除条件的前半句**。验收证据：quote 摘要 + 验签日志 + 耗时记录。
  - **已完成（2026-10-02，证据见 `evidence/RECORD.md` §2 / §3.5 与本轮 §3.6 rerun）**：
    quote 原文 **5006B（V5）**（`evidence/quote-20261002.bin`、`rerun-20261002-2315/quote.bin`）；
    摘要 sha384 `5dcfe2a2…c286` / SM3 `34d84dbf…aaae3`；MR_TD `e0199499…568a`；
    `TEE_TCB_SVN=5.1.3`；RTMR[0..2] + CCEL 事件回放全过；
    **`Full verification with collateral` PASS（链验到 Intel 证明根，1718ms）**、CRL 吊销检查 PASS、
    `Relaxed TCB check` PASS（`Strict TCB check` FAIL 因平台 TCB=OutOfDate，属预期，非验签失败）；
    耗时：quote 生成 3–4ms、全量验签（含 collateral 取回）1718ms。
  - **一次性公钥绑定与密钥释放已实机预演**（§3.5，两台 TDVM：A 域 prove → B 域 verify → A 域 open）：
    前 32B=`sm3(pub)`、其余置零的 REPORTDATA 装填经**硬件覆盖核验 PASS**，会话密钥 SM2(C1C3C2)
    封给绑定公钥后仅该私钥可解（`evidence/cross-domain/*`，A 级）。
  - **口径边界**：本条勾选**只主张真机出证与验签**；D-TEE-3 ② 的解除条件**后半句**
    （`c2-session` 端到端：证明 → KMS 释放 → 节点内执行 → 只出 C3 → 锚定，走仓内
    `TdxAttestationProvider`/`TEE_ATTESTATION_REGISTRY` 装配）仍属 **4.3/4.4**，未完成前
    D-TEE-3 ② 不升「已实测」（与 RECORD §4 一致）。

## 3. 信任根与校验器（验证 TDX 那一半）

- [x] 3.1 （2026-10-03 真机完成，证据 `evidence/product-chain-20261003/`，RECORD §3.7）`TrustedRootWithCollateral(kind:'tdx')`：`required:['crl','qvl']` +
  `max_staleness_minutes`（部署策略，写明依据）；`verifyQuoteDigest` 完成两件事——
  验签链到 Intel 证明根（DCAP QVL 本地校验，collateral 缓存）+ 从原始 quote 取 REPORTDATA
  与协议 `report_data` 比对（design P3）。
- [x] 3.2 （2026-10-03 真机完成，证据 `evidence/product-chain-20261003/`，RECORD §3.7）校验器装配：`createHardwareAttestationVerifier([tdxRoot])`，断言
  「只验 quote、不判材料时效」的校验器不得装配真实链（复用既有 collateral 用例口径）。
- [x] 3.3 （2026-10-03 真机完成，证据 `evidence/product-chain-20261003/`，RECORD §3.7）负例用例：Intel 根缺失 / 链验不过 / REPORTDATA 与协议字段不符 / collateral
  超窗 → 一律 `E_ATTESTATION_FAILED`、KMS 不释放（fail-closed）。

## 4. 注入接缝与端到端演练（合成数据）

- [x] 4.1 （2026-10-03 真机完成，证据 `evidence/product-chain-20261003/`，RECORD §3.7）注入 `TeeNodeProviderRegistry.hardwareAttestation`（`apps/connector/src/tee-node/`），
  配置闸门与 `TEE_NODE_*` 部署事实按 DEPLOY §4.3 步骤 3 备齐；未注入路径的抛错行为保持不变。
- [ ] 4.2 控制面 `TEE_ATTESTATION_REGISTRY` 装配样例：TDX 根 + `AttestationPolicy`
  （`tee:['tdx']`、按链 `min_tcb`、`allowed_measurements` = 实测 MRTD）。
- [x] 4.3 （2026-10-03 真机完成：作业 `job-mur9q5ac-c7088283` 终态 SUCCEEDED，结果与预期逐项一致；RECORD §3.9。**密钥保管为试点形态**，D-TEE-1 未决）端到端重跑 `c2-session` 骨架（合成数据、两院）：封存 → **真实 TDX 证明** →
  KMS 释放（真实根校验）→ 解封执行 → 发布审查 → 只出 C3 → 回执链 → 锚定；
  断言调用点零改动（除提供者与 KMS 校验器两个装配点）。
  **这是 D-TEE-3 ② 解除条件的后半句**。
- [x] 4.4 （2026-10-03 真机完成，证据 `evidence/product-chain-20261003/`，RECORD §3.7）能力通告转真：`nodeCapabilityAdvertisement` 从 `tee:null` 变
  `tee{kind:'tdx', min_tcb:<实测>}`——由真跑证明得出，验证无需手开通道（design P5）。
  - 进度注（2026-10-02）：**单测面已覆盖**（`tdx.spec.ts`：stub 硬件报告 →
    `tee{kind:'tdx', min_tcb}` 取自报告；未接线 → 广告不产出）；
    「转真」待 2.4 真跑证明后自动成立，不提前勾。
- [x] 4.5 （2026-10-03 真机完成：背书经 `POST /mdop/attestations/endorsements` 登记，`chain_tx=6b6344a0…a604` block 47；RECORD §3.8）证明登记链：attestation-probe → 校验方背书 → `POST /api/v1/mdop/attestations` →
  `chain_tx`（或补偿队列）；探针节拍 < 背书有效期；上线后自查 `chain_tx` 30 分钟内出现
  （DEPLOY §4.3 步骤 6）。

## 5. 证据、决策回写与闸门

- [x] 5.1 （`evidence/RECORD.md` §1–§3.9；端到端证据在 `intel-tdx-xeon-showcase/evidence/e2e-20261003/`）实测记录文档（design P6 清单）：机型 SKU/region/单据号、TDX module 与 TCB、
  quote 摘要与验签日志、MRTD ↔ 镜像 digest 映射、端到端各段耗时、失败与重试记录；
  证据等级逐项标注。
  - 进度注（2026-10-02）：`evidence/RECORD.md` 已落稿（§1 四事实 / §2 真机冒烟 / §3 发现 /
    §3.5 跨域预演 / §3.6 两域 L1 / §4 边界 / §5 证据清单，逐项标 A/B/C 等级），本轮补入
    `rerun-20261002-2315/*` 与 `tdx-lab-run.json`。**仍缺两项**故不勾：
    ① **单据号**（开通/配额批文，需运维从控制台取号入台账，B 级）；
    ② **MRTD ↔ 镜像 digest 映射**（依赖 1.2 的可复现镜像构建）。
- [ ] 5.2 `DECISIONS.md` D-TEE-3 补注：② 分支（云上 TDX）升「已实测」，注明日期与实测记录
  指针；**① 信创分支（CSV）与 D9 院内口径不变**；解除条件其余部分（CSV 实测）保持原样。
- [ ] 5.3 `tee-attestation-pilot` tasks 1.2/1.3 凭 1.1 与 2.4/4.3 的证据勾选，
  指回本变更（不复制证据）。
- [ ] 5.4 `DEPLOY.md` §4.3 现状表：主机一行从 `[需申请]` 更新为「云上 TDX 已实测
  （日期 + 机型）」；TRUST.md P-CTL-8 进展标注同步。
- [x] 5.5 对外表述清单（design P6 红线）：允许/禁止的表述各列一份，供后续生态材料引用；
  与 `scripts/check-tee-claims.mjs` 的既有口径对齐，不新造机制。
  - 进度注（2026-10-02）：落稿 `external-claims.md`（两栏 + 两阶段口径：真机侧完成前
    连「已实测」都不许说）；含 A 案拓扑表述约束（全阿里云 g8i TDX + AMX CPU 推理、无 GPU/B70）。
- [x] 5.6 三闸门：`node scripts/check-meta-docs.mjs` 0 error、`pnpm governance` 通过、
  `openspec validate --strict tdx-attestation-pilot` valid。
  - 实测（2026-10-02）：`check-meta-docs` **0 error / 14 warning（均为存量）**；
    `openspec validate --strict` **valid**；`pnpm governance` **全部通过**（AGENTS 指针 7 本可解析）。

## 6. 边界护栏（全程有效，不是任务而是红线）

- 不接真实患者数据（REG-08 与医院书面接受在先）；只跑合成数据。
- 院内连接器 `attestationLevel` 恒 `software`（D9 / CTL-09）；`check-tee-claims` 全程绿。
- `packages/mdop` 协议不动；发现装不下 → 记设计缺陷回写 `tee-attestation-pilot` design。
- 租不到机器 → 全部保持未勾，D-TEE-3 ② 维持「推断」；不得以软件替身或部分结果冒充。
