"use client";

import { ShieldCheck } from "lucide-react";
import { Panel } from "@/components/console/ui";
import { FlPredictionOrchestrationRecord } from "@/api/client";
import { workloadMeta } from "@/lib/orchestration-workloads";

type FlTrainingMode = "sklearn" | "mock";

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="cs-label shrink-0 w-24 pt-0.5">{k}</dt>
      <dd className={`flex-1 ${mono ? "cs-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}

function trainingModeLabel(mode: FlTrainingMode | undefined): string {
  if (mode === "sklearn") return "sklearn 真实训练";
  if (mode === "mock") return "mock 占位";
  return "—";
}

function TrainingModeBadge({ mode }: { mode?: FlTrainingMode }) {
  if (!mode) return null;
  const sklearn = mode === "sklearn";
  return (
    <span
      className="cs-chip text-[0.65rem]"
      style={{
        color: sklearn ? "var(--cs-green)" : "var(--cs-amber, #d4a017)",
        borderColor: sklearn ? "var(--cs-green)" : "var(--cs-amber, #d4a017)",
      }}
    >
      {trainingModeLabel(mode)}
    </span>
  );
}

function formatMetric(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(4);
}

function PartyTrainingSummary({
  partyResult,
}: {
  partyResult: NonNullable<FlPredictionOrchestrationRecord["assignments"][0]["partyResult"]>;
}) {
  const auc = partyResult.localMetrics?.auc;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <TrainingModeBadge mode={partyResult.trainingMode} />
        <span className="cs-chip text-[0.65rem]">n={partyResult.sampleCount}</span>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <dt className="cs-label text-[0.65rem] mb-0.5">本地 AUC</dt>
          <dd className="cs-mono font-medium" style={{ color: auc != null ? "var(--cs-cyan)" : "var(--cs-faint)" }}>
            {formatMetric(auc)}
          </dd>
        </div>
        {partyResult.localMetrics?.f1 != null && (
          <div>
            <dt className="cs-label text-[0.65rem] mb-0.5">本地 F1</dt>
            <dd className="cs-mono">{formatMetric(partyResult.localMetrics.f1)}</dd>
          </div>
        )}
        {partyResult.localModelHash && (
          <div className="col-span-2 sm:col-span-2">
            <dt className="cs-label text-[0.65rem] mb-0.5">模型哈希</dt>
            <dd className="cs-mono text-xs truncate" title={partyResult.localModelHash}>
              {partyResult.localModelHash}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function FlPredictionOrchestrationDetail({ task }: { task: FlPredictionOrchestrationRecord }) {
  const meta = workloadMeta("fl_prediction");
  const spec = task.flPredictionSpec;

  const completedParties = task.assignments.filter((a) => a.partyResult);
  const sklearnCount = completedParties.filter((a) => a.partyResult?.trainingMode === "sklearn").length;
  const mockCount = completedParties.filter((a) => a.partyResult?.trainingMode === "mock").length;

  return (
    <>
      <Panel className="p-6">
        <div className="cs-label mb-4">任务定义 · {meta.shortLabel}</div>
        <dl className="space-y-3 text-sm">
          <Row k="研究目的" v={task.purpose} />
          <Row k="模态" v={spec.modality} />
          <Row k="模型" v={spec.modelType} />
          <Row k="标签列" v={spec.targetColumn} />
          <Row k="聚合" v={spec.aggregation} />
          <Row k="轮次" v={String(spec.rounds)} />
        </dl>
      </Panel>

      <Panel ticks className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="cs-label">连接器分派 · 本地训练</div>
          {completedParties.length > 0 && (
            <div className="flex flex-wrap gap-2 text-[0.65rem]" style={{ color: "var(--cs-dim)" }}>
              {sklearnCount > 0 && <span>{sklearnCount} 院 sklearn</span>}
              {mockCount > 0 && <span>{mockCount} 院 mock</span>}
            </div>
          )}
        </div>
        <div className="space-y-4">
          {task.assignments.map((a) => (
            <div
              key={a.assignmentId}
              className="text-sm border-b pb-4 last:border-0 last:pb-0"
              style={{ borderColor: "var(--cs-line-soft)" }}
            >
              <div className="flex justify-between gap-3 mb-1">
                <span className="font-medium">{a.providerId}</span>
                <span className="cs-mono text-xs shrink-0" style={{ color: "var(--cs-faint)" }}>
                  {a.status}
                </span>
              </div>
              {(a.progress?.length ?? 0) > 0 && (
                <ol className="space-y-1 cs-mono text-[0.68rem] mb-2" style={{ color: "var(--cs-dim)" }}>
                  {a.progress!.slice(-4).map((p, i) => (
                    <li key={`${p.at}-${i}`}>
                      {p.stage}
                      {p.detail ? ` · ${p.detail}` : ""}
                    </li>
                  ))}
                </ol>
              )}
              {a.partyResult ? (
                <PartyTrainingSummary partyResult={a.partyResult} />
              ) : a.status === "pending" || a.status === "running" ? (
                <p className="text-xs mt-1" style={{ color: "var(--cs-faint)" }}>
                  等待连接器出站拉取并本地训练…
                </p>
              ) : null}
              {a.error && (
                <div className="text-xs mt-2" style={{ color: "var(--cs-red)" }}>
                  {a.error}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="p-6">
        <div className="cs-label mb-4">控制面合并 · FlRunResult</div>
        {task.resultSummary?.auc != null ? (
          <div>
            <div className="flex items-center gap-2 text-sm mb-3" style={{ color: "var(--cs-green)" }}>
              <ShieldCheck size={16} /> 已合并
            </div>
            <dl className="space-y-2 text-sm">
              <Row k="联邦 AUC" v={formatMetric(task.resultSummary.auc)} />
              {task.resultSummary.f1 != null && <Row k="联邦 F1" v={formatMetric(task.resultSummary.f1)} />}
              {task.resultSummary.modelHash && <Row k="模型哈希" v={task.resultSummary.modelHash} mono />}
              {task.resultSummary.roundsCompleted != null && (
                <Row k="完成轮次" v={String(task.resultSummary.roundsCompleted)} />
              )}
            </dl>
          </div>
        ) : (
          <div className="text-sm" style={{ color: "var(--cs-faint)" }}>
            等待各方 partyResult 到齐后 mergeFlPartyResults…
          </div>
        )}
      </Panel>
    </>
  );
}
