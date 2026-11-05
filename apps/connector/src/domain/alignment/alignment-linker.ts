// 跨院对齐键的连接器侧加载与派生（Phase 3 / D-CN-10）。
//
// 决策见 `openspec/changes/connector-agent-deidentification/phase3-alignment-pseudonym.md`：
// 共管 HMAC-SM3 密钥（用途分域 + kid 版本化），密钥只在本院，平台不持。
//
// 配置（两个变量，缺任一即"未启用对齐"——不是错误，只是这些产品出不了域）：
//
//   CONNECTOR_ALIGNMENT_KEY      当前用于新派生的密钥（≥32 字符；建议从医院 Vault 注入）
//   CONNECTOR_ALIGNMENT_PURPOSE  用途域，如 `dedup-incidence:ckd-2026`
//   CONNECTOR_ALIGNMENT_KEYRING  可选，退役密钥表 `{"<kid>":"<key>"}`（JSON），
//                                仅供复算历史对齐值；不配就复算不了（拒绝用现行密钥冒充）
//
// 三条纪律：
//   · 缺配置 → `linkKey` 不产生，跨院投影自动跳过该记录（`minimalPairingProjection` 已如此）；
//     **绝不回退用 `subjectKey`** —— 各院院内盐不同，那会让配对交集恒为空却看起来"跑过了"。
//   · 派生只发生在连接器：agent 的算子集是封闭的，对齐键不属于去标识算子。
//   · 审计只记计数、kid 与用途，**不记标识本身**。
import {
  ALIGNMENT_KEY_MIN_LENGTH,
  AlignmentDeriver,
  AlignmentError,
  alignmentKidOf,
} from '@medtrust/mdop';

export const ALIGNMENT_KEY_ENV = 'CONNECTOR_ALIGNMENT_KEY';
export const ALIGNMENT_PURPOSE_ENV = 'CONNECTOR_ALIGNMENT_PURPOSE';
export const ALIGNMENT_KEYRING_ENV = 'CONNECTOR_ALIGNMENT_KEYRING';

/**
 * 只挑本模块用到的三个键（字面量读法）：DEPLOY 校验器按**字面量**键名找读取点，
 * 用拼接键名会报「死条目」，所以这里逐项点明。
 */
function processEnvSlice(): NodeJS.ProcessEnv {
  return {
    CONNECTOR_ALIGNMENT_KEY: process.env.CONNECTOR_ALIGNMENT_KEY,
    CONNECTOR_ALIGNMENT_PURPOSE: process.env.CONNECTOR_ALIGNMENT_PURPOSE,
    CONNECTOR_ALIGNMENT_KEYRING: process.env.CONNECTOR_ALIGNMENT_KEYRING,
  } as NodeJS.ProcessEnv;
}

export interface AlignmentConfig {
  key: string;
  purpose: string;
  retired: Record<string, string>;
}

/** 读配置；未配置返回 null（对齐未启用，不是错误）。配置了但非法 → 抛错（fail-closed）。 */
export function resolveAlignmentConfig(
  env: NodeJS.ProcessEnv = processEnvSlice(),
): AlignmentConfig | null {
  const key = (env['CONNECTOR_ALIGNMENT_KEY'] ?? '').trim();
  const purpose = (env['CONNECTOR_ALIGNMENT_PURPOSE'] ?? '').trim();
  const rawKeyring = (env['CONNECTOR_ALIGNMENT_KEYRING'] ?? '').trim();

  if (!key && !purpose && !rawKeyring) return null;
  if (!key)
    throw new AlignmentError(
      'ALIGNMENT_KEY_MISSING',
      `已配置 ${ALIGNMENT_PURPOSE_ENV}/${ALIGNMENT_KEYRING_ENV} 但缺 ${ALIGNMENT_KEY_ENV}：拒绝半开状态`,
    );
  if (key.length < ALIGNMENT_KEY_MIN_LENGTH)
    throw new AlignmentError(
      'ALIGNMENT_KEY_TOO_SHORT',
      `${ALIGNMENT_KEY_ENV} 短于 ${ALIGNMENT_KEY_MIN_LENGTH} 字符：弱密钥下标识空间可被枚举`,
    );
  if (!purpose)
    throw new AlignmentError(
      'ALIGNMENT_PURPOSE_MISSING',
      `已配置 ${ALIGNMENT_KEY_ENV} 但缺 ${ALIGNMENT_PURPOSE_ENV}：不同项目必须不同用途域`,
    );

  let retired: Record<string, string> = {};
  if (rawKeyring) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawKeyring);
    } catch {
      throw new AlignmentError('ALIGNMENT_KEY_MISSING', `${ALIGNMENT_KEYRING_ENV} 不是合法 JSON`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new AlignmentError(
        'ALIGNMENT_KEY_MISSING',
        `${ALIGNMENT_KEYRING_ENV} 必须是 {"<kid>":"<key>"} 对象`,
      );
    for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^[0-9a-f]{16}$/.test(kid))
        throw new AlignmentError('ALIGNMENT_KEY_MISSING', `keyring 的 kid 形态非法：${kid}`);
      if (typeof value !== 'string' || value.trim().length < ALIGNMENT_KEY_MIN_LENGTH)
        throw new AlignmentError(
          'ALIGNMENT_KEY_TOO_SHORT',
          `keyring[${kid}] 的密钥短于 ${ALIGNMENT_KEY_MIN_LENGTH} 字符`,
        );
      retired[kid] = value.trim();
    }
  }
  return { key, purpose, retired };
}

