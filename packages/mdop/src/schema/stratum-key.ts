/**
 * 出域聚合的**分层键**闭合语法，以及「非空字符串列表」这一条通用判据。
 *
 * 为什么放在协议核心：分层键会原样成为 C3 载荷里每个分层的 `key`——它是**跨域边上的文本**。
 * 没有固定分层顺序时，这段文本直接取自持有方的行（`ageBand` / `sex` 两个分量），
 * 若不设语法，任何自由文本都能借这个字段出域。三处（平台模板、持有方封存投影、
 * 可信空间节点执行器）必须用**同一份**判据，各写一份迟早会漂移，所以收在这里。
 *
 * 语法是闭合的（不在其中即拒，不做归一化、不做截断）：
 *   - 年龄段：`<下界>-<上界>` / `<下界>+` / `<<上界>` / `all` / `unknown`，数字 1–3 位；
 *   - 性别：`F` / `M` / `U` / `male` / `female` / `other` / `unknown` / `all`；
 *   - 分层键：`<年龄段>|<性别>`。
 *
 * 词表收的是**本系统自己会产出的取值**，不多不少：
 *   - `male` / `female` / `other` / `unknown` 是 FHIR 性别编码的全集——去标识模块
 *     （`apps/connector/src/domain/deidentifier.ts`）原样带出 `gender`，既有配对数据集用的就是它们；
 *   - 年龄段的 `unknown` 是同一模块在出生日期缺失时给的固定值。
 * 不收这些的话，真实数据里只要有一条缺出生日期或性别为 other 的记录，整个封存阶段就会失败。
 * 它们都是封闭词表里的固定记号，不是自由文本；其余写法一律不收。
 */

/** 年龄段分量。 */
export const STRATUM_AGE_BAND_PATTERN = /^(\d{1,3}-\d{1,3}|\d{1,3}\+|<\d{1,3}|all|unknown)$/;

/** 性别分量。 */
export const STRATUM_SEX_PATTERN = /^(F|M|U|male|female|other|unknown|all)$/;

/** 分层数上限（与各算子模块的分层编号宽度一致）。 */
export const MAX_STRATUM_KEYS = 64;

export function isStratumAgeBand(value: unknown): value is string {
  return typeof value === "string" && STRATUM_AGE_BAND_PATTERN.test(value);
}

export function isStratumSex(value: unknown): value is string {
  return typeof value === "string" && STRATUM_SEX_PATTERN.test(value);
}

/** `<年龄段>|<性别>`：恰好两个分量，各自过语法。 */
export function isStratumKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("|");
  return parts.length === 2 && isStratumAgeBand(parts[0]) && isStratumSex(parts[1]);
}

/**
 * 分层键列表不合规的原因。**只有类别，不带取值**——调用方据此给出固定文案，
 * 不合规的那段文本本身不得进入任何对外的错误说明。
 */
export type StratumKeyListProblem = "not-array" | "too-many" | "bad-key" | "duplicate";

/**
 * 校验一份分层键列表：必须是数组、不超过 {@link MAX_STRATUM_KEYS} 个、
 * 每个都过 {@link isStratumKey}、且互不重复。合规返回 `undefined`。
 *
 * 空数组在这里算合规（「没有任何分层」是否可接受由调用方按场景判定）。
 */
export function stratumKeyListProblem(value: unknown): StratumKeyListProblem | undefined {
  if (!Array.isArray(value)) return "not-array";
  if (value.length > MAX_STRATUM_KEYS) return "too-many";
  const seen = new Set<string>();
  for (const key of value) {
    if (!isStratumKey(key)) return "bad-key";
    if (seen.has(key)) return "duplicate";
    seen.add(key);
  }
  return undefined;
}

/**
 * 「非空数组，且每一项都是非空字符串」。编码白名单用它：
 * 空数组、非数组、夹着非字符串或空串（含只有空白）的数组一律不算有效白名单
 * （否则「白名单无效」会被下游当成「不过滤」）。
 */
export function isNonEmptyStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}
