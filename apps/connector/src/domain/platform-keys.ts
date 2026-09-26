// 部署配置里固定的三把平台公钥，**按用途验签**（D-MDOP-3 / 规格「平台密钥按用途分离」）。
//
//   certificate   CA 根钥        → 只验连接器证书（平台签发的证书链）
//   platform-node 平台节点密钥   → 验任务信封、执行凭证、吊销名单、合约副署
//   registry      注册中心密钥   → 验算子清单与算法模块签名（P-CTL-6 的「专用算法签名密钥」）
//
// 用错密钥签出的对象一律拒绝：这里是**用途互斥**的落点，不是「随便哪把都行」的兜底。
// 未配置对应公钥时一律 fail-closed（拒绝该用途下的全部对象），并给出可读原因。

import { verifySm2, verifySm2Historical, type Sm2SignatureCheck } from './sm2-sign';

export type PlatformKeyPurpose = 'certificate' | 'platform-node' | 'registry';

export const PLATFORM_KEY_ENV: Record<PlatformKeyPurpose, string> = {
  certificate: 'CONNECTOR_PLATFORM_CA_PUBKEY',
  'platform-node': 'CONNECTOR_PLATFORM_NODE_PUBKEY',
  registry: 'CONNECTOR_REGISTRY_PUBKEY',
};

/** 用途的中文名，用于错误信息（不泄露任何密钥材料）。 */
const PURPOSE_LABEL: Record<PlatformKeyPurpose, string> = {
  certificate: 'CA 根钥',
  'platform-node': '平台节点密钥',
  registry: '注册中心密钥',
};

export function platformPublicKey(purpose: PlatformKeyPurpose): string {
  return (process.env[PLATFORM_KEY_ENV[purpose]] ?? '').trim();
}

export interface PurposeVerifyFailure {
  ok: false;
  reason: 'key-not-configured' | 'signature-invalid';
  detail: string;
}

export interface PurposeVerifyOk {
  ok: true;
  alg: string;
}

/**
 * 按用途验签，**只认该用途的公钥**。
 * `acceptHistorical` 仅给「读历史对象」的场景开（如离线核验旧背书），线上消息不要开。
 */
export function verifyByPurpose(
  purpose: PlatformKeyPurpose,
  message: string,
  signature: string,
  options: { acceptHistorical?: boolean } = {},
): PurposeVerifyOk | PurposeVerifyFailure {
  const publicKey = platformPublicKey(purpose);
  if (!publicKey) {
    return {
      ok: false,
      reason: 'key-not-configured',
      detail:
        `未配置 ${PLATFORM_KEY_ENV[purpose]}（${PURPOSE_LABEL[purpose]}），` +
        `无法验证该用途的对象 —— 拒绝执行（fail-closed）`,
    };
  }
  const check: Sm2SignatureCheck = options.acceptHistorical
    ? verifySm2Historical(message, signature, publicKey)
    : { valid: verifySm2(message, signature, publicKey), alg: null };
  if (!check.valid) {
    return {
      ok: false,
      reason: 'signature-invalid',
      detail:
        `签名无法用部署固定的${PURPOSE_LABEL[purpose]}验证` +
        `（用错密钥签出的对象一律拒绝）`,
    };
  }
  return { ok: true, alg: check.alg ?? 'SM2-SM3' };
}
