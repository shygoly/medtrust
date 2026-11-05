// 脱敏词表清单的接收侧：解析 → 验签 → 版本单调 → 吊销 → 取用（Phase 2）。
//
// 词表**内容不在平台**：平台签的是摘要（`medtrust.deid-dictionary.v1:<sm3>`），
// 医院本地那份文件由 agent 按 `dictionaryRef` 读并核对摘要。
// 连接器的职责是确认"这个摘要确实是平台审查过的第 N 版"，然后把 ref + 摘要交给 agent。
//
// fail-closed：引用词表的规格如果拿不到对应清单，就**不执行**（不是"跳过姓名替换"）。
import {
  DEID_DICTIONARY_SIGNATURE_PAYLOAD_PREFIX,
  DeidSpecError,
  deidDictionarySignaturePayload,
  dictionaryManifestRef,
  parseDeidDictionaryManifest,
  parseDeidDictionaryRef,
  type DeidDictionaryManifest,
} from '@medtrust/mdop';
import { platformPublicKey } from '../platform-keys';
import { publicKeyKidHex, verifySm2 } from '../sm2-sign';

export interface DeidDictionaryRevocationList {
  version: number;
  issuedAt: string;
  revoked: Array<{
    dictionaryId: string;
    version: number;
    sm3: string;
    reason: string;
    revokedAt: string;
    revokedBy: string;
  }>;
}

export interface StoredDeidDictionary {
  ref: string;
  dictionaryId: string;
  version: number;
  sm3: string;
  byteSize: number;
  notAfter: string;
}

export type DeidDictionaryRejection =
  | 'DICTIONARY_KEY_NOT_CONFIGURED'
  | 'DICTIONARY_SHAPE_INVALID'
  | 'DICTIONARY_SIGNATURE_INVALID'
  | 'DICTIONARY_KEY_ID_MISMATCH'
  | 'DICTIONARY_SIGNATURE_PAYLOAD_MISMATCH'
  | 'DICTIONARY_EXPIRED'
  | 'DICTIONARY_VERSION_STALE'
  | 'DICTIONARY_REVOKED'
  | 'DICTIONARY_NOT_AVAILABLE';

export class DeidDictionaryRejected extends Error {
  constructor(
    readonly code: DeidDictionaryRejection,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'DeidDictionaryRejected';
  }
}

/** 校验一份词表清单：形状 → kid → 载荷口径 → 签名 → 时效。 */
export function verifyDeidDictionaryManifest(
  raw: unknown,
  now: Date = new Date(),
  publicKey: string = platformPublicKey('registry'),
): StoredDeidDictionary {
  if (!publicKey)
    throw new DeidDictionaryRejected(
      'DICTIONARY_KEY_NOT_CONFIGURED',
      '未配置 CONNECTOR_REGISTRY_PUBKEY，脱敏词表清单无法验签 —— 拒收（fail-closed）',
    );

  let manifest: DeidDictionaryManifest;
  try {
    manifest = parseDeidDictionaryManifest(raw);
  } catch (err) {
    const detail =
      err instanceof DeidSpecError ? err.message : String((err as Error)?.message ?? err);
    throw new DeidDictionaryRejected('DICTIONARY_SHAPE_INVALID', detail);
  }

  const expectedKid = publicKeyKidHex(publicKey);
  if (manifest.keyId.toLowerCase() !== expectedKid.toLowerCase())
    throw new DeidDictionaryRejected(
      'DICTIONARY_KEY_ID_MISMATCH',
      `词表清单 kid 与部署固定的注册中心公钥不符（期望 ${expectedKid.slice(0, 16)}…）`,
    );

  const expectedPayload = deidDictionarySignaturePayload(manifest.sm3);
  if (manifest.signaturePayload !== expectedPayload)
    throw new DeidDictionaryRejected(
      'DICTIONARY_SIGNATURE_PAYLOAD_MISMATCH',
      `词表清单签名载荷口径不一致（应以前缀 ${DEID_DICTIONARY_SIGNATURE_PAYLOAD_PREFIX} 开头）`,
    );

  if (!verifySm2(expectedPayload, manifest.signature, publicKey))
    throw new DeidDictionaryRejected(
      'DICTIONARY_SIGNATURE_INVALID',
      '词表清单签名无法用部署固定的注册中心公钥验证（用错密钥签出的一律拒绝）',
    );

  if (Date.parse(manifest.notAfter) <= now.getTime())
    throw new DeidDictionaryRejected(
      'DICTIONARY_EXPIRED',
      `${dictionaryManifestRef(manifest)} 已于 ${manifest.notAfter} 过期`,
    );

  return {
    ref: dictionaryManifestRef(manifest),
    dictionaryId: manifest.dictionaryId,
    version: manifest.version,
    sm3: manifest.sm3,
    byteSize: manifest.byteSize,
    notAfter: manifest.notAfter,
  };
}

/**
 * 本院可用的词表清单视图：每个 id 取最高版本，版本单调、吊销即清。
 * 与 `DeidSpecStore` 同构 —— 同一套"旧名单不能回滚"的纪律。
 */
