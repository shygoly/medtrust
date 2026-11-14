import type { ReactNode } from "react";
import { nodeStateLabel, statusLabel, type NodeRunState, type TaskStatus } from "@/lib/task-status";
import type { StatusTone } from "@/lib/status-tone";
import { NavTitle } from "./nav-title";

export function PageHeader({
  kicker,
  title,
  desc,
  action,
}: {
  kicker: string;
  /** 省略时取导航清单里当前页面的 label；只有动态详情页才需要传对象自身的标题。 */
  title?: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <header
      className="px-8 py-6 border-b flex flex-wrap items-end justify-between gap-x-6 gap-y-4"
      style={{ borderColor: "var(--cs-line)" }}
    >
      {/* 标题区至少留 16rem；放不下时动作区整体换到下一行，而不是把说明或按钮文字挤成竖排。 */}
      <div className="flex-1 min-w-64">
        <div className="cs-label">{kicker}</div>
        <h1 className="text-2xl font-semibold mt-1.5 tracking-tight">{title ?? <NavTitle />}</h1>
        {desc && (
          <p className="text-sm mt-1.5 max-w-2xl" style={{ color: "var(--cs-dim)" }}>
            {desc}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
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
  failed: "cs-dot-block",
  cancelled: "cs-dot-idle",
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

const nodeColor: Record<NodeRunState, string> = {
  pending: "var(--cs-amber)",
  authorized: "var(--cs-cyan)",
  executing: "var(--cs-cyan)",
  gate: "var(--cs-cyan)",
  returned: "var(--cs-green)",
  denied: "var(--cs-red)",
};

export function NodeStateBadge({ state }: { state: NodeRunState }) {
  return (
    <span className="cs-chip" style={{ color: nodeColor[state], borderColor: nodeColor[state] }}>
      {nodeStateLabel[state]}
    </span>
  );
}

const bannerColor = { error: "var(--cs-red)", success: "var(--cs-green)", warn: "var(--cs-amber)" } as const;

/** 页顶反馈条（DESIGN §7）：提交级错误与操作结果。控制台尚无 toast，成功确认也走这里。 */
export function Banner({
  tone = "error",
  className = "",
  children,
}: {
  tone?: keyof typeof bannerColor;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`cs-panel px-5 py-3 text-sm ${className}`}
      style={{ color: bannerColor[tone], borderColor: bannerColor[tone] }}
    >
      {children}
    </div>
  );
}

const toneColor: Record<StatusTone, string> = {
  ok: "var(--cs-green)",
  attention: "var(--cs-amber)",
  blocked: "var(--cs-red)",
  neutral: "var(--cs-faint)",
};

/** 非任务类状态的徽章（账号 / 认证 / 证书 / 应用…）。语义由 lib/status-tone 的 statusTone 给出（DESIGN §2）。 */
export function StatusChip({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="cs-chip" style={{ color: toneColor[tone], borderColor: toneColor[tone] }}>
      {children}
    </span>
  );
}

/** 标签-值对：`cs-label` 标签 + 值；标识类的值用 `mono`。 */
export function Field({ label, mono = false, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="cs-label">{label}</div>
      <div className={`mt-1 text-sm ${mono ? "cs-mono break-all" : ""}`}>{children}</div>
    </div>
  );
}