/** 当前用途的 kid（审计/对账用；不含密钥材料）。 */
export function currentAlignmentKid(config: AlignmentConfig): string {
  return new AlignmentDeriver({ key: config.key, purpose: config.purpose }).kid();
}

/**
 * 连接器侧对齐派生器：`attach` 把 `linkKey` 补到记录上，**不改动其它字段**。
 *
 * 没有标识 / 配置缺失 / 标识非法 → 返回 undefined（该记录不参与跨院对齐），
 * 并让调用方按"跳过"处理；**不抛错**是刻意的：一家医院里总有几行缺主索引，
 * 那不是事故；把缺对齐的行带出去才是。
 */
export class AlignmentLinker {
  private readonly deriver: AlignmentDeriver | null;

  constructor(
    config: AlignmentConfig | null = resolveAlignmentConfig(),
    private readonly audit?: {
      record(entry: { action: string; actor: string; allowed: boolean; detail: string }): void;
    },
  ) {
    if (!config) {
      this.deriver = null;
      return;
    }
    const deriver = new AlignmentDeriver({ key: config.key, purpose: config.purpose });
    for (const [kid, key] of Object.entries(config.retired)) deriver.retire(kid, key);
    this.deriver = deriver;
  }

  get enabled(): boolean {
    return this.deriver !== null;
  }

  kid(): string | null {
    return this.deriver?.kid() ?? null;
  }

  /** 派生对齐键；失败返回 null（不抛错，由调用方决定是否记审计）。 */
  link(rawIdentifier: string | undefined | null): string | null {
    if (!this.deriver) return null;
    if (typeof rawIdentifier !== 'string' || !rawIdentifier.trim()) {
      this.audit?.record({
        action: 'alignment-derive',
        actor: 'connector',
        allowed: false,
        detail: `kid=${this.deriver.kid()} skip=missing-identifier`,
      });
      return null;
    }
    try {
      const value = this.deriver.current(rawIdentifier);
      this.audit?.record({
        action: 'alignment-derive',
        actor: 'connector',
        allowed: true,
        detail: `kid=${alignmentKidOf(value) ?? this.deriver.kid()} purpose-bound`,
      });
      return value;
    } catch (err) {
      this.audit?.record({
        action: 'alignment-derive',
        actor: 'connector',
        allowed: false,
        detail: `kid=${this.deriver.kid()} rejected=${(err as AlignmentError).code ?? 'unknown'}`,
      });
      return null;
    }
  }

  /**
   * 把 `linkKey` 补到一条已去标识记录上。**只在这一处写 `linkKey`** ——
   * 别处若出现"自己拼一个 linkKey"，跨院对齐就失去唯一口径。
   */
  attach<T extends object>(record: T, rawIdentifier: string | null): T & { linkKey?: string } {
    const linkKey = this.link(rawIdentifier);
    if (!linkKey) return record;
    return { ...record, linkKey };
  }
}
