/**
 * MDOP 错误码集合（协议 §11）+ 本变更新增的两码，每条带「是否可重试」标记。
 *
 * 拒绝类消息 MUST 只含错误码和一句面向申请方的说明（`E_*` + `describe`），MUST NOT 携带
 * 本地策略原文、剩余预算精确值或数据集规模（协议 §11 / 规格「错误码与拒绝粒度」）。
 */

export const MDOP_ERROR_CODES = [
  "E_AUTH_INVALID",
  "E_REPLAY",
  "E_LABEL_VIOLATION",
  "E_CAPABILITY_MISMATCH",
  "E_OP_NOT_WHITELISTED",
  "E_OP_REVOKED",
  "E_PURPOSE_MISMATCH",
  "E_CONTRACT_EXPIRED",
  "E_BUDGET_EXCEEDED",
  "E_ETHICS_MISSING",
  "E_ATTESTATION_FAILED",
  "E_TICKET_INVALID",
  "E_PEER_UNREACHABLE",
  "E_QUORUM_LOST",
  "E_RUNTIME",
  "E_TIMEOUT",
  "E_RELEASE_CHECK_FAILED",
  "E_RELEASE_DENIED",
  // 本变更新增（v0.2）
  "E_CONTRACT_UNSIGNED",
  "E_SNAPSHOT_CHANGED",
  // 可信空间节点（C2）：证明可用但内容不可接受，与「证明本身不可信」分开，便于申请方区分补救
  "E_MEASUREMENT_NOT_ALLOWED",
  "E_TCB_TOO_OLD",
  "E_KEY_RELEASE_DENIED",
  "E_ENVELOPE_POLICY",
  // 吊销名单未同步：与「已吊销」分开——前者要先同步名单，后者要换算子（连接器与节点都产出该码）
  "E_REVOCATION_UNSYNCED",
  // 协议 v0.3 节点间安全聚合（§7.7、§11）
  "E_PAYLOAD_TOO_LARGE",
  "E_DECRYPTION_FAILED",
  "E_INVALID_CONTRIBUTION",
] as const;

export type MdopErrorCode = (typeof MDOP_ERROR_CODES)[number];

/** 可重试标记（协议 §11 表）。可重试 = 换新 attempt 重跑有意义。 */
export const RETRYABLE: Record<MdopErrorCode, boolean> = {
  E_AUTH_INVALID: false,
  E_REPLAY: false,
  E_LABEL_VIOLATION: false,
  E_CAPABILITY_MISMATCH: false,
  E_OP_NOT_WHITELISTED: false,
  E_OP_REVOKED: false,
  E_PURPOSE_MISMATCH: false,
  E_CONTRACT_EXPIRED: false,
  E_BUDGET_EXCEEDED: false,
  E_ETHICS_MISSING: false,
  // 「视原因」：证明服务暂时不可达可重试，度量不符不可。缺省按不可重试（fail-closed）。
  E_ATTESTATION_FAILED: false,
  E_TICKET_INVALID: false,
  E_PEER_UNREACHABLE: true,
  E_QUORUM_LOST: true,
  E_RUNTIME: true,
  E_TIMEOUT: true,
  E_RELEASE_CHECK_FAILED: false,
  E_RELEASE_DENIED: false,
  E_CONTRACT_UNSIGNED: false,
  E_SNAPSHOT_CHANGED: false,
  E_MEASUREMENT_NOT_ALLOWED: false,
  E_TCB_TOO_OLD: false,
  E_KEY_RELEASE_DENIED: false,
  E_ENVELOPE_POLICY: false,
  E_REVOCATION_UNSYNCED: false,
  // 协议 v0.3（§7.7、§11）
  E_PAYLOAD_TOO_LARGE: false,
  E_DECRYPTION_FAILED: false,
  E_INVALID_CONTRIBUTION: false,
};

