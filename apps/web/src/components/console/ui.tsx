import type { ReactNode } from "react";
import type { TaskStatus, RwsTask } from "@/lib/space-mock";
import { statusLabel, nodeStateLabel } from "@/lib/space-mock";

export function PageHeader({
  kicker,
  title,
  desc,
  action,
}: {
  kicker: string;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <header
      className="px-8 py-6 border-b flex items-end justify-between gap-6"
      style={{ borderColor: "var(--cs-line)" }}
    >
      <div>
        <div className="cs-label">{kicker}</div>
        <h1 className="text-2xl font-semibold mt-1.5 tracking-tight">{title}</h1>
        {desc && (
          <p className="text-sm mt-1.5 max-w-2xl" style={{ color: "var(--cs-dim)" }}>
            {desc}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

export function Panel({
  children,
  className = "",
  ticks = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  ticks?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`cs-panel ${ticks ? "cs-ticks" : ""} ${className}`} style={style}>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent?: "cyan" | "green" | "amber" | "red";
}) {
  const color =
    accent === "cyan"
      ? "var(--cs-cyan)"
      : accent === "green"
        ? "var(--cs-green)"
        : accent === "amber"
          ? "var(--cs-amber)"
          : accent === "red"
            ? "var(--cs-red)"
            : "var(--cs-text)";
  return (
    <Panel className="px-5 py-4">
      <div className="cs-label">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="cs-mono text-3xl font-semibold tabular-nums" style={{ color }}>
          {value}
        </span>
        {unit && (
          <span className="text-xs" style={{ color: "var(--cs-faint)" }}>
            {unit}
          </span>
        )}
      </div>
    </Panel>
  );
}

const taskDot: Record<TaskStatus, string> = {
  draft: "cs-dot-off",
  "awaiting-auth": "cs-dot-idle",
  running: "cs-dot-run",
  completed: "cs-dot-on",
  blocked: "cs-dot-block",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className="cs-chip">
      <span className={`cs-dot ${taskDot[status]}`} />
      {statusLabel[status]}
    </span>
  );
}

const nodeColor: Record<RwsTask["targets"][number]["state"], string> = {
  pending: "var(--cs-amber)",
  authorized: "var(--cs-cyan)",
  executing: "var(--cs-cyan)",
  gate: "var(--cs-cyan)",
  returned: "var(--cs-green)",
  denied: "var(--cs-red)",
};

export function NodeStateBadge({ state }: { state: RwsTask["targets"][number]["state"] }) {
  return (
    <span className="cs-chip" style={{ color: nodeColor[state], borderColor: nodeColor[state] }}>
      {nodeStateLabel[state]}
    </span>
  );
}
