// 降级检测：规格与合约条款比对（design §5 / §7）。
//
// 场景：合约要求"哈希加盐假名 + k≥5 + 自由文本去标识"，而规格把 `patientId` 写成 `keep`
// 或把 `k` 调成 1 —— 这是**静默弱化脱敏**，比不脱敏更危险（看起来"跑过了脱敏"）。
// 因此这里逐条比对，任何一条不满足即拒，记审计，不退回内置弱脱敏。
import type { DeidSpec, DeidTransform } from '@medtrust/mdop';
import type { ContractView } from '../contract-view';

export type DeidDowngradeRule =
  | 'CONTRACT_HAS_NO_DEID_BINDING'
  | 'SPEC_PRODUCT_MISMATCH'
  | 'SPEC_LEVEL_TOO_PERMISSIVE'
  | 'MANDATORY_FIELD_NOT_TRANSFORMED'
  | 'DIRECT_IDENTIFIER_KEPT'
  | 'PSEUDONYM_REQUIRED_BUT_MISSING'
  | 'K_BELOW_CONTRACT'
  | 'SMALL_CELL_SUPPRESSION_DISABLED'
  | 'TEXT_RULES_REQUIRED_BUT_MISSING';

export class DeidDowngradeError extends Error {
  constructor(
    readonly rule: DeidDowngradeRule,
    message: string,
  ) {
    super(`${rule}: ${message}`);
    this.name = 'DeidDowngradeError';
  }
}

/**
 * 合约里的脱敏要求（由合约条款派生，连接器只读）。
 *
 * 平台侧写入合约快照；缺省时按"最严"推断：
 * 不许 `keep` 任何直接标识字段、k 不得低于 `minCell`。
 */
export interface DeidContractRequirement {
  /** 合约绑定的规格 id（`privacy.deid` 条款）；未绑定则该任务不接受任何规格。 */
  specId?: string;
  /** 数据产品 id（规格 scope.product 必须一致）。 */
  productId?: string;
  /** 允许的最宽松分级（规格 scope.level 不得比它更松）。 */
  maxLevel?: DeidSpec['scope']['level'];
  /** 必须被"真变换"（非 keep）的字段。 */
  mandatoryFields?: string[];
  /** 这些字段必须是 `hmac_pseudonym`（假名化，不能只是 drop 或 keep）。 */
  pseudonymFields?: string[];
  /** 小格阈值：规格 quasiIdentifierPolicy.k 不得低于它。 */
  minK?: number;
  /** 必须做自由文本去标识的字段。 */
  textFields?: string[];
}

/** 分级宽严（数字越大越宽）：规格 level 比合约 maxLevel 更宽即降级。 */
const LEVEL_ORDER: Record<string, number> = {
  C0_internal: 0,
  C0: 1,
  C1: 2,
  C2: 3,
  C3: 4,
};

/** 从合约视图派生脱敏要求（合约没收 deid 条款时返回 null → 不允许 agent 模式）。 */
export function deidRequirementOf(
  contract: ContractView | undefined,
): DeidContractRequirement | null {
  const clause = contract?.deid;
  if (!clause) return null;
  return {
    specId: clause.specId,
    productId: contract?.dataProductId,
    maxLevel: clause.maxLevel,
    mandatoryFields: clause.mandatoryFields,
    pseudonymFields: clause.pseudonymFields,
    minK: clause.minK ?? contract?.minCell ?? contract?.outputPolicy?.minCell,
    textFields: clause.textFields,
  };
}

/**
 * 逐条比对规格与合约要求；任何一条不满足即抛 {@link DeidDowngradeError}。
 *
 * 判据只做"更严/更松"的比较，不做启发式猜测：字段集合、算子类别、k 值、等级四件事。
 */
export function assertNoDowngrade(
  spec: DeidSpec,
  requirement: DeidContractRequirement,
): void {
  if (!requirement.specId)
    throw new DeidDowngradeError(
      'CONTRACT_HAS_NO_DEID_BINDING',
      '合约没有绑定脱敏规格条款（privacy.deid），不接受任何自选规格',
    );
  if (requirement.specId !== spec.id)
    throw new DeidDowngradeError(
      'CONTRACT_HAS_NO_DEID_BINDING',
      `规格 ${spec.id} 不是合约绑定的 ${requirement.specId}`,
    );

  if (requirement.productId && requirement.productId !== spec.scope.product)
    throw new DeidDowngradeError(
      'SPEC_PRODUCT_MISMATCH',
      `规格 scope.product=${spec.scope.product} 与合约数据产品 ${requirement.productId} 不一致`,
    );

  if (requirement.maxLevel) {
    const specRank = LEVEL_ORDER[spec.scope.level];
    const maxRank = LEVEL_ORDER[requirement.maxLevel];
    if (specRank === undefined || maxRank === undefined)
      throw new DeidDowngradeError(
        'SPEC_LEVEL_TOO_PERMISSIVE',
        `无法判定分级宽严：规格 ${spec.scope.level} / 合约 ${requirement.maxLevel}`,
      );
    if (specRank > maxRank)
      throw new DeidDowngradeError(
        'SPEC_LEVEL_TOO_PERMISSIVE',
        `规格分级 ${spec.scope.level} 宽于合约允许的 ${requirement.maxLevel}`,
      );
  }

  const byField = new Map<string, DeidTransform>(
    spec.transforms.map((t) => [t.field, t]),
  );

  for (const field of requirement.mandatoryFields ?? []) {
    const transform = byField.get(field);
    if (!transform)
      throw new DeidDowngradeError(
        'MANDATORY_FIELD_NOT_TRANSFORMED',
        `合约要求的字段 ${field} 在规格里没有任何变换（等于原样带出）`,
      );
    if (transform.op === 'keep')
      throw new DeidDowngradeError(
        'DIRECT_IDENTIFIER_KEPT',
        `合约要求的字段 ${field} 在规格里是 keep（等于不脱敏）`,
      );
  }

  for (const field of requirement.pseudonymFields ?? []) {
    const transform = byField.get(field);
    if (!transform || transform.op !== 'hmac_pseudonym')
      throw new DeidDowngradeError(
        'PSEUDONYM_REQUIRED_BUT_MISSING',
        `合约要求字段 ${field} 做哈希加盐假名（hmac_pseudonym），规格写的是 ${transform?.op ?? '缺失'}`,
      );
  }

  if (requirement.minK !== undefined && requirement.minK !== null) {
    const k = spec.quasiIdentifierPolicy?.k;
    if (k === undefined)
      throw new DeidDowngradeError(
        'K_BELOW_CONTRACT',
        `合约要求准标识 k≥${requirement.minK}，规格没有 quasiIdentifierPolicy（无法保证）`,
      );
    if (k < requirement.minK)
      throw new DeidDowngradeError(
        'K_BELOW_CONTRACT',
        `规格 k=${k} 低于合约要求 ${requirement.minK}`,
      );
    if (!spec.quasiIdentifierPolicy?.suppressIfBelow)
      throw new DeidDowngradeError(
        'SMALL_CELL_SUPPRESSION_DISABLED',
        '规格关闭了小格抑制（suppressIfBelow=false），等于放弃 k 匿名性',
      );
  }

  for (const field of requirement.textFields ?? []) {
    const transform = byField.get(field);
    if (!transform || transform.op !== 'text_rules')
      throw new DeidDowngradeError(
        'TEXT_RULES_REQUIRED_BUT_MISSING',
        `合约要求字段 ${field} 走自由文本规则（text_rules），规格写的是 ${transform?.op ?? '缺失'}`,
      );
  }
}
