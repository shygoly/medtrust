/**
 * 跨院可对齐假名（alignment pseudonym）—— 同一主体在不同机构算出同一个值。
 *
 * 决策：`openspec/changes/connector-agent-deidentification/phase3-alignment-pseudonym.md`
 * （方案 B：医院共管 HMAC 密钥 + 用途分域 + kid 版本化；OPRF 见该文 §5 的切换判据）。
 *
 * 三条硬约束（都由本模块强制，不靠调用方自觉）：
 *
 * 1. **密钥不出院**：本模块只接受密钥字符串，不读环境、不读文件、不落日志；
 *    加载与托管在连接器（医院 Vault/KMS），平台不持钥（D-CN-9 同向）。
 * 2. **用途必须分域**：`purpose` 进派生式也进 kid —— 不同研究项目之间即使共用一把钥
 *    也**算不出同一个值**，跨项目链接性被结构性切断。
 * 3. **规范化先于派生**：同一人在两家医院常写成 `31010119900101123x` / `31010119900101123X`
 *    / 带空格与连字符的形态；不先归一，跨院对齐会静默失败（看起来"没配上"，而不是报错）。
 *
 * 值形态：`lk_<kid>_<32 hex>`。kid 自描述，轮换后新旧值一眼可分（**不假装同名**）。
 */
import { sm3Hex } from "../crypto/sm3";

/** HMAC-SM3 的分组长度（字节），与 `apps/connector/src/domain/sm3.ts` 同口径。 */
const SM3_BLOCK_BYTES = 64;

/** 派生式与 kid 的域分隔前缀：改动即改动所有已派生的值，只能在这里改。 */
export const ALIGNMENT_DERIVE_PREFIX = "medtrust.alignment.v1";
export const ALIGNMENT_KID_PREFIX = "medtrust.alignment.kid.v1";

/** 密钥最小长度（字符）。短于此一律拒绝 —— 弱密钥下枚举成本过低。 */
export const ALIGNMENT_KEY_MIN_LENGTH = 32;

/** 对齐假名的前缀（与院内假名 `sk_`、电力假名 `ps_` 区分，一眼看出作用域）。 */
export const ALIGNMENT_PSEUDONYM_PREFIX = "lk_";
const ALIGNMENT_KID_LENGTH = 16;
const ALIGNMENT_VALUE_LENGTH = 32;

export class AlignmentError extends Error {
  constructor(
    readonly code:
      | "ALIGNMENT_KEY_MISSING"
      | "ALIGNMENT_KEY_TOO_SHORT"
      | "ALIGNMENT_PURPOSE_MISSING"
      | "ALIGNMENT_IDENTIFIER_MISSING"
      | "ALIGNMENT_IDENTIFIER_INVALID",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "AlignmentError";
  }
}

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function hmacSm3Hex(key: string, message: string): string {
  let k = [...Buffer.from(key, "utf-8")];
  if (k.length > SM3_BLOCK_BYTES) k = hexToBytes(sm3Hex(new Uint8Array(k)));
  while (k.length < SM3_BLOCK_BYTES) k.push(0);
  const ipad = k.map((b) => b ^ 0x36);
  const opad = k.map((b) => b ^ 0x5c);
  const inner = sm3Hex(new Uint8Array([...ipad, ...Buffer.from(message, "utf-8")]));
  return sm3Hex(new Uint8Array([...opad, ...hexToBytes(inner)]));
}

/**
 * 标识规范化：只做**无损**归一（不改语义），任何"猜"的清洗都不做。
 *
 * - 去首尾空白、去中间空格与连字符（身份证/病案号常见的抄写形态）；
 * - 16 位身份证尾 `x` → `X`；
 * - 其余一律原样保留（小写/大小写混排的其它标识不做大小写折叠——不同系统的编号可能大小写敏感）。
 */
export function normalizeAlignmentIdentifier(raw: string): string {
  if (typeof raw !== "string")
    throw new AlignmentError("ALIGNMENT_IDENTIFIER_INVALID", "标识必须是字符串");
  const compact = raw.replace(/[\s\-‐-―]/g, "").trim();
  if (!compact)
    throw new AlignmentError("ALIGNMENT_IDENTIFIER_MISSING", "标识为空");
  // 18 位身份证：末位校验位小写 x 与 X 是同一个值（大写化），其余位一律不动。
  if (/^\d{17}[0-9xX]$/.test(compact)) return compact.slice(0, 17) + compact.slice(17).toUpperCase();
  return compact;
}

export interface AlignmentKeySource {
  /** 当前用于**新**派生的密钥（≥32 字符）。 */
  key: string;
  /** 用途域（研究/场景），例如 `dedup-incidence:ckd-2026`。 */
  purpose: string;
}

