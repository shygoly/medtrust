/**
 * 发布审查清单的**展示视图**（任务 7.3b / 7.4）。
 *
 * 后端交付的 C3 载荷里可能带 `release_manifest`（各持有方条目 + 汇总）。
 * 解析放在这里、并**明确区分三种状态**，因为「没有清单」与「清单说自己没问题」是两件事，
 * 界面 MUST NOT 把前者显示成后者（那正是这套设计最忌讳的「看起来合规」）：
 *  - `absent`：载荷里没有清单（非 C2 通道或旧作业）→ 如实说明看不到；
 *  - `invalid`：有键但解析不过 → 如实报「清单非法」，不猜测内容；
 *  - `ok`：解析通过 → 展示汇总数与逐方明细。
 */

export interface ReleaseManifestPartyView {
  node: string;
  minCell: number;
  suppressed: number;
  secondarySuppression: boolean;
  dp: string;
  budget: string | null;
}

export type ReleaseManifestView =
  | { status: "absent" }
  | { status: "invalid"; reason: string }
  | {
      status: "ok";
      suppressedTotal: number;
      minCell: number;
      dp: string;
      parties: ReleaseManifestPartyView[];
      at: string;
    };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function dpLabel(dp: unknown): string {
  if (!isObject(dp)) return "未知";
  if (dp.mode === "none") return "未加噪（如实记录：本期节点内不加噪）";
  if (dp.mode === "epsilon") return `ε = ${String(dp.epsilon)}`;
  return "未知";
}

function budgetLabel(budget: unknown): string | null {
  if (!isObject(budget)) return null;
  const unit = String(budget.unit ?? "");
  const spent = String(budget.spent ?? "?");
  const limit = String(budget.limit ?? "?");
  const dataset = String(budget.dataset ?? "?");
  return `${dataset}：${spent} / ${limit} ${unit}`;
}

export function releaseManifestView(payload: unknown): ReleaseManifestView {
  if (!isObject(payload)) return { status: "absent" };
  const raw = payload.release_manifest;
  if (raw === undefined) return { status: "absent" };
  if (!isObject(raw)) return { status: "invalid", reason: "release_manifest 不是对象" };

  const partiesRaw = raw.parties;
  if (!Array.isArray(partiesRaw) || partiesRaw.length === 0)
    return { status: "invalid", reason: "parties 为空或不是数组" };
  if (raw.apiVersion !== "mdop.release/1.0")
    return { status: "invalid", reason: `未知清单版本：${String(raw.apiVersion)}` };
  if (typeof raw.suppressedTotal !== "number" || typeof raw.minCell !== "number")
    return { status: "invalid", reason: "缺少汇总数（suppressedTotal / minCell）" };

  const parties: ReleaseManifestPartyView[] = [];
  for (const p of partiesRaw) {
    if (!isObject(p) || typeof p.node !== "string" || typeof p.suppressed !== "number")
      return { status: "invalid", reason: "存在非法的持有方条目" };
    parties.push({
      node: p.node,
      minCell: typeof p.minCell === "number" ? p.minCell : 0,
      suppressed: p.suppressed,
      secondarySuppression: p.secondarySuppression === true,
      dp: dpLabel(p.dp),
      budget: budgetLabel(p.budget),
    });
  }
  return {
    status: "ok",
    suppressedTotal: raw.suppressedTotal,
    minCell: raw.minCell,
    dp: dpLabel(raw.dp),
    parties,
    at: typeof raw.at === "string" ? raw.at : "—",
  };
}
