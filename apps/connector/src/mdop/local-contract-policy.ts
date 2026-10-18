// 本地合约确认策略（D-MDOP-4 第 3 步）。
//
// **缺省是人工确认**：自动确认必须由本地策略文件**显式点名**合约才生效，且签名记录里
// MUST 标注 `review=auto(policy)`。演示环境也不放宽这条——否则「演示的自动确认」会被
// 误读成「医院同意了」。策略文件由院内运维维护，平台无法影响它。
import { readFileSync } from 'node:fs';

export interface MdopLocalContractPolicy {
  /** `manual`（缺省）或 `auto`。`auto` 下也只有点名列表内的合约会自动确认。 */
  review: 'auto' | 'manual';
  /** 允许自动确认的合约 id（精确匹配）。空数组 = 一个都不自动确认。 */
  autoConfirmContractIds: string[];
  /**
   * **预授权规则（Phase 3 自动创建合约）**：按**条款谓词**授权，而不是按合约 id。
   *
   * 为什么需要：自动创建的场景里，合约 id 由平台生成（randomUUID），医院**不可能预先点名**。
   * 医院的真实诉求是"对这家机构、这个产品、这类用途、这类条款，我预先同意"——
   * 那就把这条意思写成谓词，由**院内本地**文件维护（平台无法影响，D-MDOP-4 / 本地策略）。
   *
   * 匹配语义（逐项，缺省即不受该维度约束，但规则本身**必须至少写一个维度**）：
   * - `dataProductId` / `consumerId` / `purpose`：精确相等
   * - `maxValidDays`：合约有效期不超过 N 天
   * - `minMinCell`：合约里的最小单元格（`publication.minCell`）不得小于该值（越大越安全）
   * 任一维度不符 → 不自动确认（落回人工）。
   *
   * 不设"出域预设"维度：规范化的 MDOP 合约里没有这个字段（只有 `publication.minCell` 与
   * `allowed_ops`）。要按预设授权就得先给合约 schema 加字段——那是另一个决定，不在本轮假装支持。
   */
  autoConfirmRules?: MdopAutoConfirmRule[];
  /** 策略说明（写进审计，便于事后解释为什么自动确认过）。 */
  note?: string;
}

/** 一条预授权规则（谓词）。至少一个维度非空，否则配置即错。 */
export interface MdopAutoConfirmRule {
  /** 规则标签（写进签名留痕，便于事后对账"是哪条预授权"). */
  label?: string;
  dataProductId?: string;
  consumerId?: string;
  purpose?: string;
  maxValidDays?: number;
  minMinCell?: number;
}

/** 参与匹配的合约视图：连接器本地从 canonical 解析出来的条款子集。 */
export interface AutoConfirmCandidate {
  contractId: string;
  dataProductId?: string;
  consumerId?: string;
  purposeCode?: string;
  validUntil?: string;
  /** 合约里的最小单元格（`publication.minCell`）；缺失 = 未声明 */
  minCell?: number;
  /** 便于计算有效期天数 */
  now?: Date;
}

export const MANUAL_POLICY: MdopLocalContractPolicy = {
  review: 'manual',
  autoConfirmContractIds: [],
};

export const CONTRACT_POLICY_ENV = 'CONNECTOR_MDOP_CONTRACT_POLICY_FILE';

export function contractPolicyFilePath(env: NodeJS.ProcessEnv = process.env): string {
  // 显式走 process.env 读取，使部署登记表（DEPLOY.md §2）与代码读取点能被同一套对拍机检到。
  if (env === process.env) return (process.env.CONNECTOR_MDOP_CONTRACT_POLICY_FILE ?? '').trim();
  return (env[CONTRACT_POLICY_ENV] ?? '').trim();
}

/**
 * 读策略文件。文件不存在 / 未配置 → 人工确认（fail-closed，不静默放行）。
 * 文件存在但结构非法 → 抛错拒绝启动（宁可不启动，不要在用错策略的情况下跑）。
 */
export function loadContractPolicy(
  env: NodeJS.ProcessEnv = process.env,
): MdopLocalContractPolicy {
  const path = contractPolicyFilePath(env);
  if (!path) return { ...MANUAL_POLICY };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`合约策略文件不可读或不是合法 JSON：${path}（${(err as Error).message}）`);
  }
  return parsePolicy(parsed);
}

export function parsePolicy(raw: unknown): MdopLocalContractPolicy {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new Error('合约策略必须是对象');
  const obj = raw as Record<string, unknown>;
  const review = obj.review ?? 'manual';
  if (review !== 'auto' && review !== 'manual')
    throw new Error(`合约策略 review 必须 auto 或 manual（收到 ${String(review)}）`);
  const ids = obj.autoConfirmContractIds ?? [];
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string'))
    throw new Error('合约策略 autoConfirmContractIds 必须是字符串数组');
  const rules = parseRules(obj.autoConfirmRules);
  const note = obj.note;
  if (note !== undefined && typeof note !== 'string')
    throw new Error('合约策略 note 必须是字符串');
  return {
    review,
    autoConfirmContractIds: [...(ids as string[])],
    ...(rules.length > 0 ? { autoConfirmRules: rules } : {}),
    ...(note ? { note } : {}),
  };
}

