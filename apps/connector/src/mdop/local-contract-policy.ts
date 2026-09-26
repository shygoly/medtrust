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
  /** 策略说明（写进审计，便于事后解释为什么自动确认过）。 */
  note?: string;
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
  const note = obj.note;
  if (note !== undefined && typeof note !== 'string')
    throw new Error('合约策略 note 必须是字符串');
  return {
    review,
    autoConfirmContractIds: [...(ids as string[])],
    ...(note ? { note } : {}),
  };
}

/** 该合约是否被本地策略显式允许自动确认。 */
export function isAutoConfirmAllowed(
  policy: MdopLocalContractPolicy,
  contractId: string,
): boolean {
  return policy.review === 'auto' && policy.autoConfirmContractIds.includes(contractId);
}

/** 自动确认在签名记录里的标注（规格原文：`review=auto(policy)`）。 */
export function autoConfirmNote(policy: MdopLocalContractPolicy): string {
  return policy.note ? `auto(policy:${policy.note})` : 'auto(policy)';
}
