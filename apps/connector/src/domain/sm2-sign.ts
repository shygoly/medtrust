// 连接器侧的国密签名口径（D-MDOP-3 / 规格「SM2 签名口径」）。
//
// 与平台侧 GMCryptoService 共用同一份实现（`@medtrust/mdop`）：GM/T 0003.2 的 Z_A 预处理、
// 缺省用户 ID `1234567812345678`、GM/T 0009 的 DER 编码、`kid` 为公钥 SM3 全长。
//
// BREAKING：旧格式（不做 Z_A、原始 r‖s）只保留 `verifySm2Legacy`，供核验切换前
// 产生的历史对象（已上链的背书、旧的连接器证书）。线上链路一律走国标口径。
import {
  SM2_ALGORITHM,
  SM2_LEGACY_ALGORITHM,
  publicKeyFromPrivateKey,
  publicKeyKid,
  sm2Sign,
  sm2Verify,
  verifyLegacySm2,
} from '@medtrust/mdop';

export { SM2_ALGORITHM, SM2_LEGACY_ALGORITHM };

export interface Sm2SignatureCheck {
  valid: boolean;
  alg: typeof SM2_ALGORITHM | typeof SM2_LEGACY_ALGORITHM | null;
}

/** 国标口径签名。给了公钥就直接用（省一次点乘），不给则由私钥推出。 */
export function signSm2(message: string, privateKey: string, publicKey?: string): string {
  const pub = publicKey?.trim() || publicKeyFromPrivateKey(privateKey.trim());
  return sm2Sign(message, privateKey.trim(), { publicKey: pub });
}

/** 国标口径验签（线上链路唯一接受的格式）。 */
export function verifySm2(message: string, signature: string, publicKey: string): boolean {
  try {
    return sm2Verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

/** 旧格式验签：只给切换前的历史对象用。 */
export function verifySm2Legacy(
  message: string,
  signature: string,
  publicKey: string,
): boolean {
  try {
    return verifyLegacySm2(message, signature, publicKey);
  } catch {
    return false;
  }
}

/** 「先国标、后历史」：只读的历史核验面用，返回命中的格式以便审计。 */
export function verifySm2Historical(
  message: string,
  signature: string,
  publicKey: string,
): Sm2SignatureCheck {
  if (verifySm2(message, signature, publicKey)) return { valid: true, alg: SM2_ALGORITHM };
  if (verifySm2Legacy(message, signature, publicKey))
    return { valid: true, alg: SM2_LEGACY_ALGORITHM };
  return { valid: false, alg: null };
}

export function publicKeyFromPrivateKeyHex(privateKey: string): string {
  return publicKeyFromPrivateKey(privateKey.trim());
}

/** `kid` = 公钥 SM3 摘要的完整 64 位十六进制。 */
export function publicKeyKidHex(publicKey: string): string {
  return publicKeyKid(publicKey.trim());
}