function parseRules(raw: unknown): MdopAutoConfirmRule[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('合约策略 autoConfirmRules 必须是数组');
  return raw.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      throw new Error(`autoConfirmRules[${index}] 必须是对象`);
    const rule = item as Record<string, unknown>;
    const str = (key: string): string | undefined => {
      const value = rule[key];
      if (value === undefined) return undefined;
      if (typeof value !== 'string' || value.trim() === '')
        throw new Error(`autoConfirmRules[${index}].${key} 必须是非空字符串`);
      return value.trim();
    };
    const label = str('label');
    const dataProductId = str('dataProductId');
    const consumerId = str('consumerId');
    const purpose = str('purpose');
    let maxValidDays: number | undefined;
    if (rule.maxValidDays !== undefined) {
      const value = rule.maxValidDays;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        throw new Error(`autoConfirmRules[${index}].maxValidDays 必须是正数`);
      maxValidDays = Math.floor(value);
    }
    let minMinCell: number | undefined;
    if (rule.minMinCell !== undefined) {
      const value = rule.minMinCell;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        throw new Error(`autoConfirmRules[${index}].minMinCell 必须是正数`);
      minMinCell = Math.floor(value);
    }
    const ruleOut: MdopAutoConfirmRule = {
      ...(label ? { label } : {}),
      ...(dataProductId ? { dataProductId } : {}),
      ...(consumerId ? { consumerId } : {}),
      ...(purpose ? { purpose } : {}),
      ...(maxValidDays ? { maxValidDays } : {}),
      ...(minMinCell ? { minMinCell } : {}),
    };
    // 空谓词 = 等于"什么都自动确认"，是最危险的配置，直接拒（fail-closed 的边界）
    if (Object.keys(ruleOut).length === 0)
      throw new Error(`autoConfirmRules[${index}] 是空规则（至少要写一个维度）`);
    return ruleOut;
  });
}

/**
 * 该合约是否被本地策略显式允许自动确认。
 *
 * 两条路径：按 id 点名（`autoConfirmContractIds`）或**按条款谓词预授权**（`autoConfirmRules`）。
 * 缺省（无策略文件 / review=manual / 没有任何规则命中）→ 人工确认。
 */
export function isAutoConfirmAllowed(
  policy: MdopLocalContractPolicy,
  candidate: string | AutoConfirmCandidate,
): boolean {
  if (policy.review !== 'auto') return false;
  const view: AutoConfirmCandidate =
    typeof candidate === 'string' ? { contractId: candidate } : candidate;
  if (policy.autoConfirmContractIds.includes(view.contractId)) return true;
  return (policy.autoConfirmRules ?? []).some((rule) => ruleMatches(rule, view));
}

/** 谓词匹配：逐项检查**规则里写了**的维度；没写的维度不受约束。 */
export function ruleMatches(rule: MdopAutoConfirmRule, view: AutoConfirmCandidate): boolean {
  if (rule.dataProductId && rule.dataProductId !== view.dataProductId) return false;
  if (rule.consumerId && rule.consumerId !== view.consumerId) return false;
  if (rule.purpose && rule.purpose !== view.purposeCode) return false;
  if (rule.maxValidDays) {
    if (!view.validUntil) return false;
    const now = view.now ?? new Date();
    const days = (new Date(view.validUntil).getTime() - now.getTime()) / 86_400_000;
    if (!Number.isFinite(days) || days > rule.maxValidDays) return false;
  }
  if (rule.minMinCell) {
    // 合约没声明 minCell，或声明得比预授权底线还小 → 不自动签（fail-closed）
    if (view.minCell === undefined || view.minCell < rule.minMinCell) return false;
  }
  return true;
}

/** 命中的规则（用于留痕：写明是哪一条预授权）。 */
export function matchingRule(
  policy: MdopLocalContractPolicy,
  view: AutoConfirmCandidate,
): MdopAutoConfirmRule | null {
  return (policy.autoConfirmRules ?? []).find((rule) => ruleMatches(rule, view)) ?? null;
}

/**
 * 自动确认在签名记录里的标注（规格原文：`review=auto(policy)`）。
 * 命中**谓词规则**时把规则标签写进去：事后能对账"是哪条预授权放的行"。
 */
export function autoConfirmNote(
  policy: MdopLocalContractPolicy,
  rule?: MdopAutoConfirmRule | null,
): string {
  const suffix = policy.note ? `policy:${policy.note}` : 'policy';
  if (rule) return `auto(${suffix}#${rule.label ?? ruleKey(rule)})`;
  return `auto(${suffix})`;
}

/** 规则的可读键（没写 label 时用它做留痕）。 */
export function ruleKey(rule: MdopAutoConfirmRule): string {
  return [
    rule.dataProductId ?? '*',
    rule.consumerId ?? '*',
    rule.purpose ?? '*',
    rule.maxValidDays ? `${rule.maxValidDays}d` : '*',
    rule.minMinCell ? `minCell>=${rule.minMinCell}` : '*',
  ].join('/');
}
