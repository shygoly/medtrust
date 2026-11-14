"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Panel, TaskStatusBadge } from "@/components/console/ui";
import type { TaskBadge, TaskChannel } from "@/lib/task-list";
import { channelLabel, formatTaskListTime } from "@/lib/task-list";
import { participantLabel } from "@/lib/federated-tasks";
import { taskListHref } from "@/lib/task-list";

export type ContractBrowseSummary = {
  id: string;
  label: string;
  secondary?: string;
};

/**
 * 多通道详情共用页头 + 合约侧栏契约（tasks-browse-display P2）。
 */
export function TaskBrowseHeader({
  channel,
  title,
  taskId,
  initiatorId,
  createdAt,
  badge,
  backHref,
  backLabel = "返回任务列表",
  contractSummaries,
  showContractPanel = true,
  children,
  action,
}: {
  channel: TaskChannel;
  title: string;
  taskId: string;
  initiatorId?: string | null;
  createdAt?: string | null;
  badge: TaskBadge;
  backHref?: string;
  backLabel?: string;
  contractSummaries?: ContractBrowseSummary[];
  /** SecretFlow 等自带侧栏布局时可关闭。 */
  showContractPanel?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const initiator = initiatorId?.trim()
    ? participantLabel(initiatorId.trim())
    : "—";
  const when = formatTaskListTime(createdAt);
  return (
    <div>
      <PageHeader
        kicker={`${channelLabel(channel)} · ${taskId.slice(0, 12)}${taskId.length > 12 ? "…" : ""}`}
        title={title}
        desc={`${initiator} 发起 · ${when}`}
        action={
          <div className="flex items-center gap-2">
            <TaskStatusBadge status={badge} />
            {action}
          </div>
        }
      />
      <div className="p-8">
        <Link
          href={backHref ?? taskListHref()}
          className="inline-flex items-center gap-1.5 text-sm mb-6"
          style={{ color: "var(--cs-dim)" }}
        >
          <ArrowLeft size={14} /> {backLabel}
        </Link>
        {showContractPanel ? (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">{children}</div>
            <Panel className="p-6">
              <div className="cs-label mb-4">合约引用</div>
              {contractSummaries && contractSummaries.length > 0 ? (
                <ul className="space-y-3 text-sm">
                  {contractSummaries.map((c) => (
                    <li key={c.id} className="min-w-0">
                      <div className="truncate">{c.label}</div>
                      {c.secondary ? (
                        <div className="text-xs mt-0.5" style={{ color: "var(--cs-dim)" }}>
                          {c.secondary}
                        </div>
                      ) : null}
                      <div
                        className="cs-mono text-[0.65rem] mt-0.5 truncate"
                        style={{ color: "var(--cs-faint)" }}
                        title={c.id}
                      >
                        {c.id}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm" style={{ color: "var(--cs-faint)" }}>
                  暂无合约引用
                </p>
              )}
            </Panel>
          </div>
        ) : (
          <div className="space-y-6">{children}</div>
        )}
      </div>
    </div>
  );
}
