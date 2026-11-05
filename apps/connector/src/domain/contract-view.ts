import type { PinnedModuleSpec } from '@medtrust/wasm-algorithms';
// The connector's view of a digital contract, received from the control plane
// over the wire (JSON). The connector enforces it but does not author it; the
// authoritative DigitalContract lives in the control plane (@medtrust/database).
import { RwsAnalysisLevel, RwsArtifactKind } from './types';

export type ContractStatus = 'draft' | 'active' | 'expired' | 'revoked';

/**
 * connector-agent-deidentification：合约里的「脱敏口径」条款（`privacy.deid`）。
 *
 * 合约绑定一个**平台签发的规格 id**，连接器据此做降级检测：规格里缺字段、
 * 把哈希假名写成 keep、把 k 调低，都在执行前被拒。合约不写具体算子 ——
 * 算子随规格版本演进，合约只钉口径要求（可追溯、可吊销）。
 */
export interface ContractDeidClause {
  /** 平台签发的规格 id；连接器只接受这一个 id 的规格。 */
  specId: string;
  /** 允许的最宽松分级（规格 scope.level 不得更宽）。 */
  maxLevel?: 'C0_internal' | 'C0' | 'C1' | 'C2' | 'C3';
  /** 必须有"真变换"（非 keep）的字段。 */
  mandatoryFields?: string[];
  /** 必须 `hmac_pseudonym` 的字段。 */
  pseudonymFields?: string[];
  /** 准标识 k 下限（缺省取合约 minCell）。 */
  minK?: number;
  /** 必须走自由文本规则（text_rules）的字段。 */
  textFields?: string[];
}

export interface Pricing {
  model: "per-record" | "per-task" | "subscription";
  amount: number;
  currency: string;
}

export interface ContractOutputPolicy {
  preset: 'aggregate_only' | 'model_only' | 'aggregate_and_model';
  allowedArtifacts: string[];
  minCell: number;
  dp: { mode: 'none' } | { mode: 'epsilon'; epsilon: number; budgetScope: 'per_task' };
}

export interface ContractView {
  id: string;
  dataProductId?: string;
  purpose: string; // 目的限定
  retention: string; // 留存约束,如 阅后即焚
  output: string; // 输出约束展示标签
  /** Structured egress gate from control-plane snapshot. */
  outputPolicy?: ContractOutputPolicy;
  allowedLevels?: RwsAnalysisLevel[]; // 分析分级授权(rws-analytics-ladder);未声明=不限制
  allowedArtifacts?: RwsArtifactKind[]; // 出域产物白名单;未声明=不限制
  /** Small-cell threshold from outputPolicy (OutputGate). */
  minCell?: number;
  validUntil: string; // ISO
  status: ContractStatus;
  pricing?: Pricing; // 计价条款(value-settlement);无则不结算
  providerId?: string;
  consumerId?: string;
  /**
   * algorithm-sandbox(digital-contract「固定算法模块」条款):分析类型 → 模块 SM3。
   * 写入后计入合约哈希;改动只能新建合约。连接器据此强制该分析走沙箱。
   */
  /**
   * algorithm-sandbox / third-party-module-admission:固定算法模块条款。
   * 旧口径 = 纯 SM3 字符串（平台自研 Tier A）；新口径 = {sm3, tier, review}
   * （第三方 Tier B 必须带层级与平台审查背书，否则 PEP 拒）。
   */
  pinnedModules?: Record<string, PinnedModuleSpec>;
  /**
   * connector-agent-deidentification：脱敏口径条款。写了它，本院该任务的脱敏
   * MUST 走 `CONNECTOR_DEID_MODE` 指定的通道，且规格必须通过降级检测。
   */
  deid?: ContractDeidClause;
}

export function resolveContractMinCell(contract: ContractView | undefined, fallback = 5): number {
  const n = contract?.minCell ?? contract?.outputPolicy?.minCell ?? fallback;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(20, Math.max(5, Math.floor(n)));
}
