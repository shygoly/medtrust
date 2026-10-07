// 存证账本的显示模型。数据源是 GET /attestations（存证指针账本，`cp_attestation_ref`）：
// 每一行都是真实上链的记录——本地降级回执不在其中。

export type AttestationKind =
  | "policy"
  | "task"
  | "output"
  | "receipt-chain"
  | "node-attestation"
  | "evidence";

/** GET /attestations 的一行（服务端已按角色控权）。 */
export interface AttestationLedgerRecord {
  id: string;
  kind: AttestationKind | string;
  hash: string;
  txHash: string;
  block: number;
  anchoredAt: string;
  subjectType: string | null;
  subjectId: string | null;
  attestationLevel?: string;
}

export interface AttestationRow {
  id: string;
  kind: string;
  kindLabel: string;
  hash: string;
  hashShort: string;
  txHash: string;
  txShort: string;
  block: string;
  time: string;
  subjectLabel: string;
  subjectId: string;
  subjectHref: string | null;
}

/** 空值的统一写法（DESIGN §6：禁止空白 / null / 0 冒充）。 */
export const EMPTY_MARK = "—";

const KIND_LABEL: Record<string, string> = {
  policy: "合约策略",
  task: "任务定义",
  output: "计算结果",
  "receipt-chain": "审计回执链",
  "node-attestation": "节点证明摘要",
  evidence: "监查证据",
};

const SUBJECT: Record<string, { label: string; href: (id: string) => string }> = {
  "rws-task": {
    label: "RWS 任务",
    href: (id) => `/space/tasks/${encodeURIComponent(id)}?workload=rws`,
  },
  "fl-task": {
    label: "联邦预测任务",
    href: (id) => `/space/tasks/${encodeURIComponent(id)}?workload=fl_prediction`,
  },
  "mdop-job": {
    label: "MDOP 作业",
    href: (id) => `/space/mdop/jobs/${encodeURIComponent(id)}`,
  },
  contract: { label: "数字合约", href: () => "/space/contracts" },
  "qtl-breach": { label: "QTL 越限", href: () => "/space/rbqm" },
};

/** 哈希 / 交易号截断：保留算法前缀，前 6 + `...` + 后 6（DESIGN §6）。 */
export function shortHash(value: string | null | undefined): string {
  if (!value) return EMPTY_MARK;
  const colon = value.indexOf(":");
  const prefix = colon >= 0 ? value.slice(0, colon + 1) : "";
  const digest = colon >= 0 ? value.slice(colon + 1) : value;
  if (digest.length <= 14) return value;
  return `${prefix}${digest.slice(0, 6)}...${digest.slice(-6)}`;
}

/** `YYYY-MM-DD HH:mm`（DESIGN §6）。`timeZone` 缺省为浏览者本地时区。 */
export function formatDateTime(
  iso: string | null | undefined,
  timeZone?: string,
): string {
  if (!iso) return EMPTY_MARK;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY_MARK;
  // sv-SE 的日期时间写法就是 ISO 风格的 `YYYY-MM-DD HH:mm`
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** 区块高度 `Block #22`（DESIGN §6）。 */
export function formatBlock(block: number | null | undefined): string {
  return typeof block === "number" && Number.isFinite(block)
    ? `Block #${block}`
    : EMPTY_MARK;
}

export function attestationKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function toAttestationRows(
  records: AttestationLedgerRecord[],
  timeZone?: string,
): AttestationRow[] {
  return records.map((r) => {
    const subject = r.subjectType ? SUBJECT[r.subjectType] : undefined;
    return {
      id: r.id,
      kind: r.kind,
      kindLabel: attestationKindLabel(r.kind),
      hash: r.hash,
      hashShort: shortHash(r.hash),
      txHash: r.txHash,
      txShort: shortHash(r.txHash),
      block: formatBlock(r.block),
      time: formatDateTime(r.anchoredAt, timeZone),
      subjectLabel: subject?.label ?? r.subjectType ?? EMPTY_MARK,
      subjectId: r.subjectId ?? EMPTY_MARK,
      subjectHref: subject && r.subjectId ? subject.href(r.subjectId) : null,
    };
  });
}
