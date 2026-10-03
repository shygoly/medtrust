## ADDED Requirements

### Requirement: TDX 证明代理（真实实现）

第一条真实硬件证明链 SHALL 经既有可插拔接缝（`TeeNodeProviderRegistry.hardwareAttestation` /
控制面 `TEE_ATTESTATION_REGISTRY`）注入，MUST NOT 改动协议契约与调用点（换链不改协议）。

- `TdxAttestationProvider` 产出的 `VendorQuote` MUST 满足：`vendor='tdx'`、
  `measurement` 为 quote 覆盖的 MRTD 整机镜像度量（`sm3:<64hex>`）、`tcb` 为
  真实 quote 给出的点分数字（MUST NOT 手填）、`quote` 为原文 base64、
  `ephemeral_public_key` 为会话级一次性 SM2 公钥、`report_data = reportDataBinding(ephemeral_public_key)`、
  `node` 为节点参与方 URN、`collateral` 至少含 `crl` 与 `qvl`（带 `fetched_at` / `next_update`）。
- 适配器装填硬件 64 字节 REPORTDATA MUST 按已定案约定：**前 32 字节 = `reportDataBinding`
  摘要中的 SM3、其余置零**；校验方 MUST 从**原始 quote** 取出 REPORTDATA 与协议字段
  `report_data` 比对（硬件覆盖核验由信任根实现承担，协议核不代替）。
- 证明产生失败时 MUST 抛 `E_ATTESTATION_FAILED`，MUST NOT 降级为软件报告、空字段报告或
  部分证明。
- 节点镜像 MUST 可复现构建（记录镜像 digest 与构建配方），MRTD 与镜像的映射 MUST 可追溯
  （`allowed_measurements` 的登记依据）。

#### Scenario: 真实 quote 映射进统一契约

- **WHEN** TDVM 内的 `TdxAttestationProvider` 完成一次 `prove()`
- **THEN** 产出 MUST 经 `mapVendorQuote` 无损落到统一 `AttestationReport`
  （度量 / TCB / 一次性公钥 / `report_data` / 身份绑定 / collateral 齐全），
  且 `level='hardware'`、`isolation='hardware-enclave'` 由映射得出而非声明

#### Scenario: REPORTDATA 未按约定装填

- **WHEN** 从原始 quote 取出的 REPORTDATA 与协议字段 `report_data`（公钥派生值）不一致
- **THEN** 信任根校验 MUST 失败（`E_ATTESTATION_FAILED`），KMS MUST NOT 释放密钥

#### Scenario: 证明产生失败被降级

- **WHEN** TDX 证明接口失败（取不到 quote / 工具链不可用）而实现试图返回软件级或空报告顶替
- **THEN** MUST 抛错拒绝（fail-closed），节点能力通告保持 `tee: null`

#### Scenario: 能力通告由真跑证明得出

- **WHEN** 真实代理注入并真跑一次证明成功后调用 `nodeCapabilityAdvertisement`
- **THEN** 通告 MUST 变为 `tee{kind:'tdx', min_tcb:<实测 TCB>}` 且取值来自该次证明报告
  ——配置写 `tdx` 而证明跑不通时通告仍为 `null`

### Requirement: TDX 信任根与 collateral 策略

TDX 的真实信任根 SHALL 为 `TrustedRootWithCollateral`（`kind='tdx'`），其 collateral 策略
MUST 声明 `required`（至少 `crl` 与 `qvl`）与 `max_staleness_minutes`（写明取值依据）。

- `verifyQuoteDigest` MUST 同时完成：验签链到 **Intel 证明根**（自托管校验路径：
  DCAP QVL 本地缓存 collateral / Trustee AS；引入 Intel Trust Authority 托管服务不是前提），
  以及上述 REPORTDATA 硬件覆盖核验。
- 校验器 MUST 经 `createHardwareAttestationVerifier` 装配；「只验 quote、不判材料时效」的
  校验器 MUST NOT 接真实 TDX 链。
- collateral 缺料、已过 `next_update`、超出刷新窗口、时间倒挂 → 一律拒
  （`E_ATTESTATION_FAILED`），KMS 不释放（fail-closed，不回退）。

#### Scenario: 验签链不到 Intel 根

- **WHEN** TDX quote 的证书链验不到已配置的 Intel 证明根（根缺失、链断、根被换）
- **THEN** 校验 MUST 失败，KMS MUST NOT 释放密钥；错误信息 MUST 指明链型与失败环节

#### Scenario: collateral 过期仍被放行

- **WHEN** 随证明提供的 `crl`/`qvl` 已过自身 `next_update` 或超出刷新窗口
- **THEN** 校验 MUST 失败——云上在线可取不是放宽材料时效判定的理由

### Requirement: 实测证据与如实表述

D-TEE-3 ② 分支（云上 TDX）升「已实测」SHALL 以本变更产出的实测记录为唯一依据。

- 实测记录 MUST 含：机型 SKU / region / 开通单据号、TDX module 版本、TCB 版本（来自真实
  quote）、quote 摘要与验签日志、MRTD ↔ 镜像 digest 映射、端到端
  「证明 → KMS 释放 → 节点内执行 → 只出 C3 → 锚定」各段耗时、失败与重试记录；
  证据等级逐项标注。
- 对外（含生态合作材料）表述上限 MUST 为「已在云上 TDX 机型完成一次真实证明的端到端验证
  （合成数据）」；MUST NOT 表述为「已具备硬件机密计算能力」「C2 生产可用」「数据绝对安全」。
- 院内连接器的 `attestationLevel` 口径 MUST 保持恒 `software`（D9 / CTL-09），
  `scripts/check-tee-claims.mjs` MUST 全程通过。

#### Scenario: 用推断或替身结果勾选实测

- **WHEN** 机型未开通或真实 quote 未产出，而任何材料声称「云上 TDX 已实测」
- **THEN** 该声称违反本要求；对应任务保持未勾，D-TEE-3 ② 维持「推断」

#### Scenario: 实测后越级表述

- **WHEN** 实测完成后，对外材料把「一次端到端验证（合成数据）」写成「C2 生产可用」
  或「已具备硬件机密计算能力」
- **THEN** 该表述超出证据等级上限，MUST 按如实边界改正（与 `check-tee-claims` 同一口径）
