## Context

D-TEE-3 的两条分支（信创 → CSV 优先 / 无信创 → 云上 TDX 先打通）都是**公开资料推断**；
唯一「本仓已验证」的是换链成本（`mapVendorQuote` 三链同契约）。本变更执行 ② 分支的实测化：
租云上 TDX 机型、出真实 quote、验到 Intel 根、走通全链。

仓库现状（本变更必须与之一致，不得另起一套）：

- **两处可插拔接缝已就位**：`apps/connector/src/tee-node/providers.ts` 的
  `TeeNodeProviderRegistry.hardwareAttestation`（未注入即抛错，D-TEE-3）与
  `apps/api/src/privacy/tee/adapters/attestation-registry.ts` 的 `TEE_ATTESTATION_REGISTRY`
  （未注入信任根即 `E_ATTESTATION_FAILED`，fail-closed）。
- **统一证明契约已定型**（`packages/mdop/src/attestation/provider.ts`）：`VendorQuote`
  → `mapVendorQuote` → `AttestationReport`；一次性公钥必须经 `report_data` 绑定
  （`reportDataBinding` = `sm3:` + 归一化未压缩点的 SM3）；硬件校验必须带
  collateral 新鲜度（`TrustedRootWithCollateral` + `createHardwareAttestationVerifier`：
  缺料 / 过期 / 超窗 / 时间倒挂一律拒）。
- **REPORTDATA 装填约定已定案**（tee-attestation-pilot design §P3 发现 8，2026-09-27）：
  协议层只存 `sm3:<64hex>` 摘要；适配器装填硬件 64 字节 REPORTDATA 的约定 =
  **前 32 字节放该 SM3 摘要、其余置零**；校验方必须从**原始 quote** 取出 REPORTDATA
  与协议字段比对，「硬件覆盖」核验由 `TrustedRoot.verifyQuoteDigest` 的实现承担。
- **换链等价性已钉死**：`c2-session.spec.ts` 已证明换提供者 + 换 KMS 客户端不动调用点；
  `nodeCapabilityAdvertisement` 的 `tee{kind}` 只从**真跑一次证明**得出，配置写 `tdx`
  骗不过编译器——真实代理注入后能力通告自动变真，无需另开通路。
- **云上默认形态** collateral 可在线取（TDX 走 PCCS/Intel PCS，DEPLOY §4.3）；
  离线刷新窗口只在院内部署时才是硬前置（D-TEE-3 条件化前置）。

## Goals / Non-Goals

**Goals**

- 在云上 TDX 机型产出**一次真实 quote**，经 DCAP 体系验到 Intel 证明根，端到端走通
  「证明 → KMS 释放 → 节点内执行 → 只出 C3 → 锚定」（D-TEE-3 ② 的解除条件）。
- 落地第一份真实 `TdxAttestationProvider` 与 `TrustedRootWithCollateral(kind: tdx)`，
  经既有接缝注入，调用点零改动。
- 产出**实测记录**（机型 / region / TDX module / TCB / quote 摘要 / 验签日志 / 耗时），
  证据等级逐项标注，可作 D-TEE-3 补注与外部生态对话的底账。

**Non-Goals**

- 不接真实患者数据；不做 CSV/SEV-SNP 实测；不做生产 KMS 选型（D-TEE-1 另行）。
- 不改 `packages/mdop` 协议（发现装不下 → 记设计缺陷回写，不就地扩展）。
- 不产出对外营销材料；不改 D9 / CTL-09 的 `attestationLevel` 口径。

## Decisions

### P1 目标链型与机型事实

云上 Intel TDX（D-TEE-3 ② 分支）。候选机型按 D-TEE-3 补注的公开清单：
阿里云第八代企业级 ECS g8i/c8i/r8i 族（另有第九代 c9i/g9i/r9i 部分地域）、
Azure `DCesv5/DCedsv5/ECesv5/ECedsv5`（及 `DCesv6/ECesv6`）。**验收不看选了哪家，
只看四个部署事实是否入账**：机型 SKU、region、TDX module 版本、TCB 版本
（`tcb` 的点分数字必须来自真实 quote，不得手填）。

### P2 证明代理的边界（跑在 TDVM 内的那一半）

`TdxAttestationProvider` 部署于 TDVM 内，职责五件事，多一件不做：

1. 生成一次性 SM2 密钥对（会话级，实例退出即失效——D-TEE-1 的「密钥只在该实例内存」）；
2. 按**已定案装填约定**把 `reportDataBinding(pub)` 的 SM3 摘要写进 TDX REPORTDATA
   （64 字节：前 32 字节摘要、其余置零）；
3. 调 TDX 证明接口取 quote（tdx 工具链 / 云厂商 SDK / sidecar，以实际机型文档为准）；
4. 产出 `VendorQuote`：`vendor:'tdx'`、`measurement`（MRTD 整机镜像度量，`sm3:<64hex>`）、
   `tcb`（点分数字）、`quote` 原文 base64、`ephemeral_public_key`、
   `report_data = reportDataBinding(...)`、`node`（节点 URN）、
   `collateral`（PCCS/Intel PCS 取的 `crl` + `qvl`，带 `fetched_at`/`next_update`）；