export class DeidDictionaryStore {
  private readonly manifests = new Map<string, StoredDeidDictionary>();
  private readonly revoked = new Set<string>();
  private revocationVersion = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  list(): StoredDeidDictionary[] {
    return [...this.manifests.values()].sort((a, b) => a.ref.localeCompare(b.ref));
  }

  currentRevocationVersion(): number {
    return this.revocationVersion;
  }

  applyManifests(
    manifests: readonly unknown[],
    publicKey?: string,
  ): { applied: string[]; rejected: Array<{ ref: string; code: DeidDictionaryRejection; detail: string }> } {
    const applied: string[] = [];
    const rejected: Array<{ ref: string; code: DeidDictionaryRejection; detail: string }> = [];
    for (const raw of manifests) {
      const ref = readRef(raw);
      try {
        const verified = verifyDeidDictionaryManifest(raw, this.now(), publicKey);
        const existing = this.manifests.get(verified.dictionaryId);
        if (existing && verified.version < existing.version)
          throw new DeidDictionaryRejected(
            'DICTIONARY_VERSION_STALE',
            `${verified.ref} 低于本地 ${existing.ref}`,
          );
        if (this.revoked.has(verified.sm3))
          throw new DeidDictionaryRejected(
            'DICTIONARY_REVOKED',
            `${verified.ref} 已被吊销`,
          );
        if (existing && existing.ref === verified.ref) continue; // 幂等重发
        this.manifests.set(verified.dictionaryId, verified);
        applied.push(verified.ref);
      } catch (err) {
        rejected.push({
          ref,
          code: err instanceof DeidDictionaryRejected ? err.code : 'DICTIONARY_SHAPE_INVALID',
          detail: (err as Error).message,
        });
      }
    }
    return { applied, rejected };
  }

  /** 吊销名单：版本非递增即忽略；命中即从缓存清掉。 */
  applyRevocationList(list: unknown): boolean {
    if (!list || typeof list !== 'object')
      throw new DeidDictionaryRejected('DICTIONARY_SHAPE_INVALID', '词表吊销名单必须是对象');
    const obj = list as Record<string, unknown>;
    const version = obj.version;
    if (!Number.isInteger(version) || (version as number) < 0)
      throw new DeidDictionaryRejected(
        'DICTIONARY_SHAPE_INVALID',
        '词表吊销名单 version 必须是非负整数',
      );
    if (!Array.isArray(obj.revoked))
      throw new DeidDictionaryRejected('DICTIONARY_SHAPE_INVALID', '词表吊销名单 revoked 必须是数组');
    if ((version as number) <= this.revocationVersion) return false;

    for (const raw of obj.revoked) {
      const entry = raw as Record<string, unknown>;
      const sm3 = typeof entry.sm3 === 'string' ? entry.sm3.toLowerCase() : '';
      const dictionaryId = typeof entry.dictionaryId === 'string' ? entry.dictionaryId : '';
      if (sm3) this.revoked.add(sm3);
      if (dictionaryId) {
        const stored = this.manifests.get(dictionaryId);
        if (stored && stored.sm3 === sm3) this.manifests.delete(dictionaryId);
      }
    }
    this.revocationVersion = version as number;
    for (const [id, stored] of [...this.manifests.entries()]) {
      if (this.revoked.has(stored.sm3)) this.manifests.delete(id);
    }
    return true;
  }

  /**
   * 解析规格里的 `dictionaryRef` 并取回摘要。
   * 拿不到 → `DICTIONARY_NOT_AVAILABLE`（调 agent 之前就失败，不做事后补救）。
   */
  require(ref: string): StoredDeidDictionary {
    let parsed;
    try {
      parsed = parseDeidDictionaryRef(ref);
    } catch (err) {
      throw new DeidDictionaryRejected(
        'DICTIONARY_SHAPE_INVALID',
        (err as Error).message,
      );
    }
    const stored = this.manifests.get(parsed.dictionaryId);
    if (!stored)
      throw new DeidDictionaryRejected(
        'DICTIONARY_NOT_AVAILABLE',
        `本地没有词表清单 ${parsed.dictionaryId}（未下发 / 已吊销 / 已过期）`,
      );
    if (stored.version < parsed.version)
      throw new DeidDictionaryRejected(
        'DICTIONARY_NOT_AVAILABLE',
        `规格要求 ${ref}，本地只有 ${stored.ref}（旧清单不能顶替新版本）`,
      );
    if (this.revoked.has(stored.sm3))
      throw new DeidDictionaryRejected('DICTIONARY_REVOKED', `${stored.ref} 已被吊销`);
    if (Date.parse(stored.notAfter) <= this.now().getTime())
      throw new DeidDictionaryRejected(
        'DICTIONARY_EXPIRED',
        `${stored.ref} 已于 ${stored.notAfter} 过期`,
      );
    return stored;
  }
}

function readRef(raw: unknown): string {
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj.dictionaryId !== 'string') return '';
  const version = typeof obj.version === 'number' ? obj.version : 0;
  return `${obj.dictionaryId}:v${version}`;
}
