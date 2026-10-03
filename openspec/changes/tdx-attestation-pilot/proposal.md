# TDX 试点：云上真实 quote 打通（D-TEE-3 ② 分支的实测化）

## Why

`tee-attestation-pilot` 已把证明链选型登记为 **D-TEE-3（条件式默认）**，但两条分支至今都是
**公开资料推断、未实测**：试点期没拿到机器，`tasks.md` 的 1.2（可获得性核实）与
1.3（真实证明打通）两条至今未勾——它们的解锁条件全部是外部前置（机型、配额、审批）。

D-TEE-3 ② 分支写的是：**无信创硬要求 → 云上 Intel TDX 先打通端到端，CSV 作为生产目标并行申请**。
本变更就是把它做实的那次执行：

- 租一台云上 TDX 机密机型（阿里云 g8i 系 / Azure `DCesv5` 族，按 D-TEE-3 补注的机型清单）；
- 在 TDVM 内产出**一次真实 quote**，经 DCAP 校验链验到 **Intel 证明根**；
- 用既有的两处接缝（`tee-node/providers.ts` 的 `hardwareAttestation` 工厂、控制面
  `TEE_ATTESTATION_REGISTRY`）注入第一份**真实** TDX 证明代理与信任根；
- 在合成数据上重跑既有 C2 会话骨架，走通
  「证明 → KMS 释放 → 节点内执行 → 只出 C3 → 锚定」；
- 把 D-TEE-3 ② 分支从「推断」升「实测」，并解掉 `tee-attestation-pilot` 的 1.2/1.3。

这也是后续与硬件生态方（Intel：Liftoff / Partner Alliance / Market Ready Solutions）对话的
**技术底账**——「已在自己协议里验通真实 TDX quote」是任何生态谈话的门票；但本变更只产出
**实测记录**，不产出对外营销材料（表述红线见 design P6）。

## What Changes

- **第一份真实证明代理**：`TdxAttestationProvider`（落 `apps/connector` 侧，经
  `TeeNodeProviderRegistry.hardwareAttestation` 注入），产出符合 `VendorQuote` 契约的
  TDX 证明：`measurement`（MRTD 整机镜像度量）、`tcb`（点分数字）、`quote` 原文、
  `ephemeral_public_key` + `report_data`（按 2026-09-27 已定案的 REPORTDATA 装填约定：
  **前 32 字节 = SM3 摘要、其余置零**）、`node` URN、`collateral`（`crl` + `qvl`，
  取自 PCCS/Intel PCS）。
- **第一份真实信任根**：`kind: tdx` 的 `TrustedRootWithCollateral`（required ≥ `[crl, qvl]` +
  离线刷新窗口），校验路径自托管优先（DCAP QVL 本地缓存 collateral / Trustee AS），
  **不以引入 Intel Trust Authority 托管服务为前提**。
- **机型开通（运维前置，解锁三段式）**：申请云上 TDX 机型的开通与配额，拿到
  「机型 SKU / region / TDX module 版本 / TCB 版本」四个部署事实。
- **端到端演练（合成数据）**：把 `c2-session` 骨架的证明提供者与 KMS 校验器换成真实实现
  （调用点不动——这正是 pilot 已验证的「换硬件只换两个类」），走通全链并留耗时记录。
- **证据与决策回写**：新增实测记录文档（机型、quote 摘要、验签日志、耗时）；
  `DECISIONS.md` D-TEE-3 补注（② 分支升实测、① 信创分支与 D9 院内口径**不变**）；
  `DEPLOY.md` §4.3 现状表同步；`tee-attestation-pilot` tasks 1.2/1.3 凭证据勾选。

**本期不做**：
- 不接真实患者数据（REG 闸门 REG-08 与医院书面接受仍在先，合成数据演练不受限）；
- 不做 CSV / SEV-SNP 的实测（信创分支另行推进）；
- 不做生产 KMS 选型（云上试点沿用演练 KMS 形状 + 真实 TDX 根；生产 KMS 归 D-TEE-1）；
- 不产出对外营销材料，不改 `attestationLevel` 的既有口径（D9 / CTL-09）；
- 不做 Intel 商务合作本身（证据包是它的前置，不是它的内容）。

## Impact

- **代码**：`packages/mdop` 协议**预期不动**（若真实 TDX quote 有字段装不下统一契约 →
  按既有规则记设计缺陷回写 design，MUST NOT 就地扩展）；`apps/connector/src/tee-node/`
  注入真实 factory 与配置；`apps/api` 侧 `TEE_ATTESTATION_REGISTRY` 补 TDX 根的装配样例。
- **文档**：`DECISIONS.md`（D-TEE-3 补注）、`DEPLOY.md` §4.3（现状表：主机一行从
  `[需申请]` 改「已实测」）、`TRUST.md` P-CTL-8 进展标注、`tee-attestation-pilot`
  tasks 1.2/1.3 勾选与指回。
- **资源**：一台最小规格云上机密 VM × 试点周期 + 一次节点镜像构建与度量记录；
  运维/采购侧一次配额申请（批文入台账）。
- **如实边界**：「云上 TDX 实测通过」≠「C2 生产可用」≠「可对医院宣称硬件机密计算已上线」——
  对外表述只升到「已在云上 TDX 机型完成一次真实证明的端到端验证」。
