import { MdopError, sm2Decrypt, sm2Encrypt, sm3Hex } from '@medtrust/mdop';

/**
 * 参与方公钥加密 / 本节点私钥解密。
 *
 * 与平台 `GMCryptoService.sm2Encrypt` / `sm2Decrypt` 同一口径：sm-crypto cipherMode=1（C1C3C2），
 * 实现落在 `@medtrust/mdop`，连接器不另引一套国密。
 */

export interface WeightUpdate {
  n: number;
  weights: number[];
}

export interface SealedShare {
  recipient: string;
  ciphertext: string;
}

export interface SealedContribution {
  shares: SealedShare[];
}

export function fedAvg(updates: readonly WeightUpdate[]): WeightUpdate {
  if (updates.length === 0) throw new MdopError('E_RUNTIME', {}, '没有可聚合的贡献');
  const total = updates.reduce((sum, update) => sum + update.n, 0);
  if (!(total > 0)) throw new MdopError('E_RUNTIME', {}, '样本量必须为正');
  const width = updates[0].weights.length;
  if (updates.some((update) => update.weights.length !== width || update.n <= 0))
    throw new MdopError('E_RUNTIME', {}, '贡献格式不一致');
  const weights = Array.from({ length: width }, (_, index) =>
    updates.reduce((sum, update) => sum + (update.n / total) * update.weights[index], 0),
  );
  return { n: total, weights };
}

/** 用每个参与方的公钥各封一份。返回平台存储用的 base64 密文 blob。 */
export function sealContribution(
  update: WeightUpdate,
  parties: readonly { id: string; publicKey: string }[],
): string {
  if (parties.length === 0) throw new MdopError('E_RUNTIME', {}, '没有参与方公钥');
  const plaintext = JSON.stringify(update);
  const sealed: SealedContribution = {
    shares: parties.map((party) => ({
      recipient: party.id,
      ciphertext: sm2Encrypt(plaintext, party.publicKey),
    })),
  };
  return Buffer.from(JSON.stringify(sealed), 'utf8').toString('base64');
}

export function contributionDigest(ciphertextBase64: string): string {
  return `sm3:${sm3Hex(Buffer.from(ciphertextBase64, 'base64'))}`;
}

/** 只解本节点那一份。解不开或格式不对即拒绝，不填默认值。 */
export function openOwnShare(
  ciphertextBase64: string,
  selfId: string,
  privateKey: string,
): WeightUpdate {
  let sealed: SealedContribution;
  try {
    sealed = JSON.parse(Buffer.from(ciphertextBase64, 'base64').toString('utf8')) as SealedContribution;
  } catch {
    throw new MdopError('E_RUNTIME', {}, '密文格式不符');
  }
  const share = sealed.shares?.find((item) => item.recipient === selfId);
  if (!share) throw new MdopError('E_RUNTIME', {}, '密文里没有本节点的份额');
  let plain: string;
  try {
    plain = Buffer.from(sm2Decrypt(share.ciphertext, privateKey)).toString('utf8');
  } catch {
    throw new MdopError('E_RUNTIME', {}, '解密失败');
  }
  let update: WeightUpdate;
  try {
    update = JSON.parse(plain) as WeightUpdate;
  } catch {
    // 错误私钥解出的是乱码，sm-crypto 不抛错，这里按解密失败拒绝。
    throw new MdopError('E_RUNTIME', {}, '解密失败');
  }
  if (typeof update.n !== 'number' || !Array.isArray(update.weights))
    throw new MdopError('E_RUNTIME', {}, '解密后的贡献格式不符');
  return update;
}