function assertKey(key: string): string {
  const value = (key ?? "").trim();
  if (!value) throw new AlignmentError("ALIGNMENT_KEY_MISSING", "未提供对齐密钥（拒绝派生）");
  if (value.length < ALIGNMENT_KEY_MIN_LENGTH)
    throw new AlignmentError(
      "ALIGNMENT_KEY_TOO_SHORT",
      `对齐密钥短于 ${ALIGNMENT_KEY_MIN_LENGTH} 字符：弱密钥下标识空间可被枚举`,
    );
  return value;
}

function assertPurpose(purpose: string): string {
  const value = (purpose ?? "").trim();
  if (!value)
    throw new AlignmentError(
      "ALIGNMENT_PURPOSE_MISSING",
      "未提供用途域：不同项目必须用不同 purpose，否则跨项目可链接",
    );
  if (/\s/.test(value))
    throw new AlignmentError("ALIGNMENT_PURPOSE_MISSING", "用途域不得含空白字符");
  return value;
}

/**
 * 当前密钥在本用途下的 `kid`（16 hex）。同一个 key 在不同 purpose 下 kid 不同 ——
 * kid 不是"密钥指纹"的全局标识，而是"这把钥在这个用途下"的标签。
 */
export function alignmentKeyId(source: AlignmentKeySource): string {
  const key = assertKey(source.key);
  const purpose = assertPurpose(source.purpose);
  return sm3Hex(`${ALIGNMENT_KID_PREFIX}\n${purpose}\n${key}`).slice(0, ALIGNMENT_KID_LENGTH);
}

/**
 * 派生跨院可对齐假名：`lk_<kid>_<32hex>`。
 *
 * 同一标识 + 同一 purpose + 同一 key ⇒ 任何机构算出同一个值；
 * 不同 purpose ⇒ 不同值（结构性切断跨项目链接）。
 */
export function deriveAlignmentPseudonym(
  identifier: string,
  source: AlignmentKeySource,
): string {
  const key = assertKey(source.key);
  const purpose = assertPurpose(source.purpose);
  const normalized = normalizeAlignmentIdentifier(identifier);
  const kid = alignmentKeyId({ key, purpose });
  const digest = hmacSm3Hex(
    key,
    `${ALIGNMENT_DERIVE_PREFIX}\n${purpose}\n${normalized}`,
  );
  return `${ALIGNMENT_PSEUDONYM_PREFIX}${kid}_${digest.slice(0, ALIGNMENT_VALUE_LENGTH)}`;
}

/** 值形态判定（不校验 kid 是否属于当前 key —— 回放旧值时必须允许旧 kid）。 */
export function isAlignmentPseudonym(value: unknown): value is string {
  return typeof value === "string" && /^lk_[0-9a-f]{16}_[0-9a-f]{32}$/.test(value);
}

/** 取出值里的 kid（用于审计/轮换对账）。 */
export function alignmentKidOf(value: string): string | null {
  if (!isAlignmentPseudonym(value)) return null;
  return value.slice(ALIGNMENT_PSEUDONYM_PREFIX.length, ALIGNMENT_PSEUDONYM_PREFIX.length + ALIGNMENT_KID_LENGTH);
}

/**
 * 轮换友好的派生器：按 `purpose` 给当前 key；`deriveWith(retiredKid, id)` 用于**复算历史值**。
 *
 * 刻意不做"自动挑密钥"：挑错了就是静默产生对不上历史的值。调用方必须显式给出 kid。
 */
export class AlignmentDeriver {
  private readonly retired = new Map<string, string>();

  constructor(readonly source: AlignmentKeySource) {
    assertKey(source.key);
    assertPurpose(source.purpose);
  }

  /** 保留一把退役密钥（仅供复算历史对齐值，不用于新派生）。 */
  retire(kid: string, key: string): this {
    const value = assertKey(key);
    this.retired.set(kid, value);
    return this;
  }

  kid(): string {
    return alignmentKeyId(this.source);
  }

  current(identifier: string): string {
    return deriveAlignmentPseudonym(identifier, this.source);
  }

  /** 用退役密钥复算：kid 必须与当前用途一致，否则说明用错了密钥表。 */
  historical(identifier: string, kid: string): string {
    const key = this.retired.get(kid);
    if (!key)
      throw new AlignmentError(
        "ALIGNMENT_KEY_MISSING",
        `没有 kid=${kid} 的退役密钥：历史对齐值无法复算（拒绝用现行密钥冒充）`,
      );
    return deriveAlignmentPseudonym(identifier, { key, purpose: this.source.purpose });
  }
}
