import { createDecipheriv } from 'crypto';
import { MdopError, canonicalize, sm3Hex } from '@medtrust/mdop';

/**
 * 节点内的**解封**（任务 3.4 的后半段、协议 §9.3）。
 *
 * 与持有方一侧的 `seal.ts` 严格对偶：同一份 AAD 口径（作业 / 凭证 / 合约）、同一套 AEAD
 * （本期 AES-256-GCM）。**换 SM4-GCM 只需同时替换两侧的这一个函数**——信封的绑定与策略字段都不动。
 *
 * 三条硬要求（任一不过即拒，且不返回半份明文）：
 *  ① 数据密钥必须来自 KMS 的释放凭据（调用方保证；本函数只收已解开的密钥）；
 *  ② 密文摘要必须与信封里登记的摘要一致——先做完整性对拍，再解密；
 *  ③ AAD 不符即**认证失败**（AEAD 的属性），换作业 / 换凭证 / 换合约都解不开。
 */

export interface SealedPayload {
  /** 密文（base64，与 `buildSealedEnvelope` 的 `ciphertext` 同口径）。 */
  ciphertext: string;
  /** 初始向量（hex）。 */
  iv: string;
  /** 认证标签（hex）。 */
  tag: string;
}

export function unsealPayload(
  sealed: SealedPayload,
  dek: Uint8Array,
  aad: { job_id: string; credential_id: string; contract_id: string },
  /** 信封里登记的密文摘要（`sm3:<64hex>`）；给了就做完整性对拍。 */
  expectedDigest?: string,
): unknown {
  if (expectedDigest !== undefined) {
    const actual = `sm3:${sm3Hex(Buffer.from(sealed.ciphertext, 'base64'))}`;
    if (actual !== expectedDigest)
      throw new MdopError(
        'E_ENVELOPE_POLICY',
        {},
        '密文与信封登记的摘要不符（密文被替换或截断）',
      );
  }

  const key = Buffer.from(dek);
  if (key.length !== 32)
    throw new MdopError('E_KEY_RELEASE_DENIED', {}, '解封密钥长度不是 256 位');

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'hex'));
    decipher.setAAD(Buffer.from(canonicalize(aad), 'utf8'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]);
  } catch {
    // 认证失败：AAD 不符 / 密文被改 / 密钥不对 —— 一律视为「解不开」，绝不降级
    throw new MdopError('E_ENVELOPE_POLICY', {}, '解封失败：AAD 绑定不符或密文被篡改');
  }
  return JSON.parse(plaintext.toString('utf8')) as unknown;
}
