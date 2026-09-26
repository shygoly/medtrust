// algorithm-sandbox — 执行隔离展示口径(如实标注,不夸大)。
//
// 与 attestationLevel(信任级别,当前恒 software)正交:
//   - wasm-sandbox = 算法模块在零能力 Wasm 沙箱内运行(代码能力受限);
//   - none         = 连接器内置实现(软件、同进程、无隔离)。
// 任何"沙箱 = TEE / 已具备硬件机密计算"的表述都是虚标(CTL-09)。

export type ExecutionIsolation = 'none' | 'wasm-sandbox';

export function isExecutionIsolation(value: unknown): value is ExecutionIsolation {
  return value === 'none' || value === 'wasm-sandbox';
}

/** 按医院显示的执行隔离文案。 */
export function executionIsolationLabel(
  isolation: string | undefined,
  moduleSm3?: string,
): string {
  if (isolation === 'wasm-sandbox') {
    const fingerprint = moduleSm3 ? `${moduleSm3.slice(0, 16)}…` : '未知';
    return `执行隔离:Wasm 沙箱 · 模块 ${fingerprint}`;
  }
  return '执行隔离:无隔离(软件、同进程)';
}

/** 信任级别恒为 software —— 沙箱落地不改变 attestationLevel。 */
export function trustLevelLabel(attestationLevel?: string): string {
  return attestationLevel === 'hardware'
    ? '信任级别:硬件远程证明'
    : '信任级别:software(无远程证明)';
}

// on-chain-provider-endorsement — 按院背书的展示口径(如实,不夸大)。
//
// 有背书 = 「该院连接器用院内证书私钥签了这份结果哈希,平台验过、并随存证上链」。
// 它让链上记录可**脱离平台独立归因**到这家医院;但链仍是平台单节点运营,
// 「平台不锚/漏锚某条记录」不在本机制射程内(design D4,归 P-CTL-4 的 L2)。

/** 按医院显示的连接器背书文案。 */
export function providerEndorsementLabel(endorsement?: {
  certFingerprint: string;
  verified: boolean;
}): string {
  if (!endorsement) {
    // 渐进期:未升级的连接器不带结果级签名 —— 如实说「缺」,不说「无需」。
    return '连接器背书:无(该院连接器未带结果级签名,存证不含其背书)';
  }
  const fp = endorsement.certFingerprint;
  const shown = fp.length > 20 ? `${fp.slice(0, 20)}…` : fp;
  return endorsement.verified
    ? `连接器背书:已验签 · 证书 ${shown}`
    : `连接器背书:验签未通过 · 证书 ${shown}`;
}

// third-party-module-admission —— 准入层级与平台审查背书的展示口径（task 7.1）。
//
// 层级说明的措辞是刻意的：Tier B 不是「平台背书它安全」，而是
// 「平台拿到源码、在锁定工具链里复现构建出了这个 SM3，并审查过」——
// 医院同意跑的就是这一份可复现的代码。源码可 NDA 保密，故背书里带保密标记。

export type AdmissionTier = 'A' | 'B';

export interface ModuleAdmissionView {
  tier: AdmissionTier;
  review?: {
    reviewer: string;
    reviewedAt: string;
    reproducibleBuildRef: string;
    confidential: boolean;
  };
}

/** 准入层级文案。 */
export function admissionTierLabel(tier?: AdmissionTier): string {
  if (tier === 'B') return '准入层级:B(第三方源码,平台复现构建 + 审查)';
  if (tier === 'A') return '准入层级:A(平台自研源码)';
  return '准入层级:未标注';
}

/** 平台审查背书文案（不含源码，只出审查者 + 复现构建凭据）。 */
export function reviewAttestationLabel(
  admission?: ModuleAdmissionView,
): string {
  const review = admission?.review;
  if (!review) {
    return admission?.tier === 'A'
      ? '平台审查背书:平台自研(走平台工具链构建 + 平台 CA 签名)'
      : '平台审查背书:无';
  }
  const scope = review.confidential ? '源码保密审查' : '源码公开审查';
  const ref = review.reproducibleBuildRef.slice(0, 28);
  return `平台审查背书:${review.reviewer} · ${review.reviewedAt.slice(0, 10)} · ${scope} · 复现构建 ${ref}…`;
}
