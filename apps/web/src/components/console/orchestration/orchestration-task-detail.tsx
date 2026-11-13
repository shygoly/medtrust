"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/console/ui";
import { TaskBrowseHeader } from "@/components/console/task-browse-header";
import { api, RwsOrchestrationRecord } from "@/api/client";
import { mapOrchestrationStatus, workloadMeta } from "@/lib/orchestration-workloads";
import type { OrchestrationWorkloadKind } from "@/lib/orchestration-workloads";
import { submissionWarning } from "@/lib/l0-validation-labels";
import { taskDisplayTitle } from "@/lib/task-list";
import { participantLabel } from "@/lib/federated-tasks";
import { L0ValidationPanel } from "./l0-validation-panel";
import { ProtocolVersionPanel } from "./revise-panel";
import { ForestPlot } from "./forest-plot";
import { KmCurve } from "./km-curve";
import {
  admissionTierLabel,
  executionIsolationLabel,
  providerEndorsementLabel,
  reviewAttestationLabel,
  trustLevelLabel,
} from "@/lib/execution-isolation";

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="cs-label shrink-0 w-20 pt-0.5">{k}</dt>
      <dd className={`flex-1 ${mono ? "cs-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}

export function RwsOrchestrationDetail({ task }: { task: RwsOrchestrationRecord }) {
  const meta = workloadMeta("rws");
  const isL0 = task.analysis.type === "algorithm-validation";
  return (
    <>
      <Panel className="p-6">
        <div className="cs-label mb-4">任务定义 · {meta.shortLabel}</div>
        <dl className="space-y-3 text-sm">
          <Row k="研究目的" v={task.purpose} />
          <Row k="分析类型" v={task.analysis.type} />
          {task.analysis.drug && <Row k="用药过滤" v={task.analysis.drug} />}
          {isL0 && (
            <>
              {task.analysis.variableDefinitionId && (
                <Row k="变量定义" v={task.analysis.variableDefinitionId} mono />
              )}
              {task.analysis.goldStandardSetVersion && (
                <Row k="金标准版本" v={task.analysis.goldStandardSetVersion} mono />
              )}
              {task.analysis.algorithm && (
                <Row
                  k="识别算法"
                  v={`${task.analysis.algorithm.id}@${task.analysis.algorithm.version}`}
                  mono
                />
              )}
            </>
          )}
        </dl>
      </Panel>

      <Panel ticks className="p-6">
        <div className="cs-label mb-4">连接器分派 · 执行进度</div>
        <div className="space-y-4">
          {task.assignments.map((a) => (
            <div key={a.assignmentId} className="text-sm border-b pb-4" style={{ borderColor: "var(--cs-line-soft)" }}>
              <div className="flex justify-between mb-2">
                <span title={a.providerId}>{participantLabel(a.providerId)}</span>
                <span className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>{a.status}</span>
              </div>
              {(a.progress?.length ?? 0) > 0 ? (
                <ol className="space-y-1 cs-mono text-[0.68rem]" style={{ color: "var(--cs-dim)" }}>
                  {a.progress!.map((p, i) => (
                    <li key={`${p.at}-${i}`} className="flex gap-2">
                      <span style={{ color: "var(--cs-faint)" }}>{p.at.slice(11, 19)}</span>
                      <span style={{ color: p.stage === "failed" ? "var(--cs-red)" : p.stage === "complete" ? "var(--cs-green)" : "var(--cs-cyan)" }}>
                        {p.stage}
                      </span>
                      {p.detail && <span>{p.detail}</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="text-xs" style={{ color: "var(--cs-faint)" }}>
                  {a.status === "pending" ? "等待连接器拉取…" : "暂无进度事件"}
                </div>
              )}
              {a.aggregate && (
                <div className="cs-mono text-xs mt-2" style={{ color: "var(--cs-dim)" }}>
                  队列 n={a.aggregate.cohortSize}
                  {a.aggregate.buckets.slice(0, 3).map((b) => ` · ${b.key}:${b.count}`).join("")}
                </div>
              )}
              {a.status === "completed" && (
                <div className="text-xs mt-2 space-y-0.5" style={{ color: "var(--cs-dim)" }}>
                  <div>{executionIsolationLabel(a.executionIsolation, a.moduleSm3)}</div>
                  {/* third-party-module-admission:跑了固定模块才显示准入标注。 */}
                  {a.moduleSm3 && (
                    <>
                      <div>{admissionTierLabel(a.moduleAdmission?.tier)}</div>
                      <div>{reviewAttestationLabel(a.moduleAdmission)}</div>
                    </>
                  )}
                  {/* on-chain-provider-endorsement:按院显示证书指纹 + 验签状态。 */}
                  <div
                    style={{
                      color: a.endorsement ? "var(--cs-green)" : "var(--cs-amber)",
                    }}
                  >
                    {providerEndorsementLabel(a.endorsement)}
                  </div>
                </div>
              )}
              {a.error && <div className="text-xs mt-1" style={{ color: "var(--cs-red)" }}>{a.error}</div>}
            </div>
          ))}
          {task.assignments.some((a) => a.status === "completed") && (
            <div className="text-xs space-y-1" style={{ color: "var(--cs-faint)" }}>
              <div>
                任务级{executionIsolationLabel(task.executionIsolation)} ·{" "}
                {trustLevelLabel("software")}
              </div>
              {/* 如实边界(design D4):可独立归因 ≠ 无单一可信运营方。 */}
              <div>
                存证已按院带连接器背书:
                {task.assignments.filter((a) => a.endorsement).length}/
                {task.assignments.filter((a) => a.status === "completed").length}
                {" "}家 · 凭平台 CA 公钥可脱离平台独立核验(链仍为平台单节点运营)
              </div>
            </div>
          )}
        </div>
      </Panel>

      {isL0 ? (
        <L0ValidationPanel merged={task.merged?.l0Validation} />
      ) : (
        <Panel className="p-6">
          <div className="cs-label mb-4">合并聚合</div>
          {/* CTL-12 / §7.3: demo connectors bake injected synthetic slices */}
          {task.merged && (
            <div
              className="mb-4 p-3 text-[0.72rem] flex items-start gap-2"
              style={{
                color: "var(--cs-amber)",
                borderColor: "var(--cs-amber)",
                border: "1px solid",
              }}
            >
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              <span>{submissionWarning("synthetic")}</span>
            </div>
          )}
          {task.merged ? (
            <div>
              <div className="flex items-center gap-2 text-sm mb-3" style={{ color: "var(--cs-green)" }}>
                <ShieldCheck size={16} /> 已合并 · 队列 n={task.merged.cohortSize}
              </div>
              <div className="space-y-1 text-sm">
                {task.merged.buckets.slice(0, 8).map((b) => (
                  <div key={b.key} className="flex justify-between gap-3">
                    <span>{b.key}{b.signal ? " · 信号" : ""}</span>
                    <span className="cs-mono">
                      {b.prr != null
                        ? `a=${b.count} PRR=${b.prr.toFixed(2)} ROR=${(b.ror ?? 0).toFixed(2)}`
                        : `${b.count} (${(b.rate * 100).toFixed(1)}%)`}
                    </span>
                  </div>
                ))}
              </div>
              {task.merged.metaPooled?.merged &&
                task.merged.metaPooled.forest &&
                task.merged.metaPooled.forest.length > 0 && (
                  <div className="mt-5">
                    <div className="cs-label mb-1">随机效应 Meta · 森林图</div>
                    {task.merged.metaPooled.pooledOr != null && (
                      <div className="text-xs mb-2" style={{ color: "var(--cs-dim)" }}>
                        合并 OR ={" "}
                        <span className="cs-mono">{task.merged.metaPooled.pooledOr.toFixed(2)}</span>
                        {task.merged.metaPooled.heterogeneity && (
                          <>
                            {" · "}I² ={" "}
                            <span className="cs-mono">
                              {task.merged.metaPooled.heterogeneity.i2Percent.toFixed(0)}%
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    <ForestPlot
                      forest={task.merged.metaPooled.forest}
                      pooledEffect={task.merged.metaPooled.pooledEffect}
                      pooledCi95={task.merged.metaPooled.ci95}
                      i2Percent={task.merged.metaPooled.heterogeneity?.i2Percent}
                    />
              {/* L3 生存轨道：连接器出域前已分箱并在险人数过闸，被抑制区间不连线。 */}
              {(() => {
                const km = (
                  task.merged as unknown as {
                    kmCurve?: { bins: Array<{ t: number; survival: number; atRisk: number; suppressed?: boolean }> };
                  }
                ).kmCurve;
                return km?.bins?.length ? <KmCurve bins={km.bins} /> : null;
              })()}
                  </div>
                )}
            </div>
          ) : (
            <div className="text-sm" style={{ color: "var(--cs-faint)" }}>
              等待各院连接器出站拉取并回传聚合…
            </div>
          )}
        </Panel>
      )}

      {/* rws-study-protocol-spec §6.4 — protocol version + revise panel */}
      <ProtocolVersionPanel task={task} />
    </>
  );
}

export function useOrchestrationWorkloadKind(): OrchestrationWorkloadKind {
  const searchParams = useSearchParams();
  const w = searchParams.get("workload");
  return w === "fl_prediction" ? "fl_prediction" : "rws";
}

export function OrchestrationDetailShell({
  kind,
  title,
  purpose,
  taskId,
  consumerId,
  createdAt,
  status,
  contractIds,
  children,
}: {
  kind: OrchestrationWorkloadKind;
  title: string;
  purpose: string;
  taskId: string;
  consumerId: string;
  createdAt: string;
  status: string;
  contractIds: string[];
  children: React.ReactNode;
}) {
  const contractsQ = useQuery({
    queryKey: ["contracts"],
    queryFn: () => api.listContracts(),
    staleTime: 30_000,
  });
  const displayTitle = taskDisplayTitle({
    title,
    purpose,
    fallbackId: taskId,
  });
  const contractSummaries = useMemo(() => {
    const byId = new Map(
      ((contractsQ.data as Array<{ id: string; purpose?: string; dataProductId?: string }> | undefined) ?? []).map(
        (c) => [c.id, c] as const,
      ),
    );
    return contractIds.map((id) => {
      const c = byId.get(id);
      return {
        id,
        label: c?.purpose?.trim() || "数字合约",
        secondary: c?.dataProductId ? `产品 ${c.dataProductId}` : undefined,
      };
    });
  }, [contractIds, contractsQ.data]);

  return (
    <TaskBrowseHeader
      channel={kind}
      title={displayTitle}
      taskId={taskId}
      initiatorId={consumerId}
      createdAt={createdAt}
      badge={mapOrchestrationStatus(status)}
      contractSummaries={contractSummaries}
    >
      {children}
    </TaskBrowseHeader>
  );
}

export function useRwsTaskQuery(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["rws-task", taskId],
    queryFn: () => api.getRwsTask(taskId),
    enabled,
    refetchInterval: 3000,
  });
}

export function useFlPredictionTaskQuery(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["fl-prediction-task", taskId],
    queryFn: () => api.getFlPredictionTask(taskId),
    enabled,
    refetchInterval: 3000,
  });
}

export function useTaskIdParam() {
  const params = useParams();
  return String(params.id);
}
