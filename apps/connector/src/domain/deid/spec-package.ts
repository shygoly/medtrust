// 脱敏规格包（SignedDeidSpec）的接收侧：解析 → 验签 → 版本单调 → 吊销 → 取用。
//
// 口径全部在 `@medtrust/mdop`（`parseDeidSpec` + `deidSpecSignaturePayload`），
// 与平台签发侧共用同一份实现 —— 两边各写一套就会漂移成"验不过自己发的规格"。
//
// fail-closed 的边界在这里划清：任何一项不通过都**抛错**，绝不返回"尽力而为"的规格；
// 更不允许在 agent 模式下退回内置弱脱敏（design §7）。
import {
  DEID_SPEC_VERSION,
  DeidSpecError,
  deidSpecSignaturePayload,
  parseDeidSpec,
  type DeidSpec,
} from '@medtrust/mdop';
import { platformPublicKey } from '../platform-keys';
import { publicKeyKidHex, verifySm2 } from '../sm2-sign';
import { sm3Hex } from '../sm3';
import { stableStringify } from '../canonical-json';

/** 平台随批次下发的规格包（与 apps/api `SignedDeidSpec` 同形）。 */
export interface SignedDeidSpec {
  specId: string;
  version: number;
  specJson: string;
  specSm3: string;
  signature: string;
  keyId: string;
  issuedAt: string;
  notAfter: string;
  signaturePayload?: string;
}

export interface DeidSpecRevocationEntry {
  specSm3: string;
  specId: string;
  version: number;
  reason: string;
  revokedAt: string;
  revokedBy: string;
}

export interface DeidSpecRevocationList {
  version: number;
  issuedAt: string;
  revoked: DeidSpecRevocationEntry[];
}

export type DeidSpecRejection =
  | 'SPEC_KEY_NOT_CONFIGURED'
  | 'SPEC_SHAPE_INVALID'
  | 'SPEC_SM3_MISMATCH'
  | 'SPEC_SIGNATURE_INVALID'
  | 'SPEC_KEY_ID_MISMATCH'
  | 'SPEC_SIGNATURE_PAYLOAD_MISMATCH'
  | 'SPEC_SCHEMA_INVALID'
  | 'SPEC_EXPIRED'
  | 'SPEC_VERSION_STALE'
  | 'SPEC_REVOKED'
  | 'SPEC_NOT_AVAILABLE'
  | 'SPEC_SCOPE_MISMATCH';

export class DeidSpecRejected extends Error {
  constructor(
    readonly code: DeidSpecRejection,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'DeidSpecRejected';
  }
}

/** 已验过签、可执行的规格（内存态，不落库；重启后由下一批下发重建）。 */
export interface StoredDeidSpec {
  specId: string;
  version: number;
  spec: DeidSpec;
  specSm3: string;
  keyId: string;
  issuedAt: string;
  notAfter: string;
}

export interface AppliedDeidSpec {
  specId: string;
  version: number;
  specSm3: string;
}

