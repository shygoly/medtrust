/**
 * 「会话证明 + 本院核验结论」的展示视图（任务 7.4）。
 *
 * 三态必须分开，且**「没核验」绝不能显示成「核验通过」**：
 *  - `verified`：持有方连接器核验通过（有它签名的回执）；
 *  - `rejected`：核验失败（附原因，如实显示）；
 *  - `unverified`：**还没有核验回执**（或该节点还没上报见证）——这是缺省状态，不是通过。
 */

export interface WitnessRowView {
  node: string;
  kind: string;
  measurement: string;
  tcb: string | null;
  quoteDigest: string;
  keyId: string | null;
  expiresAt: string;
  verifiedBy: string;
  verification: {
    status: "verified" | "rejected" | "unverified";
    label: string;
    verifier: string | null;
    at: string | null;
    reason: string | null;
  };
}

export interface WitnessStatusView {
  rows: WitnessRowView[];
  /** 至今没有上报任何见证的节点（不得显示成「核验通过」）。 */
  nodesWithoutWitness: string[];
  /** 有见证但还没有任何核验回执的节点。 */
  nodesWithoutVerification: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function witnessStatusView(input: unknown): WitnessStatusView {
  const obj = isObject(input) ? input : {};
  const rawRows = Array.isArray(obj.witnesses) ? obj.witnesses : [];
  const rows: WitnessRowView[] = [];
  for (const raw of rawRows) {
    if (!isObject(raw)) continue;
    const hv = isObject(raw.holderVerification) ? raw.holderVerification : null;
    const status =
      hv?.status === "verified" || hv?.status === "rejected" ? hv.status : ("unverified" as const);
    rows.push({
      node: String(raw.node ?? "—"),
      kind: String(raw.kind ?? "—"),
      measurement: String(raw.measurement ?? "—"),
      tcb: typeof raw.tcb === "string" ? raw.tcb : null,
      quoteDigest: String(raw.quoteDigest ?? "—"),
      keyId: typeof raw.keyId === "string" ? raw.keyId : null,
      expiresAt: String(raw.expiresAt ?? "—"),
      verifiedBy: String(raw.verifiedBy ?? "—"),
      verification: {
        status,
        label:
          status === "verified"
            ? "本院核验通过"
            : status === "rejected"
              ? "本院核验未通过"
              : "尚未核验",
        verifier: typeof hv?.verifier === "string" ? hv.verifier : null,
        at: typeof hv?.at === "string" ? hv.at : null,
        reason: typeof hv?.reason === "string" ? hv.reason : null,
      },
    });
  }
  return {
    rows,
    nodesWithoutWitness: strings(obj.nodesWithoutWitness),
    nodesWithoutVerification: strings(obj.nodesWithoutVerification),
  };
}