5. 失败即抛 `E_ATTESTATION_FAILED`，**MUST NOT** 降级成软件报告或空字段报告。

**镜像可复现**：`measurement` 是整机镜像度量，节点镜像必须可复现构建（记录镜像 digest 与
构建配方），否则 `allowed_measurements` 白名单无从登记——试点即把「镜像 → MRTD」的映射
记进实测记录。

### P3 信任根与校验路径（自托管优先）

`TrustedRootWithCollateral{ kind:'tdx', collateral:{ required:['crl','qvl'], max_staleness_minutes:<部署策略> } }`。
校验路径按自托管优先排序：① DCAP QVL 本地校验（collateral 自 PCCS 或 Intel PCS 取回后本地缓存）；
② 自托管 Trustee AS；③ Intel Trust Authority 托管服务仅作对照，**不作为本变更的前置依赖**
（避免新增外部信任方——校验链到 Intel 证明根即可，不必到 Intel 的在线服务）。
`verifyQuoteDigest` 必须完成两件事：验签链到 Intel 根 + 从**原始 quote** 取出 REPORTDATA
与协议字段 `report_data` 比对（发现 8 的责任边界：协议核不代替硬件覆盖核验）。

### P4 KMS 释放路径（试点形态）

复用协议核 `evaluateKeyRelease` + `createHardwareAttestationVerifier`（真实 TDX 根）。
云上试点沿用演练 KMS 的形状（`LocalDevKms` / `SelfHostedKmsDouble` 模式）装载真实根——
**换的只是校验器，不是判据**。生产 KMS（持有方自建/共管）归 D-TEE-1，不在本期。

### P5 端到端演练与能力通告

合成数据上重跑 `c2-session` 骨架：两院封存 → 真实 TDX 证明 → KMS 释放（真实根校验）→
解封执行 → 发布审查 → 只出 C3 → 回执链 → 锚定。`nodeCapabilityAdvertisement` 应**自动**
从 `tee:null` 变为 `tee{kind:'tdx', min_tcb:<实测 TCB>}`——不需要也不允许手开通道。
同时跑通 DEPLOY §4.3 上线步骤 6 的证明登记链（attestation-probe → 校验方背书 →
`POST /api/v1/mdop/attestations` → `chain_tx`），探针节拍 < 背书有效期。

### P6 证据、如实边界与对外表述

实测记录落 `docs/`（或 openspec 附件），必含：机型 SKU/region/开通单据号、TDX module 与
TCB 版本、quote 摘要（`sm3:<64hex>`）与验签日志、MRTD 与镜像 digest 的映射、端到端各段耗时、
失败与重试记录。**表述红线**（延伸 D9 / CTL-09 / check-tee-claims 的口径到对外材料）：

- 对外最高只能说到「已在云上 TDX 机型完成一次真实证明的端到端验证（合成数据）」；
- 不得说「已具备硬件机密计算能力 / C2 已生产可用 / 数据绝对安全」；
- 院内连接器 `attestationLevel` 仍恒 `software`（D9 口径不因本变更改变）；
- 该实测记录同时是与 Intel 生态对话的技术底账——**证据先行，叙事后行**。

### P7 失败路径与预算

租不到机器 / 配额审批不过 / 云厂商 TDX 工具链不可用 → 本变更保持 open、任务不勾、
D-TEE-3 ② 维持「推断」，**不得用软件替身或部分结果冒充**（与 tee-attestation-pilot 1.2/1.3
同一口径）。预算上限：一台最小规格机密 VM × 试点周期（按月计）+ 一次镜像构建；
超支即停并记录。

## Risks / Trade-offs

- **云厂商工具链差异**（quote 版本 v2/v3、TDX 1.0/1.5、REPORTDATA 是否透出）：
  P1 的「四事实入账」就是为它设计的；装不进 `VendorQuote` → 记设计缺陷回写
  `tee-attestation-pilot` design，**不就地扩展协议**。
- **Node.js 无原生 tdx 工具链**：预期走 sidecar / 云 SDK 子进程，边界收在 Provider 内
  （接缝外不感知）；sidecar 的度量计入镜像可复现范围。
- **collateral 时效误配**：云上在线可取但 `max_staleness_minutes` 给得太紧 → 探针空转；
  给得太松 → 违背新鲜度初衷。试点先按 PCCS 默认刷新节奏取值并记录依据。
- **把试点当生产**：最大风险不是技术，是表述越级——P6 的红线 + 既有
  `check-tee-claims` 机检共同兜底。

## Open Questions

1. 机型落谁家（阿里云 vs Azure）：取决于配额审批先到谁——不影响验收口径（P1 四事实）。
2. `tcb` 点分数字与合约 `min_tcb` 的首次实测取值：以实测 quote 为准回填演示合约，
   不预先手填。
3. TDX quote 的 MRTD 粒度是否覆盖节点镜像的 sidecar 部分：实测后若发现度量口径
   与「算子模块经注册中心签发」的双层模型有缝隙，按设计缺陷回写（不就地改协议）。