export interface RejectedDeidSpec {
  specId: string;
  version: number;
  code: DeidSpecRejection;
  detail: string;
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * 校验一个规格包：形状 → SM3 重算 → 用途公钥 → kid → 签名字段口径 → schema → 时效。
 * 全部通过才返回可执行规格；任何一项不过即抛 {@link DeidSpecRejected}。
 */
export function verifySignedDeidSpec(
  raw: unknown,
  now: Date = new Date(),
  publicKey: string = platformPublicKey('registry'),
): StoredDeidSpec {
  if (!publicKey)
    throw new DeidSpecRejected(
      'SPEC_KEY_NOT_CONFIGURED',
      '未配置 CONNECTOR_REGISTRY_PUBKEY，脱敏规格无法验签 —— 拒绝执行（fail-closed）',
    );

  const pkg = asPackage(raw);
  // 1) 摘要必须由 specJson **重算**得到，不采信下发方声称的 specSm3。
  const digest = sm3Hex(pkg.specJson);
  if (digest !== pkg.specSm3.toLowerCase())
    throw new DeidSpecRejected(
      'SPEC_SM3_MISMATCH',
      `规格摘要不符：重算 ${digest.slice(0, 16)}… ≠ 声称 ${pkg.specSm3.slice(0, 16)}…`,
    );

  // 2) kid 必须就是部署固定的那把注册中心公钥（换钥/串用途都在这里被挡下）。
  const expectedKid = publicKeyKidHex(publicKey);
  if (pkg.keyId.toLowerCase() !== expectedKid.toLowerCase())
    throw new DeidSpecRejected(
      'SPEC_KEY_ID_MISMATCH',
      `规格签名 kid 与部署固定的注册中心公钥不符（期望 ${expectedKid.slice(0, 16)}…）`,
    );

  // 3) 口径标识若随包给出，必须与本地口径一致（换前缀时立刻暴露）。
  if (pkg.signaturePayload !== undefined) {
    const expected = deidSpecSignaturePayload(digest);
    if (pkg.signaturePayload !== expected)
      throw new DeidSpecRejected(
        'SPEC_SIGNATURE_PAYLOAD_MISMATCH',
        '规格签名载荷口径与本地不一致（平台/连接器版本漂移）',
      );
  }

  // 4) 签名：只认注册中心用途公钥（用途分离在 `platformPublicKey('registry')` 这一处钉死，
  //    平台节点密钥/CA 根钥签出的规格在这里一律验不过）。
  if (
    !verifySm2(deidSpecSignaturePayload(digest), pkg.signature, publicKey)
  )
    throw new DeidSpecRejected(
      'SPEC_SIGNATURE_INVALID',
      '规格签名无法用部署固定的注册中心公钥验证（用错密钥签出的对象一律拒绝）',
    );

  // 5) 规格本体：封闭算子 + 参数上界 + 强制字段。
  let spec: DeidSpec;
  try {
    spec = parseDeidSpec(JSON.parse(pkg.specJson) as unknown);
  } catch (err) {
    const detail =
      err instanceof DeidSpecError ? `${err.code}: ${err.message}` : String(err);
    throw new DeidSpecRejected('SPEC_SCHEMA_INVALID', detail);
  }
  if (spec.id !== pkg.specId)
    throw new DeidSpecRejected(
      'SPEC_SHAPE_INVALID',
      `包内 specId=${pkg.specId} 与规格 id=${spec.id} 不一致`,
    );

  // 6) 时效：过期即拒用（不依赖平台在线）。
  if (Date.parse(pkg.notAfter) <= now.getTime())
    throw new DeidSpecRejected(
      'SPEC_EXPIRED',
      `${pkg.specId} v${pkg.version} 已于 ${pkg.notAfter} 过期`,
    );

  return {
    specId: pkg.specId,
    version: pkg.version,
    spec,
    specSm3: digest,
    keyId: pkg.keyId.toLowerCase(),
    issuedAt: pkg.issuedAt,
    notAfter: pkg.notAfter,
  };
}

function asPackage(raw: unknown): SignedDeidSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new DeidSpecRejected('SPEC_SHAPE_INVALID', '规格包必须是对象');
  const obj = raw as Record<string, unknown>;
  const specId = text(obj.specId, 'specId');
  const version = obj.version;
  if (!Number.isInteger(version) || (version as number) < 1)
    throw new DeidSpecRejected('SPEC_SHAPE_INVALID', 'version 必须是正整数');
  const specJson = text(obj.specJson, 'specJson');
  const specSm3 = text(obj.specSm3, 'specSm3');
  if (!HEX64.test(specSm3))
    throw new DeidSpecRejected('SPEC_SHAPE_INVALID', 'specSm3 必须是 64 hex');
  const signature = text(obj.signature, 'signature');
  const keyId = text(obj.keyId, 'keyId');
  const issuedAt = text(obj.issuedAt, 'issuedAt');
  const notAfter = text(obj.notAfter, 'notAfter');
  if (!Number.isFinite(Date.parse(issuedAt)) || !Number.isFinite(Date.parse(notAfter)))
    throw new DeidSpecRejected('SPEC_SHAPE_INVALID', 'issuedAt/notAfter 必须是 ISO 时间');
  const signaturePayload =
    obj.signaturePayload === undefined
      ? undefined
      : text(obj.signaturePayload, 'signaturePayload');
  return {
    specId,
    version: version as number,
    specJson,
    specSm3,
    signature,
    keyId,
    issuedAt,
    notAfter,
    ...(signaturePayload === undefined ? {} : { signaturePayload }),
  };
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new DeidSpecRejected('SPEC_SHAPE_INVALID', `${path} 必须是非空字符串`);
  return value.trim();
}

/**
 * 本院可执行规格的本地视图：版本单调 + 吊销 + 时效。
 *
 * - 只接受**更高版本**（同版本重复下发即忽略，低版本一律拒）——防回放旧口径；
 * - 吊销按 specSm3 命中即清缓存，之后 `requireActive` 直接拒；
 * - 吊销名单版本只增不减（回放旧名单无效）。
 */
export class DeidSpecStore {
  private readonly active = new Map<string, StoredDeidSpec>();
  private readonly revoked = new Map<string, DeidSpecRevocationEntry>();
  private revocationVersion = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** 当前持有的有效规格（按 specId）。 */
  list(): StoredDeidSpec[] {
    return [...this.active.values()].sort((a, b) => a.specId.localeCompare(b.specId));
  }

  isRevoked(specSm3: string): boolean {
    return this.revoked.has(specSm3.toLowerCase());
  }

  currentRevocationVersion(): number {
    return this.revocationVersion;
  }