/** 默认的、面向申请方的简短说明。不含任何本地信息。 */
const DEFAULT_DESCRIPTION: Record<MdopErrorCode, string> = {
  E_AUTH_INVALID: "消息认证失败",
  E_REPLAY: "消息重复",
  E_LABEL_VIOLATION: "流动等级校验未通过",
  E_CAPABILITY_MISMATCH: "节点能力不满足计划要求",
  E_OP_NOT_WHITELISTED: "算子未在本节点启用",
  E_OP_REVOKED: "算子已被吊销",
  E_PURPOSE_MISMATCH: "用途与合约不符",
  E_CONTRACT_EXPIRED: "合约失效或已终止",
  E_BUDGET_EXCEEDED: "本节点未启用预算账本",
  E_ETHICS_MISSING: "缺少或失效的伦理批件",
  E_ATTESTATION_FAILED: "执行环境证明未通过",
  E_TICKET_INVALID: "执行凭证校验未通过",
  E_PEER_UNREACHABLE: "协同对端不可达",
  E_QUORUM_LOST: "参与方低于下限",
  E_RUNTIME: "算子运行时错误",
  E_TIMEOUT: "执行超时",
  E_RELEASE_CHECK_FAILED: "自动发布检查未通过",
  E_RELEASE_DENIED: "人工审批拒绝",
  E_CONTRACT_UNSIGNED: "合约未经持有方签署",
  E_SNAPSHOT_CHANGED: "数据快照与接受时不一致",
  E_MEASUREMENT_NOT_ALLOWED: "执行环境度量不在允许范围内",
  E_TCB_TOO_OLD: "执行环境可信基版本低于要求",
  E_KEY_RELEASE_DENIED: "数据密钥释放被拒绝",
  E_ENVELOPE_POLICY: "数据信封的使用策略不满足",
  E_REVOCATION_UNSYNCED: "本节点尚未同步到有效的算子吊销名单",
  // 协议 v0.3（§7.7、§11）
  E_PAYLOAD_TOO_LARGE: "密文大小超过上限",
  E_DECRYPTION_FAILED: "聚合密文解密失败",
  E_INVALID_CONTRIBUTION: "聚合贡献格式不符",
};

export interface MdopEdgeRef {
  /** 违规边的标识，形如 `<fromStage>-><toStage>`，编译期错误必须指明（协议 §4.4）。 */
  edge?: string;
  node?: string;
}

/**
 * MDOP 领域错误。`detail` 只允许承载**对端可见**的定位信息（边/节点/错误码），
 * 本地策略原文与数据规模 MUST NOT 进这个字段——它会随拒绝消息发给申请方。
 */
export class MdopError extends Error {
  readonly code: MdopErrorCode;
  readonly retryable: boolean;
  readonly where: MdopEdgeRef;

  constructor(code: MdopErrorCode, where: MdopEdgeRef = {}, message?: string) {
    super(message ? `${code}: ${message}` : `${code}: ${DEFAULT_DESCRIPTION[code]}`);
    this.name = "MdopError";
    this.code = code;
    this.retryable = RETRYABLE[code];
    this.where = where;
  }

  /** 面向上申请方的拒绝说明：错误码 + 一句说明（+ 可指明的边），不含本地细节。 */
  toRejectReason(): { code: MdopErrorCode; message: string; edge?: string } {
    const edge = this.where.edge;
    return {
      code: this.code,
      message: `${DEFAULT_DESCRIPTION[this.code]}${this.where.node ? `（节点 ${this.where.node}）` : ""}`,
      ...(edge ? { edge } : {}),
    };
  }
}

export const defaultDescription = (code: MdopErrorCode): string => DEFAULT_DESCRIPTION[code];

export const isRetryable = (code: string): boolean =>
  (MDOP_ERROR_CODES as readonly string[]).includes(code) &&
  RETRYABLE[code as MdopErrorCode] === true;

/** 可重试错误集合（调度器重试判定用，D-MDOP-1 §7.6）。 */
export const RETRYABLE_CODES: readonly MdopErrorCode[] = MDOP_ERROR_CODES.filter(
  (c) => RETRYABLE[c],
);
