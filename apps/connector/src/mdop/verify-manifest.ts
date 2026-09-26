import { verifyCanonicalObject } from '@medtrust/mdop';

/**
 * 用指定公钥（部署固定的注册中心公钥）验算子清单签名。
 *
 * 签名内容是**清单对象本身**（JCS + SM3，与信封/凭证/吊销名单同口径）；
 * `kid` 必须等于该公钥的 SM3 全长 —— 用错密钥的清单一律拒。
 */
export function verifyObjectWithKid(
  value: unknown,
  signature: unknown,
  publicKey: string,
): boolean {
  if (typeof signature !== 'object' || signature === null) return false;
  const sig = signature as { alg?: unknown; kid?: unknown; value?: unknown };
  if (typeof sig.value !== 'string' || typeof sig.kid !== 'string') return false;
  if (typeof sig.alg === 'string' && sig.alg !== 'SM2-SM3') return false;
  return verifyCanonicalObject(
    value,
    { alg: String(sig.alg ?? 'SM2-SM3'), kid: sig.kid, value: sig.value },
    publicKey,
  );
}
