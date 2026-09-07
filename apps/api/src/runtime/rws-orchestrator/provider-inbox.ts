/** Provider-facing inbound assignment row (本院连接器任务队列). */
export type ProviderInboxKind = "rws" | "fl_prediction";

export interface ProviderInboxItem {
  kind: ProviderInboxKind;
  assignmentId: string;
  taskId: string;
  title: string;
  purpose: string;
  consumerId: string;
  /** Human-readable workload, e.g. "L0 算法核验" / "L4 XGBoost". */
  workloadLabel: string;
  contractId: string;
  status: string;
  error?: string;
  latestProgress?: { at: string; stage: string; detail?: string };
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  /** Own-site summary only — never other providers' aggregates. */
  resultHint?: string;
}

const RWS_TYPE_LABEL: Record<string, string> = {
  "algorithm-validation": "L0 算法核验",
  cohort: "队列统计",
  "adverse-event": "不良反应",
  disproportionality: "L1.5 失衡信号",
  "comparative-effect": "L2 比较效果",
  "causal-survival": "L3 因果生存",
  "causal-psm": "L3 因果 PSM",
};

export function rwsWorkloadLabel(
  analysis: Record<string, unknown> | undefined,
): string {
  const type = String(analysis?.type ?? "rws");
  return RWS_TYPE_LABEL[type] ?? `RWS · ${type}`;
}

export function rwsResultHint(
  aggregate: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!aggregate) return undefined;
  const vr = aggregate.validationResult as
    | {
        suppressed?: boolean;
        metrics?: {
          sensitivity?: { point?: number };
          specificity?: { point?: number };
        };
      }
    | undefined;
  if (vr) {
    if (vr.suppressed) return "已抑制（小细胞）";
    const se = vr.metrics?.sensitivity?.point;
    const sp = vr.metrics?.specificity?.point;
    if (typeof se === "number" && typeof sp === "number") {
      return `Se ${(se * 100).toFixed(1)}% · Sp ${(sp * 100).toFixed(1)}%`;
    }
  }
  const n = aggregate.cohortSize;
  if (typeof n === "number") return `队列 n=${n}`;
  return undefined;
}

export function flWorkloadLabel(
  spec: Record<string, unknown> | undefined,
): string {
  const model = String(spec?.modelType ?? "model");
  return `L4 · ${model}`;
}

export function flResultHint(
  partyResult: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!partyResult) return undefined;
  const n = partyResult.sampleCount;
  const auc = (partyResult.localMetrics as { auc?: number } | undefined)?.auc;
  const parts: string[] = [];
  if (typeof n === "number") parts.push(`n=${n}`);
  if (typeof auc === "number") parts.push(`AUC ${auc.toFixed(3)}`);
  return parts.length ? parts.join(" · ") : undefined;
}

export function latestProgress(
  progress: Record<string, unknown>[] | null | undefined,
): ProviderInboxItem["latestProgress"] {
  if (!progress?.length) return undefined;
  const last = progress[progress.length - 1] as {
    at?: string;
    stage?: string;
    detail?: string;
  };
  if (!last?.stage) return undefined;
  return {
    at: String(last.at ?? ""),
    stage: String(last.stage),
    detail: last.detail ? String(last.detail) : undefined,
  };
}
