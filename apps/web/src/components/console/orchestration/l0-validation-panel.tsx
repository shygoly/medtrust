"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/console/ui";
import { DataGrid, GridColumn } from "@/components/console/data";
import type {
  L0ValidationMerged,
  L0ValidationResult,
  L0MetricWithCi,
} from "@/api/client";
import {
  provenanceLabel,
  submissionWarning,
  suppressionExplanation,
} from "@/lib/l0-validation-labels";

/**
 * rws-algorithm-validation L0 results panel (§6.2 + §6.3).
 *
 * Renders the per-provider accuracy DataGrid:
 *   Provider · Se · Sp · PPV · NPV · 状态
 *
 * Behavior contracts:
 * - Per §1.1/§2.1 (D6): results are 分列, one row per provider — never averaged.
 * - Per DESIGN.md §6: numbers are right-aligned tabular-nums; null → "—".
 * - Per §7.3: synthetic results show a banner with the MUST-NOT-submit warning.
 * - Per D3 + task 6.3: "suppressed for insufficient sample" is structurally
 *   distinct from "poor accuracy". Suppressed rows render a red ShieldAlert
 *   chip with the explanation; poor-accuracy rows render normally (the numbers
 *   speak for themselves, no alarm).
 */
function formatPercent(x: number | undefined): string {
  if (x === undefined || x === null || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

function formatCi(ci: [number, number] | undefined): string {
  if (!ci || ci.length !== 2 || Number.isNaN(ci[0]) || Number.isNaN(ci[1])) {
    return "—";
  }
  // en-dash, matching DESIGN.md §6 number style.
  return `${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)}%`;
}

function metricCell(m: L0MetricWithCi | undefined): string {
  if (!m) return "—";
  return `${formatPercent(m.point)} (${formatCi(m.ci95)})`;
}

function StatusChip({ result }: { result: L0ValidationResult }) {
  if (result.suppressed) {
    return (
      <span
        className="cs-chip"
        style={{ color: "var(--cs-red)", borderColor: "var(--cs-red)" }}
        title={suppressionExplanation(result) ?? undefined}
      >
        <ShieldAlert size={12} /> 抑制（样本不足）
      </span>
    );
  }
  // Not suppressed. If metrics exist at all, the algorithm ran successfully —
  // even terrible accuracy is a real result, not an error state. We render a
  // quiet "已出具" chip (green, matches the existing return/ok convention).
  return (
    <span
      className="cs-chip"
      style={{ color: "var(--cs-green)", borderColor: "var(--cs-green)" }}
    >
      <ShieldCheck size={12} /> 已出具
    </span>
  );
}

const columns: GridColumn<L0ValidationResult>[] = [
  {
    header: "数据源",
    className: "col-span-2",
    cell: (r) => <span className="cs-mono text-xs">{r.providerId}</span>,
  },
  {
    header: "Se",
    className: "col-span-2 text-right",
    cell: (r) => (
      <span className="cs-mono tabular-nums">{metricCell(r.metrics?.sensitivity)}</span>
    ),
  },
  {
    header: "Sp",
    className: "col-span-2 text-right",
    cell: (r) => (
      <span className="cs-mono tabular-nums">{metricCell(r.metrics?.specificity)}</span>
    ),
  },
  {
    header: "PPV",
    className: "col-span-1 text-right",
    cell: (r) => (
      <span className="cs-mono tabular-nums">{metricCell(r.metrics?.ppv)}</span>
    ),
  },
  {
    header: "NPV",
    className: "col-span-1 text-right",
    cell: (r) => (
      <span className="cs-mono tabular-nums">{metricCell(r.metrics?.npv)}</span>
    ),
  },
  {
    header: "状态",
    className: "col-span-2",
    cell: (r) => <StatusChip result={r} />,
  },
  {
    header: "金标准",
    className: "col-span-2",
    cell: (r) => (
      <span className="cs-mono text-xs">{provenanceLabel(r.goldStandardProvenance)}</span>
    ),
  },
];

export function L0ValidationPanel({ merged }: { merged?: L0ValidationMerged }) {
  // Synthetic-warning banner: shown when ANY provider's result is synthetic.
  // The §7.3 contract is one warning at the top — provenance is also visible
  // per-row in the金标准 column.
  const hasSynthetic = (merged?.results ?? []).some(
    (r) => r.goldStandardProvenance === "synthetic",
  );
  const syntheticWarning = hasSynthetic ? submissionWarning("synthetic") : null;

  return (
    <Panel className="p-6">
      <div className="cs-label mb-4">L0 准确性指标（按数据源分列）</div>

      {syntheticWarning && (
        <div
          className="mb-4 p-3 text-[0.72rem] flex items-start gap-2"
          style={{
            color: "var(--cs-amber)",
            borderColor: "var(--cs-amber)",
            border: "1px solid",
          }}
        >
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span>{syntheticWarning}</span>
        </div>
      )}

      <DataGrid<L0ValidationResult>
        columns={columns}
        rows={merged?.results}
        rowKey={(r) => r.providerId}
        emptyText="等待各院连接器出站拉取并回传验证结果…"
      />

      <div className="mt-4 text-[0.72rem]" style={{ color: "var(--cs-dim)" }}>
        规范 §1.1 / §2.1 / D6：同一算法在不同数据源的准确性可能不同，
        本表分列呈现、不做跨源合并或平均。
      </div>
    </Panel>
  );
}