  /**
   * 收下一批规格包：逐个验签，只有**全部通过**的才进缓存。
   * 返回逐包结论（审计用），绝不因单个包失败而丢弃整批 —— 也不能因整批里
   * 有一个坏包就把已有的好规格清掉。
   */
  applyPackages(
    packages: readonly unknown[],
    publicKey?: string,
  ): { applied: AppliedDeidSpec[]; rejected: RejectedDeidSpec[] } {
    const applied: AppliedDeidSpec[] = [];
    const rejected: RejectedDeidSpec[] = [];
    for (const raw of packages) {
      const specId = readId(raw);
      const version = readVersion(raw);
      try {
        const verified = verifySignedDeidSpec(raw, this.now(), publicKey);
        const existing = this.active.get(verified.specId);
        if (existing && verified.version < existing.version)
          throw new DeidSpecRejected(
            'SPEC_VERSION_STALE',
            `${verified.specId} v${verified.version} 低于本地 v${existing.version}`,
          );
        if (this.isRevoked(verified.specSm3))
          throw new DeidSpecRejected(
            'SPEC_REVOKED',
            `${verified.specId} v${verified.version} 已被吊销`,
          );
        if (existing && existing.version === verified.version && existing.specSm3 === verified.specSm3)
          continue; // 同版本同摘要：幂等重发，不产生新记录
        this.active.set(verified.specId, verified);
        applied.push({
          specId: verified.specId,
          version: verified.version,
          specSm3: verified.specSm3,
        });
      } catch (err) {
        rejected.push({
          specId,
          version,
          code: err instanceof DeidSpecRejected ? err.code : 'SPEC_SHAPE_INVALID',
          detail: (err as Error).message,
        });
      }
    }
    return { applied, rejected };
  }

  /**
   * 收下吊销名单。版本非递增即忽略（返回 false），命中即从缓存清掉。
   * 返回是否发生了变更。
   */
  applyRevocationList(list: unknown): boolean {
    if (!list || typeof list !== 'object')
      throw new DeidSpecRejected('SPEC_SHAPE_INVALID', '吊销名单必须是对象');
    const obj = list as Record<string, unknown>;
    const version = obj.version;
    if (!Number.isInteger(version) || (version as number) < 0)
      throw new DeidSpecRejected('SPEC_SHAPE_INVALID', '吊销名单 version 必须是非负整数');
    if (!Array.isArray(obj.revoked))
      throw new DeidSpecRejected('SPEC_SHAPE_INVALID', '吊销名单 revoked 必须是数组');
    if ((version as number) <= this.revocationVersion) return false;

    let changed = false;
    for (const raw of obj.revoked) {
      const entry = asRevocation(raw);
      if (this.revoked.has(entry.specSm3)) continue;
      this.revoked.set(entry.specSm3, entry);
      changed = true;
    }
    this.revocationVersion = version as number;
    for (const [specId, stored] of [...this.active.entries()]) {
      if (this.revoked.has(stored.specSm3)) this.active.delete(specId);
    }
    return changed;
  }

  /**
   * 取一个可执行的规格：本地没有 = `SPEC_NOT_AVAILABLE`（不猜、不兜底）。
   * 这种情况下 agent 模式必须失败，而不是退回内置脱敏。
   */
  requireActive(specId: string): StoredDeidSpec {
    const stored = this.active.get(specId);
    if (!stored)
      throw new DeidSpecRejected(
        'SPEC_NOT_AVAILABLE',
        `本地没有可用的脱敏规格 ${specId}（未下发 / 已吊销 / 已过期）`,
      );
    if (this.isRevoked(stored.specSm3))
      throw new DeidSpecRejected('SPEC_REVOKED', `${specId} 已被吊销`);
    if (Date.parse(stored.notAfter) <= this.now().getTime())
      throw new DeidSpecRejected('SPEC_EXPIRED', `${specId} 已于 ${stored.notAfter} 过期`);
    return stored;
  }

  /** 本进程支持的 schema 版本（诊断用）。 */
  get schemaVersion(): number {
    return DEID_SPEC_VERSION;
  }
}

function asRevocation(raw: unknown): DeidSpecRevocationEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new DeidSpecRejected('SPEC_SHAPE_INVALID', '吊销条目必须是对象');
  const obj = raw as Record<string, unknown>;
  const specSm3 = text(obj.specSm3, 'revoked[].specSm3').toLowerCase();
  if (!HEX64.test(specSm3))
    throw new DeidSpecRejected('SPEC_SHAPE_INVALID', 'revoked[].specSm3 必须是 64 hex');
  const version = obj.version;
  if (!Number.isInteger(version) || (version as number) < 1)
    throw new DeidSpecRejected('SPEC_SHAPE_INVALID', 'revoked[].version 必须是正整数');
  return {
    specSm3,
    specId: typeof obj.specId === 'string' ? obj.specId : '',
    version: version as number,
    reason: typeof obj.reason === 'string' ? obj.reason : '',
    revokedAt: typeof obj.revokedAt === 'string' ? obj.revokedAt : '',
    revokedBy: typeof obj.revokedBy === 'string' ? obj.revokedBy : '',
  };
}

function readId(raw: unknown): string {
  const value = (raw as Record<string, unknown> | null)?.specId;
  return typeof value === 'string' ? value : '';
}

function readVersion(raw: unknown): number {
  const value = (raw as Record<string, unknown> | null)?.version;
  return typeof value === 'number' ? value : 0;
}
