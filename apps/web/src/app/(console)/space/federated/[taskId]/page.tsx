"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/console/ui";
import { AsyncBoundary } from "@/components/console/data";
import { TaskBrowseHeader } from "@/components/console/task-browse-header";
import { DeliverableDetail } from "@/components/console/deliverable-detail";
import { useAuth } from "@/lib/auth";
import { api } from "@/api/client";
import {
  federatedConnectorsLabel,
  federatedStateColor,
  federatedStateLabel,
  participantLabel,
  type SecretFlowMergedResult,
} from "@/lib/federated-tasks";
import { mapOrchestrationStatus } from "@/lib/orchestration-workloads";
import { taskDisplayTitle, taskListHref } from "@/lib/task-list";

function Row({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="cs-label shrink-0 w-28 pt-0.5">{k}</dt>
      <dd className={`flex-1 min-w-0 ${mono ? "cs-mono text-xs break-all" : ""}`} style={{ color: "var(--cs-text)" }}>
        {v}
      </dd>
    </div>
  );
}

export default function FederatedTaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = decodeURIComponent(params.taskId ?? "");
  // 同一个联邦任务只有这一个详情页。交付物视图面向使用方（其默认视图），技术视图面向所有角色。
  const { role, ready } = useAuth();
  const isConsumer = role === "consumer";
  const tab = useSearchParams().get("tab");
  const view = isConsumer && tab !== "technical" ? "deliverables" : "technical";
  const base = `/space/federated/${encodeURIComponent(taskId)}`;

  const statusQ = useQuery({
    queryKey: ["secretflow-task", taskId],
    queryFn: () => api.getSecretFlowTask(taskId),
    enabled: !!taskId,
    refetchInterval: (q) => {
      const s = q.state.data?.state;
      return s && s !== "COMPLETED" && s !== "FAILED" && s !== "REFUSED" ? 3000 : false;
    },
  });

  const resultQ = useQuery({
    queryKey: ["secretflow-result", taskId],
    queryFn: () => api.getSecretFlowResult(taskId) as Promise<SecretFlowMergedResult>,
    enabled: !!taskId && statusQ.data?.state === "COMPLETED",
  });

  const settlementQ = useQuery({
    queryKey: ["secretflow-settlement", taskId],
    queryFn: () => api.getSecretFlowSettlement(taskId),
    enabled: !!taskId && statusQ.data?.state === "COMPLETED",
    retry: false,
  });

  const state = statusQ.data?.state ?? "—";
  const result = resultQ.data;
  const loading = statusQ.isLoading;
  const error = statusQ.error;

  if (!ready) return null;

  const displayTitle = taskDisplayTitle({
    title: statusQ.data?.purpose ? `SecretFlow · ${statusQ.data.purpose}` : null,
    purpose: statusQ.data?.purpose,
    fallbackId: taskId,
  });

  return (
    <TaskBrowseHeader
      channel="secretflow"
      title={displayTitle}
      taskId={taskId}
      initiatorId={statusQ.data?.consumerId}
      createdAt={statusQ.data?.createdAt}
      badge={mapOrchestrationStatus(state === "—" ? "running" : state)}
      backHref={taskListHref({ channel: "secretflow" })}
      showContractPanel={false}
      action={
        <span
          className="cs-chip"
          style={{ color: federatedStateColor(state), borderColor: federatedStateColor(state) }}
        >
          {federatedStateLabel(state)}
        </span>
      }
    >
      <div className="space-y-6">
        <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
          控制面聚合各 connector 本地训练后的安全制品；原始数据未出域。
        </p>
        {isConsumer && (
          <div className="flex gap-2">
            <Link href={`${base}?tab=deliverables`} className="cs-chip" data-active={view === "deliverables"}>
              交付物
            </Link>
            <Link href={`${base}?tab=technical`} className="cs-chip" data-active={view === "technical"}>
              技术视图
            </Link>
          </div>
        )}

        {view === "deliverables" ? (
          <DeliverableDetail taskId={taskId} />
        ) : (
        <AsyncBoundary loading={loading} error={error} errorText="无法加载任务状态。">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <Panel className="p-6">
                <div className="cs-label mb-4">合并 LoRA 哈希</div>
                {result?.loraDeltaHash ? (
                  <>
                    <div className="cs-mono text-2xl font-semibold break-all" style={{ color: "var(--cs-cyan)" }}>
                      {result.loraDeltaHash}
                    </div>
                    <p className="text-sm mt-3" style={{ color: "var(--cs-dim)" }}>
                      由 {federatedConnectorsLabel(result.metrics?.federatedConnectors)} 本地 LoRA delta 合并生成;
                      可用于审计比对,不包含模型权重明文。
                    </p>
                  </>
                ) : (
                  <p className="text-sm" style={{ color: "var(--cs-faint)" }}>
                    {state === "COMPLETED" ? "正在读取合并结果…" : "任务完成后将显示合并 LoRA 哈希。"}
                  </p>
                )}
              </Panel>

              {result?.contributions && result.contributions.length > 0 && (
                <Panel ticks className="p-0 overflow-hidden">
                  <div className="px-6 py-4 cs-label border-b" style={{ borderColor: "var(--cs-line)" }}>
                    各院贡献占比
                  </div>
                  {result.contributions.map((c) => (
                    <div
                      key={c.participantId}
                      className="cs-row flex items-center justify-between px-6 py-4"
                    >
                      <div>
                        <div className="text-sm">{participantLabel(c.participantId)}</div>
                        <div className="cs-mono text-xs mt-0.5" style={{ color: "var(--cs-faint)" }}>
                          {c.participantId}
                        </div>
                      </div>
                      <span className="cs-mono text-lg tabular-nums" style={{ color: "var(--cs-cyan)" }}>
                        {(c.share * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </Panel>
              )}

              {result?.metrics && (
                <Panel className="p-6">
                  <div className="cs-label mb-4">训练指标(聚合)</div>
                  <dl className="space-y-3">
                    <Row k="参与方数" v={result.metrics.partyCount ?? "—"} />
                    <Row
                      k="Connectors"
                      v={federatedConnectorsLabel(result.metrics.federatedConnectors)}
                    />
                    <Row k="训练 Loss" v={result.metrics.trainLoss?.toFixed(4) ?? "—"} mono />
                    <Row k="初始 Loss" v={result.metrics.initialLoss?.toFixed(4) ?? "—"} mono />
                    <Row k="完成轮次" v={result.roundsCompleted ?? statusQ.data?.currentEpoch ?? "—"} />
                  </dl>
                </Panel>
              )}
            </div>

            <div className="space-y-6">
              <Panel className="p-6">
                <div className="cs-label mb-4">任务状态</div>
                <dl className="space-y-3">
                  <Row k="任务 ID" v={taskId} mono />
                  <Row k="状态" v={federatedStateLabel(state)} />
                  <Row k="当前 Epoch" v={statusQ.data?.currentEpoch ?? "—"} />
                  <Row
                    k="末轮 Loss"
                    v={typeof statusQ.data?.lastLoss === "number" ? statusQ.data.lastLoss.toFixed(4) : "—"}
                    mono
                  />
                  {statusQ.data?.droppedParties?.length ? (
                    <Row k="掉线方" v={statusQ.data.droppedParties.join(", ")} />
                  ) : null}
                </dl>
              </Panel>

              {result?.privacySummary && (
                <Panel className="p-6">
                  <div className="cs-label mb-4">隐私摘要</div>
                  <dl className="space-y-3">
                    <Row k="仅安全输出" v={result.privacySummary.safeOutputOnly ? "是" : "否"} />
                    <Row k="多 connector" v={result.privacySummary.multiConnector ? "是" : "否"} />
                    <Row k="Connector 数" v={result.privacySummary.connectorCount ?? "—"} />
                    <Row
                      k="聚合方式"
                      v={
                        result.privacySummary.aggregationMode === "fedavg"
                          ? "FedAvg（编排器轮次同步）"
                          : result.privacySummary.aggregationMode === "hash_concat"
                            ? "哈希拼接（旧 demo）"
                            : "—"
                      }
                    />
                    <Row
                      k="模型说明"
                      v={
                        result.privacySummary.demoStandInModel
                          ? "演示用 stand-in 模型（非 Meditron-7B）"
                          : "—"
                      }
                    />
                  </dl>
                </Panel>
              )}

              {result?.attestation && (
                <Panel className="p-6">
                  <div className="cs-label mb-4">存证指纹</div>
                  <dl className="space-y-3">
                    <Row k="报告哈希" v={result.attestation.reportHash ?? "—"} mono />
                    <Row k="运行时" v={result.attestation.runtime ?? "—"} mono />
                  </dl>
                </Panel>
              )}

              {settlementQ.data && (
                <Panel className="p-6">
                  <div className="cs-label mb-4">按贡献分账</div>
                  <dl className="space-y-3 mb-4">
                    <Row
                      k="应付总额"
                      v={`${settlementQ.data.total} ${settlementQ.data.currency}`}
                      mono
                    />
                    <Row k="链上 tx" v={settlementQ.data.txHash ?? "—"} mono />
                  </dl>
                  <div className="space-y-2">
                    {(settlementQ.data.lines ?? []).map((l: any) => (
                      <div key={l.participantId} className="flex justify-between text-sm">
                        <span>{participantLabel(l.participantId)}</span>
                        <span className="cs-mono text-xs" style={{ color: "var(--cs-green)" }}>
                          {l.amount} {settlementQ.data.currency} ({l.contribution}%)
                        </span>
                      </div>
                    ))}
                  </div>
                  <Link
                    href="/space/settlements"
                    className="cs-navlink mt-4 justify-center text-xs"
                    style={{ borderColor: "var(--cs-line)" }}
                  >
                    查看结算台账 →
                  </Link>
                </Panel>
              )}
            </div>
          </div>
        </AsyncBoundary>
        )}
      </div>
    </TaskBrowseHeader>
  );
}
