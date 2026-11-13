"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, Gavel } from "lucide-react";
import { PageHeader, Panel, TaskStatusBadge } from "@/components/console/ui";
import { RoleGate } from "@/components/console/role-gate";
import { useTaskList } from "@/hooks/use-task-list";
import { participantLabel } from "@/lib/federated-tasks";
import {
  CHANNEL_OPTIONS,
  ROLE_OPTIONS,
  STATUS_OPTIONS,
  channelLabel,
  filterTaskRows,
  formatTaskListTime,
  parseTaskFacets,
  shouldShowPurposeChip,
  taskListHref,
  type TaskFacets,
} from "@/lib/task-list";

function FacetGroup<T extends string>({
  label,
  options,
  value,
  hrefFor,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T | undefined;
  hrefFor: (value: T | undefined) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="cs-label w-16">{label}</span>
      <Link href={hrefFor(undefined)} className="cs-chip" data-active={!value}>
        全部
      </Link>
      {options.map((o) => (
        <Link key={o.value} href={hrefFor(o.value)} className="cs-chip" data-active={value === o.value}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}

// 唯一的任务列表：RWS、L4 联邦预测、SecretFlow、MDOP 作业，提供方另含分派给本院的入站任务。
// 分面（通道 / 状态 / 我方角色）写在地址里，旧的分通道列表页重定向到对应分面。
export default function TasksPage() {
  const facets = parseTaskFacets(useSearchParams());
  const { data, isLoading } = useTaskList({ live: true });
  const rows = data?.rows ?? [];
  const shown = filterTaskRows(rows, facets);
  // 我方角色分面只列出当前用户实际拥有的角色（运营、合规没有，不显示这一行）。
  const roleOptions = ROLE_OPTIONS.filter((o) => facets.role === o.value || rows.some((r) => r.myRole === o.value));
  const with_ = (patch: TaskFacets) => taskListHref({ ...facets, ...patch });

  return (
    <div>
      <PageHeader
        kicker="ORCHESTRATION · 联邦任务"
        title="编排任务"
        desc="RWS、L4 联邦预测、SecretFlow 联邦密算与 MDOP 作业的统一列表；提供方在此查看分派给本院的任务。"
        action={
          <div className="flex items-center gap-2">
            <Link href="/space/atlas/compose" className="cs-btn cs-btn-ghost">
              <Gavel size={15} /> 去编排
            </Link>
            <RoleGate roles={["consumer"]}>
              <Link href="/space/tasks/new" className="cs-btn">
                <Plus size={15} /> 发起任务
              </Link>
            </RoleGate>
          </div>
        }
      />
      <div className="p-8 space-y-4">
        <Panel className="px-6 py-4 text-sm" style={{ color: "var(--cs-dim)" }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>
              <strong style={{ color: "var(--cs-text)" }}>RWS / L4 联邦预测</strong>：合约准入 → 连接器出站拉取，可在本页发起与跟踪。
            </span>
            <span>
              <strong style={{ color: "var(--cs-text)" }}>SecretFlow</strong>：多模态 LoRA 联邦微调，在{" "}
              <Link href="/space/atlas/yaml" className="underline" style={{ color: "var(--cs-cyan)" }}>
                密算编排
              </Link>{" "}
              提交 YAML 发起。
            </span>
            <span>
              <strong style={{ color: "var(--cs-text)" }}>MDOP</strong>：各院本地复核并签名 → 平台签发执行凭证 → 执行 → 平台合并；发起 RWS 的 L1.5 失衡信号时勾选「经 MDOP 执行」。
            </span>
          </div>
        </Panel>

        <Panel className="px-6 py-4 space-y-3">
          <FacetGroup label="通道" options={CHANNEL_OPTIONS} value={facets.channel} hrefFor={(channel) => with_({ channel })} />
          <FacetGroup label="状态" options={STATUS_OPTIONS} value={facets.status} hrefFor={(status) => with_({ status })} />
          {roleOptions.length > 0 && (
            <FacetGroup label="我方角色" options={roleOptions} value={facets.role} hrefFor={(role) => with_({ role })} />
          )}
        </Panel>

        {!!data?.failed.length && (
          <Panel className="px-6 py-4 text-sm" style={{ color: "var(--cs-amber)" }}>
            部分通道读取失败：{data.failed.join("、")}。下方只显示其余通道的任务。
          </Panel>
        )}

        {isLoading && <Panel className="px-6 py-5 cs-label">加载中…</Panel>}
        {!isLoading && rows.length === 0 && <Panel className="px-6 py-5 cs-label">暂无任务。</Panel>}
        {!isLoading && rows.length > 0 && shown.length === 0 && (
          <Panel className="px-6 py-5 text-sm" style={{ color: "var(--cs-dim)" }}>
            没有符合筛选条件的任务。
            <Link href={taskListHref()} className="underline ml-2" style={{ color: "var(--cs-cyan)" }}>
              清除筛选
            </Link>
          </Panel>
        )}
        {shown.map((t) => (
          <Link key={`${t.channel}-${t.taskId}-${t.myRole ?? ""}`} href={t.href} className="block">
            <Panel className="px-6 py-5 hover:border-[var(--cs-cyan)] transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="cs-chip text-[0.65rem]">{channelLabel(t.channel)}</span>
                    {t.historical ? (
                      <span className="cs-chip text-[0.65rem]" style={{ color: "var(--cs-amber)", borderColor: "var(--cs-amber)" }}>
                        历史
                      </span>
                    ) : null}
                    <h3 className="text-base font-medium truncate">{t.title}</h3>
                  </div>
                  <div className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>
                    {t.taskId}
                    {t.consumerId ? ` · ${participantLabel(t.consumerId)}` : ""}
                    {t.createdAt ? ` · ${formatTaskListTime(t.createdAt)}` : ""}
                  </div>
                  <p className="text-sm mt-2 max-w-3xl" style={{ color: "var(--cs-dim)" }}>
                    {t.summary}
                  </p>
                  {t.statusLabel && t.statusLabel !== "—" ? (
                    <div className="cs-mono text-[0.65rem] mt-1" style={{ color: "var(--cs-faint)" }} title="通道原始状态">
                      {t.statusLabel}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0">
                  <TaskStatusBadge status={t.badge} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {shouldShowPurposeChip(t.title, t.purpose) && (
                  <span className="cs-chip">目的 · {t.purpose}</span>
                )}
                {t.providerCount != null && t.providerCount > 0 && (
                  <span className="cs-chip">{t.providerCount} 家连接器</span>
                )}
                {t.myRole && (
                  <span className="cs-chip">{t.myRole === "provider" ? "分派给本院" : "我发起的"}</span>
                )}
              </div>
            </Panel>
          </Link>
        ))}
      </div>
    </div>
  );
}
